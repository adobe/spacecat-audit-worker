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

import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { AnalysisStrategy } from './analysis/analysis-strategy.js';
import { PathIndexCache } from './cache/path-index-cache.js';
import { AemClient } from './clients/aem-client.js';
import { AthenaCollector } from './collectors/athena-collector.js';
import { PathIndex } from './domain/index/path-index.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

// TODO: Change to Audit.AUDIT_TYPES.CONTENT_FRAGMENT_404
// See https://github.com/adobe/spacecat-shared/pull/1049
export const AUDIT_TYPE = 'content-fragment-404';
// TODO: Change to Audit.AUDIT_TYPES.CONTENT_FRAGMENT_404_AUTO_SUGGEST
export const AUDIT_TYPE_AUTO_SUGGEST = `${AUDIT_TYPE}-auto-suggest`;
export const GUIDANCE_TYPE = `guidance:${AUDIT_TYPE}`;

async function fetchContentFragment404s(context) {
  const { log } = context;

  const collector = await AthenaCollector.createFrom(context);
  const contentFragment404s = await collector.fetchContentFragment404s();

  log.info(`[Content Fragment 404] Found ${contentFragment404s.length} content fragment 404s from ${collector.constructor.name}`);

  return contentFragment404s;
}

async function analyzeContentFragment404s(context, contentFragment404s) {
  const { log } = context;

  const pathIndex = new PathIndex(context);
  const cache = new PathIndexCache(pathIndex);
  const aemClient = AemClient.createFrom(context, cache);
  const strategy = new AnalysisStrategy(context, aemClient, pathIndex);

  // Extract URLs for analysis while keeping the full contentFragment404s data
  const urls = contentFragment404s.map((item) => item.url || item);
  const suggestions = await strategy.analyze(urls);

  log.info(`[Content Fragment 404] Found ${suggestions.length} suggestions for content fragment 404s`);

  return suggestions.map((suggestion) => suggestion.toJSON());
}

export async function createContentFragmentPathSuggestions(
  auditUrl,
  auditData,
  context,
) {
  const { log } = context;
  const { contentFragment404s, suggestions } = auditData.auditResult;

  if (!suggestions || suggestions.length === 0) {
    log.info('[Content Fragment 404] No suggestions to create');
    return;
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
  );

  const contentFragment404sMap = new Map(
    contentFragment404s.map((brokenPath) => [brokenPath.url, brokenPath]),
  );

  // Enrich suggestions with request metadata
  const enrichedSuggestions = suggestions.map((suggestion) => {
    const contentFragment404Data = contentFragment404sMap.get(suggestion.requestedPath);
    return {
      ...suggestion,
      requestCount: contentFragment404Data?.requestCount || 0,
      requestUserAgents: contentFragment404Data?.requestUserAgents || [],
    };
  });

  const buildKey = (data) => `${data.requestedPath}|${data.type}`;

  await syncSuggestions({
    context,
    opportunity,
    newData: enrichedSuggestions,
    buildKey,
    getRank: (data) => data.requestCount,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: SuggestionModel.TYPES.AI_INSIGHTS,
      rank: suggestion.requestCount,
      data: suggestion,
    }),
  });

  log.info(`[Content Fragment 404] Created ${suggestions.length} suggestions for opportunity ${opportunity.getId()}`);
}

export async function enrichContentFragmentPathSuggestions(
  auditUrl,
  auditData,
  context,
  site,
) {
  const {
    dataAccess, log, sqs, env,
  } = context;
  const { Configuration, Suggestion, Opportunity } = dataAccess;

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite(AUDIT_TYPE_AUTO_SUGGEST, site)) {
    log.info(`[Content Fragment 404] Auto-Suggest is disabled for site ${site.getId()}`);
    return;
  }

  const opportunities = await Opportunity.allBySiteIdAndStatus(site.getId(), 'NEW');
  const opportunity = opportunities.find(
    (opp) => opp.getType() === AUDIT_TYPE && opp.getAuditId() === auditData.id,
  );
  if (!opportunity) {
    log.info('[Content Fragment 404] No opportunity found for this audit, skipping Mystique message');
    return;
  }

  const syncedSuggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionModel.STATUSES.NEW,
  );
  if (!syncedSuggestions || syncedSuggestions.length === 0) {
    log.info('[Content Fragment 404] No suggestions to enrich, skipping Mystique message');
    return;
  }

  const message = {
    type: GUIDANCE_TYPE,
    siteId: site.getId(),
    auditId: auditData.id,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    url: auditUrl,
    data: {
      opportunityId: opportunity.getId(),
      contentFragment404s: syncedSuggestions.map((suggestion) => ({
        suggestionId: suggestion.getId(),
        requestedPath: suggestion.getData().requestedPath,
        requestCount: suggestion.getData().requestCount,
        // Array of {userAgent: string, count: number} for detailed breakdown
        requestUserAgents: suggestion.getData().requestUserAgents,
        suggestedPath: suggestion.getData().suggestedPath,
        reason: suggestion.getData().reason,
      })),
    },
  };
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);

  log.info(`[Content Fragment 404] Sent ${syncedSuggestions.length} content fragment path suggestions to Mystique for enrichment`);
}

export async function contentFragment404AuditRunner(baseURL, context, site) {
  const auditContext = { ...context, site };

  const contentFragment404s = await fetchContentFragment404s(auditContext);
  const suggestions = await analyzeContentFragment404s(auditContext, contentFragment404s);

  return {
    fullAuditRef: baseURL,
    auditResult: {
      contentFragment404s,
      suggestions,
    },
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(contentFragment404AuditRunner)
  .withPostProcessors([
    createContentFragmentPathSuggestions,
    enrichContentFragmentPathSuggestions,
  ])
  .build();
