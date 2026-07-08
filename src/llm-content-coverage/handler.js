/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  getGrpcClients,
  fetchLowRankFanoutKeywords,
} from '@adobe/mysticat-shared-seo-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData, AUDIT_TYPE } from './opportunity-data-mapper.js';

const MAX_CANDIDATE_TOPICS = 10;
const LOG_PREFIX = '[LlmContentCoverage]';

/**
 * Strips protocol, www prefix and trailing slash from a base URL to get a bare domain.
 * @param {string} baseURL
 * @returns {string}
 */
function extractDomain(baseURL) {
  return baseURL
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

/**
 * Computes a coverage gap score for a topic.
 * Higher score → high prompt volume but low brand presence (citations + mentions).
 * Avoids divide-by-zero by returning 0 when all values are zero.
 *
 * @param {number} promptCount
 * @param {number} brandCitations
 * @param {number} brandMentions
 * @returns {number}
 */
export function computeGapScore(promptCount, brandCitations, brandMentions) {
  const denom = promptCount + brandCitations + brandMentions;
  if (denom === 0) {
    return 0;
  }
  return (promptCount * promptCount) / denom;
}

/**
 * Fetches brand topics from the PostgREST `rpc_brand_presence_topics` function.
 * Returns raw rows from the RPC.
 *
 * @param {object} postgrestClient
 * @param {string} organizationId
 * @param {object} log
 * @returns {Promise<Array>}
 */
async function fetchBrandTopics(postgrestClient, organizationId, log) {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const startDate = new Date(now.setDate(now.getDate() - 90)).toISOString().slice(0, 10);

  log.info(`${LOG_PREFIX} Calling rpc_brand_presence_topics org=${organizationId} range=${startDate} to ${endDate}`);

  const { data, error } = await postgrestClient.rpc('rpc_brand_presence_topics', {
    p_organization_id: organizationId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_brand_id: null,
    p_site_id: null,
    p_category_id: null,
    p_category_name: null,
    p_topic: null,
    p_topic_ids: null,
    p_region_code: null,
    p_origin: null,
    p_sort_by: 'prompt_count',
    p_sort_order: 'desc',
    p_page_offset: 0,
    p_page_limit: 200,
  });

  if (error) {
    log.error(`${LOG_PREFIX} rpc_brand_presence_topics failed: ${JSON.stringify(error)}`);
    return [];
  }

  log.info(`${LOG_PREFIX} rpc_brand_presence_topics returned ${data?.length ?? 0} rows`);
  return data || [];
}

export async function auditRunner(auditUrl, context, site) {
  const { log, env, dataAccess } = context;
  const siteId = site.getId();
  const organizationId = site.getOrganizationId();
  const domain = extractDomain(site.getBaseURL());

  log.info(`${LOG_PREFIX} ===== START siteId=${siteId} org=${organizationId} domain=${domain} =====`);

  // Check postgrestClient
  const postgrestClient = dataAccess?.services?.postgrestClient;
  if (!postgrestClient) {
    log.error(`${LOG_PREFIX} No postgrestClient in dataAccess.services — aborting`);
    return { auditResult: { topics: [], topicCount: 0 }, fullAuditRef: auditUrl };
  }
  log.info(`${LOG_PREFIX} postgrestClient available`);

  // Check Semrush credentials
  const hasSeoCredentials = !!(env?.SEO_CLIENT_ID && env?.SEO_CLIENT_SECRET);
  log.info(`${LOG_PREFIX} Semrush credentials present: ${hasSeoCredentials} (SEO_CLIENT_ID=${env?.SEO_CLIENT_ID ? 'set' : 'MISSING'})`);

  // Step 1: Fetch brand topics from PostgREST
  log.info(`${LOG_PREFIX} Step 1: Fetching brand topics from rpc_brand_presence_topics`);
  const rows = await fetchBrandTopics(postgrestClient, organizationId, log);
  if (rows.length === 0) {
    log.info(`${LOG_PREFIX} Step 1: No brand topics found — nothing to process`);
    return { auditResult: { topics: [], topicCount: 0 }, fullAuditRef: auditUrl };
  }
  log.info(`${LOG_PREFIX} Step 1: Got ${rows.length} topics. Sample: ${JSON.stringify(rows.slice(0, 3).map((r) => ({ topic: r.topic, prompt_count: r.prompt_count, brand_citations: r.brand_citations })))}`);

  // Step 2: Score and rank topics by coverage gap, take top candidates
  log.info(`${LOG_PREFIX} Step 2: Scoring topics by gap score`);
  const allScored = rows
    .map((row) => ({
      topic: row.topic,
      topicId: row.topic_id,
      promptCount: Number(row.prompt_count ?? 0),
      brandCitations: Number(row.brand_citations ?? 0),
      brandMentions: Number(row.brand_mentions ?? 0),
      popularityVolume: row.popularity_volume || 'N/A',
    }))
    .map((t) => ({
      ...t,
      gapScore: computeGapScore(t.promptCount, t.brandCitations, t.brandMentions),
    }));

  const withScore = allScored.filter((t) => t.gapScore > 0);
  log.info(`${LOG_PREFIX} Step 2: ${withScore.length}/${allScored.length} topics have gapScore > 0`);

  const scored = withScore
    .sort((a, b) => b.gapScore - a.gapScore)
    .slice(0, MAX_CANDIDATE_TOPICS);

  if (scored.length === 0) {
    log.info(`${LOG_PREFIX} Step 2: No topics with positive gap score — nothing to process`);
    return { auditResult: { topics: [], topicCount: 0 }, fullAuditRef: auditUrl };
  }

  log.info(`${LOG_PREFIX} Step 2: Top ${scored.length} topics by gap score:`);
  scored.forEach((t, i) => {
    log.info(`${LOG_PREFIX}   [${i + 1}] "${t.topic}" gapScore=${t.gapScore.toFixed(1)} prompts=${t.promptCount} citations=${t.brandCitations} mentions=${t.brandMentions}`);
  });

  // Step 3: Call FanoutService to find keywords where brand ranks but weakly (position > 5)
  log.info(`${LOG_PREFIX} Step 3: Calling Semrush FanoutService for ${scored.length} topics on domain=${domain}`);
  try {
    const { fanoutClient } = getGrpcClients(env);
    const topicNames = scored.map((t) => t.topic);
    log.info(`${LOG_PREFIX} Step 3: Topics sent to FanoutService: ${JSON.stringify(topicNames)}`);

    const fanoutByTopic = await fetchLowRankFanoutKeywords(fanoutClient, topicNames, domain);
    log.info(`${LOG_PREFIX} Step 3: FanoutService returned data for ${fanoutByTopic.size}/${scored.length} topics`);

    for (const t of scored) {
      const fanout = fanoutByTopic.get(t.topic);
      if (fanout) {
        t.matchedTopicName = fanout.matchedTopicName;
        t.matchedTopicId = fanout.matchedTopicId;
        t.similarityScore = fanout.similarityScore;
        t.lowRankKeywords = fanout.lowRankKeywords;
        log.info(`${LOG_PREFIX} Step 3: "${t.topic}" → matched="${fanout.matchedTopicName}" similarity=${fanout.similarityScore}% lowRankKeywords=${fanout.lowRankKeywords.length}`);
        if (fanout.lowRankKeywords.length > 0) {
          log.info(`${LOG_PREFIX}   Top keywords: ${JSON.stringify(fanout.lowRankKeywords.slice(0, 3))}`);
        }
      } else {
        t.lowRankKeywords = [];
        log.warn(`${LOG_PREFIX} Step 3: "${t.topic}" — no fanout match (below similarity threshold or not found)`);
      }
    }
  } catch (err) {
    log.error(`${LOG_PREFIX} Step 3: FanoutService call failed: ${err.message}`);
    log.error(`${LOG_PREFIX} Step 3: Error stack: ${err.stack}`);
    for (const t of scored) {
      t.lowRankKeywords = [];
    }
  }

  const topicCount = scored.length;
  const topicsWithKeywords = scored.filter((t) => t.lowRankKeywords?.length > 0).length;
  log.info(`${LOG_PREFIX} ===== DONE: ${topicCount} topics, ${topicsWithKeywords} with low-rank keywords =====`);
  log.info(`${LOG_PREFIX} Final result: ${JSON.stringify(scored.map((t) => ({ topic: t.topic, gapScore: Math.round(t.gapScore), lowRankKeywords: t.lowRankKeywords?.length ?? 0 })))}`);

  return {
    auditResult: { topics: scored, topicCount },
    fullAuditRef: auditUrl,
    siteId,
  };
}

/**
 * Post-processor: creates/updates the Opportunity and syncs keyword Suggestions.
 * Runs after the audit is persisted, so auditData.id is available.
 *
 * @param {string} auditUrl
 * @param {object} auditData - persisted audit data including id and siteId
 * @param {object} context
 */
export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  const scored = auditData.auditResult?.topics ?? [];
  const domain = extractDomain(auditUrl);

  if (scored.length === 0) {
    log.info(`${LOG_PREFIX} Post-processor: no topics in audit result, skipping opportunity`);
    return { ...auditData };
  }

  log.info(`${LOG_PREFIX} Post-processor: creating opportunity for ${scored.length} topics`);

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    { domain, topics: scored },
  );
  log.info(`${LOG_PREFIX} Post-processor: opportunity id=${opportunity.getId()}`);

  const allKeywords = scored.flatMap((t) => (t.lowRankKeywords ?? []).map((k) => ({
    topic: t.topic,
    keyword: k.keyword,
    volume: k.volume,
    brandPosition: k.brandPosition,
    gapScore: Math.round(t.gapScore),
  })));

  log.info(`${LOG_PREFIX} Post-processor: syncing ${allKeywords.length} keyword suggestion(s)`);

  await syncSuggestions({
    opportunity,
    newData: allKeywords,
    buildKey: (k) => `${k.topic}::${k.keyword}`,
    context,
    log,
    mapNewSuggestion: (k) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: k.volume,
      data: {
        topic: k.topic,
        keyword: k.keyword,
        volume: k.volume,
        brandPosition: k.brandPosition,
        gapScore: k.gapScore,
      },
    }),
  });

  log.info(`${LOG_PREFIX} Post-processor: suggestions synced successfully`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .withPostProcessors([opportunityAndSuggestions])
  .build();
