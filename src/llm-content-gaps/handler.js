/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// ⚠️  DEMO ONLY — DO NOT USE IN PRODUCTION ⚠️
// This audit contains hardcoded stub data and is intended solely for
// prototyping and demonstration purposes. It must be replaced with a real
// implementation before being enabled on any production site.

import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { AUDIT_TYPE } from './constants.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { loadTopicsForSite, selectTopTopics } from './topics.js';

/**
 * Preflight-compatible handler: loads and scores topics for the site, then
 * maps them to content-gap findings for each URL in auditContext.previewUrls.
 * Can be registered directly in PREFLIGHT_HANDLERS or called from auditRunner.
 *
 * @param {object} context - Audit context with site and log
 * @param {object} auditContext - Preflight context with previewUrls and scrapedObjects
 * @returns {Array<object>} Flat array of content-gap findings across all URLs
 */
export function llmContentGapsHandler(context, auditContext) {
  const { site, log } = context;
  const { previewUrls, scrapedObjects = {} } = auditContext;

  const allTopics = loadTopicsForSite(site.getBaseURL());
  const topTopics = selectTopTopics(allTopics);

  return previewUrls.flatMap((url) => {
    log.info(`[${AUDIT_TYPE}] checking ${url}`);
    return topTopics.map((t) => ({
      success: false,
      check: 'content-gap',
      checkTitle: `Content gap: ${t.adobe_topic}`,
      description: `Topic "${t.adobe_topic}" has low AI citation share (${t.citation_share}) and low owned keyword share (${t.owned_keywords_share}) with a search volume of ${t.volume}.`,
      explanation: 'Expand content coverage for this topic to capture untapped search and AI citation opportunities.',
      url,
      scrapeData: scrapedObjects[url],
      topic: t.adobe_topic,
      topicLabel: t.semrush_topic,
      volume: t.volume,
      citationShare: t.citation_share,
      ownedKeywordsShare: t.owned_keywords_share,
      opportunityScore: t.opportunityScore,
    }));
  });
}

export async function auditRunner(auditUrl, context, site) {
  const { log } = context;
  log.info(`[${AUDIT_TYPE}] selecting top content-gap topics`);

  const findings = llmContentGapsHandler(
    { ...context, site },
    { previewUrls: [auditUrl] },
  );

  return {
    auditResult: {
      siteId: site.getId(), url: auditUrl, status: 'completed', findings,
    },
    fullAuditRef: auditUrl,
  };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  const gaps = (auditData.auditResult?.findings || []).filter((f) => !f.success);

  if (!gaps.length) {
    log.info(`[${AUDIT_TYPE}] no content gaps found, skipping opportunity creation`);
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
  );

  await syncSuggestions({
    opportunity,
    newData: gaps,
    context,
    buildKey: (gap) => `${gap.topic}|${auditUrl}`,
    mapNewSuggestion: (gap) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: Math.round(gap.opportunityScore),
      data: {
        url: auditUrl,
        topic: gap.topic,
        topicLabel: gap.topicLabel,
        volume: gap.volume,
        citationShare: gap.citationShare,
        ownedKeywordsShare: gap.ownedKeywordsShare,
        opportunityScore: gap.opportunityScore,
      },
    }),
    log,
  });

  log.info(`[${AUDIT_TYPE}] opportunity created and ${gaps.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .withPostProcessors([opportunityAndSuggestions])
  .build();
