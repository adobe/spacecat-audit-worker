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
import { getRUMDomainkey, getRUMUrl } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';

const INTERVAL = 30; // days
const DAILY_PAGEVIEW_THRESHOLD = 100;

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
 * @returns {Array} - Returns an array of 404 links that meet the criteria.
 */

function transform404LinksData(responseData, hostUrl) {
  return responseData.filter(
    (item) => item.views >= DAILY_PAGEVIEW_THRESHOLD
    && !!item.url
    && item.all_sources.filter(Boolean).some((source) => hasSameHost(source, hostUrl)),
  );
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
  const finalUrl = await getRUMUrl(auditUrl);

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);

  const options = {
    domain: finalUrl,
    domainkey,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  const all404Links = await rumAPIClient.query('404', options);
  const auditResult = {
    internalLinks: transform404LinksData(all404Links, finalUrl),
    auditContext: {
      interval: INTERVAL,
    },
  };

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(internalLinksAuditRunner)
  .build();
