/*
 * Copyright 2023 Adobe. All rights reserved.
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
// import { dateAfterDays } from '@adobe/spacecat-shared-utils';
import { getRUMDomainkey } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';

// const AUDIT_TYPE = '404';
const INTERVAL = 30; // days
const DAILY_THRESHOLD = 1000;

// export function filter404Data(data) {
//   return data.views > PAGEVIEW_THRESHOLD
//       && !!data.url
//       && data.url.toLowerCase() !== 'other'
//       && data.source_count > 0;
// }

// function process404Response(data) {
//   return data
//     .filter(filter404Data)
//     .map((row) => ({
//       url: row.url,
//       pageviews: row.views,
//       sources: row.all_sources.filter((source) => !!source),
//     }));
// }

// function filter404LinksByDailyThreashold(links) {
//   return links.filter((data) => data.pageviews >= DAILY_THRESHOLD * INTERVAL);
// }

// function getValidInternalLinks(links, baseURL) {
//   return links.filter((data) => data.url.startsWith(baseURL));
// }

/**
 * Perform an audit to check if both www and non-www versions of a domain are accessible.
 * If the site contains a subdomain, the audit is skipped for that specific subdomain.
 *
 * @async
 * @param {string} baseURL - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function internalLinksAuditRunner(auditUrl, context, site) {
  // export async function internalLinksAuditRunner(baseURL, context) {
  const { log } = context;

  log.info(`Received audit req for domain: ${auditUrl}`);
  // if (hasNonWWWSubdomain(baseURL)) {
  //   throw Error(`Url ${baseURL} already has a subdomain. No need to run apex audit.`);
  // }

  // const urls = [baseURL, toggleWWW(baseURL)];
  // const results = await Promise.all(urls.map((_url) => probeUrlConnection(_url, log)));

  // return {
  //   auditResult: results,
  //   fullAuditRef: baseURL,
  // };

  // const finalUrl = await getRUMUrl(auditUrl);

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);

  // const startDate = dateAfterDays(-7);

  // const params = {
  //   url: finalUrl,
  //   interval: -1,
  //   startdate: startDate.toISOString().split('T')[0],
  //   enddate: new Date().toISOString().split('T')[0],
  // };
  const options = {
    domain: auditUrl,
    domainkey,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  try {
    const all404Links = await rumAPIClient.query('404', options);
    return {
      auditResult: all404Links,
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    return {
      auditResult: error,
      fullAuditRef: auditUrl,
    };
  }
  // const all404LinksWithThreshold = filter404LinksByDailyThreashold(all404Links);
  // const all404InternalLinks = getValidInternalLinks(all404LinksWithThreshold, site.getBaseURL());
  // const auditResult = {
  //   internalLinks: all404InternalLinks,
  //   auditContext: {
  //     interval: INTERVAL,
  //   },
  // };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(internalLinksAuditRunner)
  .build();
