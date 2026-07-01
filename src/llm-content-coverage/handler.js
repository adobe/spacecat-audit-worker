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
  fetchTopicHashMap,
  fetchGapPrompts,
} from '@adobe/mysticat-shared-seo-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { AUDIT_TYPE, createOpportunityData } from './opportunity-data-mapper.js';

const MAX_CANDIDATE_TOPICS = 10;
const GAP_PROMPTS_LIMIT = 5;
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

  const { data, error } = await postgrestClient.rpc('rpc_brand_presence_topics', {
    p_organization_id: organizationId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_model: null,
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
    log.error(`${LOG_PREFIX} rpc_brand_presence_topics error: ${error.message}`);
    return [];
  }

  return data || [];
}

export async function auditRunner(auditUrl, context, site) {
  const { log, env, dataAccess } = context;
  const siteId = site.getId();
  const organizationId = site.getOrganizationId();
  const domain = extractDomain(site.getBaseURL());

  log.info(`${LOG_PREFIX} Starting content coverage audit for ${domain} (org: ${organizationId})`);

  const postgrestClient = dataAccess?.services?.postgrestClient;
  if (!postgrestClient) {
    log.error(`${LOG_PREFIX} No postgrestClient available in dataAccess.services`);
    return { auditResult: { topics: [], topicCount: 0 }, fullAuditRef: auditUrl };
  }

  // Step 1: Fetch brand topics from PostgREST
  const rows = await fetchBrandTopics(postgrestClient, organizationId, log);
  if (rows.length === 0) {
    log.info(`${LOG_PREFIX} No brand topics found for org ${organizationId}`);
    return { auditResult: { topics: [], topicCount: 0 }, fullAuditRef: auditUrl };
  }

  // Step 2: Score and rank topics by coverage gap
  const scored = rows
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
    }))
    .filter((t) => t.gapScore > 0)
    .sort((a, b) => b.gapScore - a.gapScore)
    .slice(0, MAX_CANDIDATE_TOPICS);

  if (scored.length === 0) {
    log.info(`${LOG_PREFIX} No topics with positive gap score found`);
    return { auditResult: { topics: [], topicCount: 0 }, fullAuditRef: auditUrl };
  }

  log.info(`${LOG_PREFIX} Top ${scored.length} gap topics identified`);

  // Step 3: Fetch topicHash from Semrush for namespace bridge (UUID → uint64 hash)
  let topicHashMap = new Map();
  try {
    const { topicClient, promptClient } = getGrpcClients(env);
    topicHashMap = await fetchTopicHashMap(topicClient, domain);

    // Step 4: Fan-out gapPrompts for each candidate topic in parallel
    await Promise.all(
      scored.map(async (t) => {
        const topicHash = topicHashMap.get(t.topic.toLowerCase());
        if (!topicHash) {
          log.warn(`${LOG_PREFIX} No topicHash found for topic "${t.topic}", skipping gap prompts`);
          return;
        }
        try {
          const opts = { limit: GAP_PROMPTS_LIMIT };
          // eslint-disable-next-line no-param-reassign
          t.gapPrompts = await fetchGapPrompts(promptClient, topicHash, domain, opts);
        } catch (err) {
          log.warn(`${LOG_PREFIX} gapPrompts failed for "${t.topic}": ${err.message}`);
          // eslint-disable-next-line no-param-reassign
          t.gapPrompts = [];
        }
      }),
    );
  } catch (err) {
    log.warn(`${LOG_PREFIX} Semrush gRPC unavailable, skipping gap prompts: ${err.message}`);
  }

  const topicCount = scored.length;
  return {
    auditResult: { topics: scored, topicCount },
    fullAuditRef: auditUrl,
    siteId,
  };
}

/**
 * Post-processor: persists the coverage gap opportunity and syncs suggestions.
 * Receives the standard PostProcessor signature from AuditBuilder.
 *
 * @param {string} auditUrl - Resolved base URL of the audited site
 * @param {object} auditData - Persisted audit data (has siteId, auditResult, id)
 * @param {object} context - Lambda context (log, dataAccess, audit set by framework)
 * @returns {Promise<object>} auditData unchanged
 */
export async function persistOpportunity(auditUrl, auditData, context) {
  const { log } = context;
  const { auditResult } = auditData;
  const { topics, topicCount } = auditResult;

  if (!topicCount) {
    log.info(`${LOG_PREFIX} No gap topics found, skipping opportunity creation`);
    return auditData;
  }

  const domain = extractDomain(auditUrl);

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    { domain, topicCount },
  );

  await syncSuggestions({
    opportunity,
    newData: topics,
    buildKey: (t) => t.topicId || t.topic,
    context,
    log,
    mapNewSuggestion: (t) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: Math.round(t.gapScore),
      data: {
        topic: t.topic,
        topicId: t.topicId,
        promptCount: t.promptCount,
        brandCitations: t.brandCitations,
        brandMentions: t.brandMentions,
        gapScore: t.gapScore,
        popularityVolume: t.popularityVolume,
        gapPrompts: t.gapPrompts || [],
      },
    }),
  });

  log.info(`${LOG_PREFIX} Created/updated opportunity with ${topicCount} suggestions`);
  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .withPostProcessors([persistOpportunity])
  .build();
