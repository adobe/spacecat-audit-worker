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

  // Step 2: Score and rank topics by coverage gap, take top candidates
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

  log.info(`${LOG_PREFIX} Top ${scored.length} gap topics identified, fetching fanout keywords`);

  // Step 3: Call FanoutService to find keywords where brand ranks but weakly (position > 5)
  try {
    const { fanoutClient } = getGrpcClients(env);
    const topicNames = scored.map((t) => t.topic);
    const fanoutByTopic = await fetchLowRankFanoutKeywords(fanoutClient, topicNames, domain);

    for (const t of scored) {
      const fanout = fanoutByTopic.get(t.topic);
      if (fanout) {
        t.matchedTopicName = fanout.matchedTopicName;
        t.matchedTopicId = fanout.matchedTopicId;
        t.similarityScore = fanout.similarityScore;
        t.lowRankKeywords = fanout.lowRankKeywords;
      } else {
        t.lowRankKeywords = [];
      }
    }
  } catch (err) {
    log.warn(`${LOG_PREFIX} Semrush FanoutService unavailable, skipping low-rank keywords: ${err.message}`);
    for (const t of scored) {
      t.lowRankKeywords = [];
    }
  }

  const topicCount = scored.length;
  log.info(`${LOG_PREFIX} Audit complete — ${topicCount} topics with low-rank keyword data`);

  return {
    auditResult: { topics: scored, topicCount },
    fullAuditRef: auditUrl,
    siteId,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .build();
