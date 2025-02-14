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
import { internalServerError } from '@adobe/spacecat-shared-http-utils';
import { getRUMUrl } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';
import { syncSuggestions } from '../utils/data-access.js';
import { generateSuggestionData } from './suggestions-generator.js';

const INTERVAL = 30; // days
const AUDIT_TYPE = 'broken-internal-links';
// const DEFAULT_CPC_VALUE = 1;
// const TRAFFIC_MULTIPLIER = 0.01; // 1%
// const MAX_LINKS_TO_CONSIDER = 10;

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

  log.info('broken-internal-links: Options for RUM call: ', JSON.stringify(options));

  const internal404Links = await rumAPIClient.query('404-internal-links', options);
  const transformedLinks = internal404Links.map((link) => ({
    urlFrom: link.url_from,
    urlTo: link.url_to,
    trafficDomain: link.traffic_domain,
  }));

  const priorityLinks = calculatePriority(transformedLinks);
  const auditResult = {
    brokenInternalLinks: priorityLinks,
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

/**
 * Calculates KPI deltas based on broken internal links audit data
 * @param {Object} auditData - The audit data containing results
 * @returns {Object} KPI delta calculations
 */
// function calculateKpiDeltasForAudit(auditData) {
//   const brokenLinks = auditData?.auditResult?.brokenInternalLinks || [];

//   const groups = {};

//   for (const link of brokenLinks) {
//     if (!groups[link.urlTo]) {
//       groups[link.urlTo] = [];
//     }
//     groups[link.urlTo].push(link);
//   }

//   let projectedTrafficLost = 0;

//   Object.keys(groups).forEach((url) => {
//     const links = groups[url];
//     let linksToBeIncremented;
//     // Sort links by traffic domain if there are more than MAX_LINKS_TO_CONSIDER
//     // and only consider top MAX_LINKS_TO_CONSIDER for calculating deltas
//     if (links.length > MAX_LINKS_TO_CONSIDER) {
//       links.sort((a, b) => b.trafficDomain - a.trafficDomain);
//       linksToBeIncremented = links.slice(0, MAX_LINKS_TO_CONSIDER);
//     } else {
//       linksToBeIncremented = links;
//     }

//     projectedTrafficLost += linksToBeIncremented.reduce(
//       (acc, link) => acc + (link.trafficDomain * TRAFFIC_MULTIPLIER),
//       0,
//     );
//   });

//   const projectedTrafficValue = projectedTrafficLost * DEFAULT_CPC_VALUE;
//   return {
//     projectedTrafficLost,
//     projectedTrafficValue,
//   };
// }

// eslint-disable-next-line consistent-return
export async function convertToOpportunity(auditUrl, auditData, context) {
  const {
    dataAccess,
    log,
  } = context;
  const { Opportunity } = dataAccess;

  let opportunity;
  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    return internalServerError(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  try {
    // const kpiDeltas = {}; // calculateKpiDeltasForAudit(auditData);
    if (!opportunity) {
      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Broken_Internal_Links_Runbook.docx?web=1',
        type: AUDIT_TYPE,
        origin: 'AUTOMATION',
        title: 'Broken internal links are impairing user experience and SEO crawlability',
        description: 'We\'ve detected broken internal links on your website. Broken links can negatively impact user experience and SEO. Please review and fix these links to ensure smooth navigation and accessibility.',
        guidance: {
          steps: [
            'Update each broken internal link to valid URLs.',
            'Test the implemented changes manually to ensure they are working as expected.',
            'Monitor internal links for 404 errors in RUM tool over time to ensure they are functioning correctly.',
          ],
        },
        tags: [
          'Traffic acquisition',
          'Engagement',
        ],
        // data: kpiDeltas,
      };
      opportunity = await Opportunity.create(opportunityData);
    } else {
      opportunity.setAuditId(auditData.id);
      opportunity.setData({
        ...opportunity.getData(),
        // data: kpiDeltas,
      });
      await opportunity.save();
    }
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
    throw e;
  }

  const buildKey = (item) => `${item.urlFrom}-${item.urlTo}`;

  // Sync suggestions
  await syncSuggestions({
    opportunity,
    newData: auditData?.auditResult?.brokenInternalLinks,
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
  .withPostProcessors([generateSuggestionData, convertToOpportunity])
  .build();
