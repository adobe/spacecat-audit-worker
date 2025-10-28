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

async function fetchBrokenContentFragmentLinks(context) {
  const { log } = context;

  const collector = await AthenaCollector.createFrom(context);
  const brokenPaths = await collector.fetchBrokenPaths();

  log.info(`Found ${brokenPaths.length} broken content fragment paths from ${collector.constructor.name}`);

  return brokenPaths;
}

async function analyzeBrokenContentFragmentLinks(context, brokenPaths) {
  const { log } = context;

  const pathIndex = new PathIndex(context);
  const cache = new PathIndexCache(pathIndex);
  const aemClient = AemClient.createFrom(context, cache);
  const strategy = new AnalysisStrategy(context, aemClient, pathIndex);

  // Extract URLs for analysis while keeping the full brokenPaths data
  const urls = brokenPaths.map((item) => item.url || item);
  const suggestions = await strategy.analyze(urls);

  log.info(`Found ${suggestions.length} suggestions for broken content fragment paths`);

  return suggestions.map((suggestion) => suggestion.toJSON());
}

export async function createContentFragmentLinkSuggestions(
  auditUrl,
  auditData,
  context,
) {
  const { log } = context;
  const { brokenPaths, suggestions } = auditData.auditResult;

  if (!suggestions || suggestions.length === 0) {
    log.info('No suggestions to create');
    return;
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    // TODO: Change to Audit.AUDIT_TYPES.BROKEN_CONTENT_FRAGMENT_LINKS
    // See https://github.com/adobe/spacecat-shared/pull/1049
    'broken-content-fragment-links',
  );

  const brokenPathsMap = new Map(
    brokenPaths.map((brokenPath) => [brokenPath.url, brokenPath]),
  );

  // Enrich suggestions with request metadata
  const enrichedSuggestions = suggestions.map((suggestion) => {
    const brokenPathData = brokenPathsMap.get(suggestion.requestedPath);
    return {
      ...suggestion,
      requestCount: brokenPathData?.requestCount || 0,
      requestUserAgents: brokenPathData?.requestUserAgents || [],
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

  log.info(`Created ${suggestions.length} suggestions for opportunity ${opportunity.getId()}`);
}

export async function enrichContentFragmentLinkSuggestions(
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
  if (!configuration.isHandlerEnabledForSite('broken-content-fragment-links', site)) {
    log.info(`Auto-Suggest is disabled for site ${site.getId()}`);
    return;
  }

  const opportunities = await Opportunity.allBySiteIdAndStatus(site.getId(), 'NEW');
  const opportunity = opportunities.find(
    (opp) => opp.getType() === 'broken-content-fragment-links' && opp.getAuditId() === auditData.id,
  );
  if (!opportunity) {
    log.info('No opportunity found for this audit, skipping Mystique message');
    return;
  }

  const syncedSuggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionModel.STATUSES.NEW,
  );
  if (!syncedSuggestions || syncedSuggestions.length === 0) {
    log.info('No suggestions to enrich, skipping Mystique message');
    return;
  }

  const message = {
    type: 'guidance:broken-content-fragment-links',
    siteId: site.getId(),
    auditId: auditData.id,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    url: auditUrl,
    data: {
      opportunityId: opportunity.getId(),
      brokenPaths: syncedSuggestions.map((suggestion) => ({
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

  log.info(`Sent ${syncedSuggestions.length} content fragment path suggestions to Mystique for enrichment`);
}

export async function contentFragmentBrokenLinksAuditRunner(baseURL, context, site) {
  const auditContext = { ...context, site };

  const brokenPaths = await fetchBrokenContentFragmentLinks(auditContext);
  const suggestions = await analyzeBrokenContentFragmentLinks(auditContext, brokenPaths);

  return {
    fullAuditRef: baseURL,
    auditResult: {
      brokenPaths,
      suggestions,
    },
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(contentFragmentBrokenLinksAuditRunner)
  .withPostProcessors([
    createContentFragmentLinkSuggestions,
    enrichContentFragmentLinkSuggestions,
  ])
  .build();
