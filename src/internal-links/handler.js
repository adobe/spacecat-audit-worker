/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { getRUMUrl } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { generateSuggestionData } from './suggestions-generator.js';
import { calculateKpiDeltasForAudit, isLinkInaccessible } from './helpers.js';

const INTERVAL = 30; // days
const auditType = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

/**
 * Classifies links into priority categories based on views
 * High: top 25%, Medium: next 25%, Low: bottom 50%
 * @param {Array} links - Array of objects with views property
 * @returns {Array} - Links with priority classifications included
 */
function calculatePriority(links) {
  // Sort links by views in descending order
  const sortedLinks = [...links].sort((a, b) => b.views - a.views);

  // Calculate indices for the 25% and 50% marks
  const quarterIndex = Math.ceil(sortedLinks.length * 0.25);
  const halfIndex = Math.ceil(sortedLinks.length * 0.5);

  // Map through sorted links and assign priority
  return sortedLinks.map((link, index) => {
    let priority;

    if (index < quarterIndex) {
      priority = 'high';
    } else if (index < halfIndex) {
      priority = 'medium';
    } else {
      priority = 'low';
    }

    return {
      ...link,
      priority,
    };
  });
}

/**
 * Perform an audit to check which internal links for domain are broken.
 *
 * @async
 * @param {string} baseURL - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function internalLinksAuditRunner(auditUrl, context) {
  const { log } = context;
  const finalUrl = await getRUMUrl(auditUrl);

  const rumAPIClient = RUMAPIClient.createFrom(context);

  const options = {
    domain: finalUrl,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  log.info(`broken-internal-links audit: ${auditType}: Options for RUM call: `, JSON.stringify(options));

  const internal404Links = await rumAPIClient.query('404-internal-links', options);
  const transformedLinks = internal404Links.map((link) => ({
    urlFrom: link.url_from,
    urlTo: link.url_to,
    trafficDomain: link.traffic_domain,
  }));

  let finalLinks = calculatePriority(transformedLinks);

  finalLinks = finalLinks.filter(async (link) => isLinkInaccessible(link.urlTo, log));

  const auditResult = {
    brokenInternalLinks: finalLinks,
    fullAuditRef: auditUrl,
    finalUrl,
    auditContext: {
      interval: INTERVAL,
    },
  };

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const kpiDeltas = calculateKpiDeltasForAudit(auditData);
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
    {
      kpiDeltas,
    },
  );
  const { log } = context;

  const buildKey = (item) => `${item.urlFrom}-${item.urlTo}`;

  await syncSuggestions({
    opportunity,
    newData: auditData?.auditResult?.brokenInternalLinks,
    context,
    buildKey,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: entry.trafficDomain,
      data: {
        title: entry.title,
        urlFrom: entry.urlFrom,
        urlTo: entry.urlTo,
        urlsSuggested: entry.urlsSuggested || [],
        aiRationale: entry.aiRationale || '',
        trafficDomain: entry.trafficDomain,
      },
    }),
    log,
  });
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(internalLinksAuditRunner)
  .withPostProcessors([generateSuggestionData, opportunityAndSuggestions])
  .build();
