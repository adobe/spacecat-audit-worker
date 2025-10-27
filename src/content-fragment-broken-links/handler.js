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
  const aemClient = AemClient.createFrom(context, pathIndex);
  const strategy = new AnalysisStrategy(context, aemClient, pathIndex);

  // Extract URLs for analysis while keeping the full brokenPaths data
  const urls = brokenPaths.map((item) => item.url || item);
  const suggestions = await strategy.analyze(urls);

  log.info(`Found ${suggestions.length} suggestions for broken content fragment paths`);

  return suggestions.map((suggestion) => suggestion.toJSON());
}

export async function enrichBrokenContentFragmentLinkSuggestions(
  context,
  brokenPaths,
  suggestions,
) {
  const {
    site, audit, dataAccess, log, sqs, env,
  } = context;
  const { Suggestion } = dataAccess;

  const baseURL = site.getBaseURL();

  if (!suggestions || suggestions.length === 0) {
    log.info('No suggestions to enrich, skipping Mystique message');
    return { status: 'complete' };
  }

  const brokenPathsMap = new Map(
    brokenPaths.map((brokenPath) => [brokenPath.url, brokenPath]),
  );

  const opportunity = await convertToOpportunity(
    baseURL,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    // TODO: Change to Audit.AUDIT_TYPES.BROKEN_CONTENT_FRAGMENT_LINKS
    // See https://github.com/adobe/spacecat-shared/pull/1049
    'broken-content-fragment-links',
  );

  const buildKey = (suggestion) => suggestion.requestedPath;
  await syncSuggestions({
    opportunity,
    newData: suggestions,
    buildKey,
    context,
    mapNewSuggestion: (suggestion) => {
      const brokenPathData = brokenPathsMap.get(suggestion.requestedPath);
      return {
        opportunityId: opportunity.getId(),
        type: suggestion.type,
        data: {
          requestedPath: suggestion.requestedPath,
          suggestedPath: suggestion.suggestedPath,
          type: suggestion.type,
          reason: suggestion.reason,
          requestCount: brokenPathData?.requestCount || 0,
          // Array of {userAgent: string, count: number} objects
          requestUserAgents: brokenPathData?.requestUserAgents || [],
        },
      };
    },
  });

  const syncedSuggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionModel.STATUSES.NEW,
  );

  const message = {
    type: 'guidance:broken-content-fragment-links',
    siteId: site.getId(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    url: baseURL,
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

  return { status: 'complete' };
}

/**
 * The main audit runner that orchestrates the content fragment broken links audit.
 *
 * @param {string} baseURL - The base URL of the site being audited
 * @param {Object} context - The context object containing configurations, services, etc.
 * @param {Object} site - The site object being audited
 * @returns {Promise<Object>} The audit result containing broken paths and suggestions
 */
export async function contentFragmentBrokenLinksAuditRunner(baseURL, context, site) {
  const { log } = context;
  const auditContext = { ...context, site };

  try {
    const brokenPaths = await fetchBrokenContentFragmentLinks(auditContext);
    const suggestions = await analyzeBrokenContentFragmentLinks(auditContext, brokenPaths);

    await enrichBrokenContentFragmentLinkSuggestions(auditContext, brokenPaths, suggestions);

    return {
      fullAuditRef: baseURL,
      auditResult: {
        brokenPaths,
        suggestions,
      },
    };
  } catch (error) {
    log.error(`Audit failed with error: ${error.message}`);

    return {
      fullAuditRef: baseURL,
      auditResult: {
        error: error.message,
      },
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(contentFragmentBrokenLinksAuditRunner)
  .build();
