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
import { getRUMDomainkey, getRUMUrl } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';
import { syncSuggestions } from '../utils/data-access.js';

const INTERVAL = 30; // days
const DAILY_PAGEVIEW_THRESHOLD = 100;
const AUDIT_TYPE = 'broken-internal-links';

/**
 * Determines if the URL has the same host as the current host.
 * @param {*} url
 * @param {*} currentHost
 * @returns
 */
function hasSameHost(url, currentHost) {
  const host = new URL(url).hostname;
  return host === currentHost;
}

/**
 * Filter out the 404 links that:
 * - have less than 100 views and do not have a URL.
 * - do not have any sources from the same domain.
 * @param {*} links - all 404 links Data
 * @param {*} hostUrl - the host URL of the domain
 * @param {*} auditUrl - the URL to run audit against
 * @param {*} log - the logger object
 * @returns {Array} - Returns an array of 404 links that meet the criteria.
 */

function transform404LinksData(responseData, hostUrl, auditUrl, log) {
  return responseData.reduce((result, { url, views, all_sources: allSources }) => {
    try {
      if (!url || views < DAILY_PAGEVIEW_THRESHOLD) {
        return result;
      }
      const sameDomainSources = allSources.filter(
        (source) => source && hasSameHost(source, hostUrl),
      );

      for (const source of sameDomainSources) {
        result.push({
          url_to: url,
          url_from: source,
          traffic_domain: views,
        });
      }
    } catch {
      log.error(
        `Error occurred for audit type broken-internal-links for url ${auditUrl}, while processing sources for link ${url}`,
      );
    }
    return result;
  }, []);
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
export async function internalLinksAuditRunner(auditUrl, context, site) {
  const { log } = context;
  const finalUrl = await getRUMUrl(auditUrl);

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context, auditUrl, log);

  const options = {
    domain: finalUrl,
    domainkey,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  log.info('broken-internal-links: Options for RUM call: ', JSON.stringify(options));

  const all404Links = await rumAPIClient.query('404', options);
  const auditResult = {
    brokenInternalLinks: transform404LinksData(all404Links, finalUrl, auditUrl, log),
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

async function convertToOpportunity(auditUrl, auditData, context) {
  const {
    dataAccess,
    log,
  } = context;

  const opportunities = await dataAccess.Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  let opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);

  if (!opportunity) {
    const opportunityData = {
      siteId: auditData.siteId,
      auditId: auditData.id,
      runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Broken_Internal_Links_Runbook.docx?web=1',
      type: AUDIT_TYPE,
      origin: 'AUTOMATION',
      title: 'Broken Internal Links',
      description: 'Broken internal links can significantly harm website\'s SEO by preventing search engines from properly indexing site, potentially reducing search rankings',
      guidance: {
        steps: [
          'Update each broken internal link to valid URLs.',
          'Test the implemented changes manually to ensure they are working as expected.',
          'Monitor internal links for 404 errors in RUM tool over time to ensure they are functioning correctly.',
        ],
      },
      tags: [
        'SEO',
        'Web indexing',
        'Web crawling',
        'User Experience',
        'Organic Traffic',
      ],
    };
    opportunity = await dataAccess.Opportunity.create(opportunityData);
  } else {
    opportunity.setAuditId(auditData.id);
    await opportunity.save();
  }

  const buildKey = (data) => `${data.siteId}|${data.auditResult.brokenInternalLinks.map((item) => item.url_to)};}`;

  // Sync suggestions
  await syncSuggestions({
    opportunity,
    newData: auditData?.auditResult?.brokenInternalLinks || [],
    buildKey,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: entry.traffic_domain,
      data: {
        ...entry,
        suggestedLink: '', // suggested links would be implemented in future
      },
    }),
    log,
  });
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(internalLinksAuditRunner)
  .withPostProcessors([convertToOpportunity])
  .build();
