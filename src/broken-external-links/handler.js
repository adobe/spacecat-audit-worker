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

import { load as cheerioLoad } from 'cheerio';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import {
  extractExternalLinks,
  checkExternalLinks,
  MAX_PAGES,
} from './helpers.js';

// Use string literal until spacecat-shared-data-access publishes BROKEN_EXTERNAL_LINKS constant.
// Switch to Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS once the package is bumped.
const AUDIT_TYPE = 'broken-external-links';

/**
 * Aggregates broken links by unique broken URL, collecting source pages.
 * One suggestion per broken external URL, with all referring page URLs in data.urlFrom.
 *
 * @param {Array<{pageUrl: string, brokenLinks: Array<{url: string, status: number}>}>} brokenLinksBySrcPage
 * @returns {Array<{url: string, status: number, urlFrom: string[]}>}
 */
export function buildSuggestions(brokenLinksBySrcPage) {
  const byUrl = new Map();
  for (const { pageUrl, brokenLinks } of brokenLinksBySrcPage) {
    for (const { url, status } of brokenLinks) {
      if (!byUrl.has(url)) {
        byUrl.set(url, { url, status, urlFrom: [] });
      }
      byUrl.get(url).urlFrom.push(pageUrl);
    }
  }
  return Array.from(byUrl.values());
}

/**
 * Runner function for the broken-external-links audit.
 * Fetches top pages, extracts external links, checks their HTTP status,
 * and creates an Opportunity with per-broken-URL Suggestions.
 *
 * @param {string} auditUrl - The resolved base URL for the audit.
 * @param {Object} context - Lambda context (dataAccess, log, etc.).
 * @param {Object} site - The site object.
 * @returns {Promise<{auditData: Object, fullAuditRef: string}>}
 */
export async function brokenExternalLinksRunner(auditUrl, context, site) {
  const { dataAccess, log } = context;
  const { SiteTopPage } = dataAccess;

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(
    site.getId(),
    'seo',
    'global',
  );
  const pages = topPages.slice(0, MAX_PAGES);

  const siteHostname = new URL(auditUrl).hostname;
  const brokenLinksBySrcPage = [];

  for (const page of pages) {
    const pageUrl = page.getURL();
    let html;
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(pageUrl, { timeout: 8000 });
      if (!response.ok) {
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      html = await response.text();
    } catch (err) {
      log.warn(`Failed to fetch page ${pageUrl}: ${err.message}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    const $ = cheerioLoad(html);
    const externalLinks = extractExternalLinks($, siteHostname);
    if (externalLinks.length === 0) {
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const broken = await checkExternalLinks(externalLinks, log);
    if (broken.length > 0) {
      brokenLinksBySrcPage.push({ pageUrl, brokenLinks: broken });
    }
  }

  const totalBrokenLinks = brokenLinksBySrcPage
    .reduce((acc, p) => acc + p.brokenLinks.length, 0);
  const auditResult = { brokenLinksBySrcPage, totalBrokenLinks };

  if (totalBrokenLinks > 0) {
    const suggestions = buildSuggestions(brokenLinksBySrcPage);

    const opportunity = await convertToOpportunity(
      auditUrl,
      { siteId: site.getId() },
      context,
      createOpportunityData,
      AUDIT_TYPE,
    );

    await syncSuggestions({
      opportunity,
      newData: suggestions,
      buildKey: (data) => data.url,
      context,
      mapNewSuggestion: (data) => ({
        opportunityId: opportunity.getId(),
        type: 'REDIRECT_UPDATE',
        rank: data.status,
        data: {
          url: data.url,
          status: data.status,
          urlFrom: data.urlFrom,
        },
      }),
    });
  }

  return { auditData: auditResult, fullAuditRef: auditUrl };
}

export default new AuditBuilder()
  .withRunner(brokenExternalLinksRunner)
  .build();
