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
/* eslint-disable no-await-in-loop */

import { Audit } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';

import { AuditBuilder } from '../common/audit-builder.js';
import missingRules from './missing-rules.js';
import { getScrapeForPath } from '../support/utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.debug(`[MSDA] Importing top pages for ${finalUrl}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    finalUrl,
  };
}

export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
    finalUrl,
  } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  if (topPages.length === 0) {
    throw new Error('No top pages found for site');
  }

  log.debug(`SDA: Submitting for scraping ${topPages.length} top pages for site ${site.getId()}, finalUrl: ${finalUrl}`);

  return {
    urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
    siteId: site.getId(),
    type: 'structured-data',
  };
}

function classifyUrl(pathname, pageTypes = []) {
  let foundPageType = 'uncategorized';
  for (const pageType of pageTypes) {
    if (pageType.regEx.test(pathname)) {
      foundPageType = pageType.name;
      break;
    }
  }

  return foundPageType;
}

export async function detectMissingStructuredDataCandidates(context) {
  const {
    site, finalUrl, log, dataAccess,
  } = context;
  const { SiteTopPage } = dataAccess;

  const siteId = site.getId();

  try {
    // Get top pages
    let topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    if (!isNonEmptyArray(topPages)) {
      log.error(`[MSDA] No top pages found for site ${finalUrl} (${siteId}). Ensure that top pages were imported.`);
      throw new Error(`No top pages for site ID ${siteId} found.`);
    }
    // TODO: For development, only use 10 pages
    topPages = topPages.slice(0, 10);

    const dataTypesToIgnore = ['pdf', 'ps', 'dwf', 'kml', 'kmz', 'xls', 'xlsx', 'ppt', 'pptx', 'doc', 'docx', 'rtf', 'swf'];
    topPages = topPages
      // Filter out files from the top pages as these are not scraped
      .filter((page) => !dataTypesToIgnore.some((dataType) => page.getUrl().endsWith(`.${dataType}`)))
      // Convert to object
      .map((page) => {
        const url = page.getUrl();
        const { pathname } = new URL(url);
        return {
          url,
          pathname,
          topKeyword: page.getTopKeyword(),
          structuredDataEntities: [],
        };
      });

    // TODO: Fetch and process RUM bundle data

    // Get page classification data
    let pageTypes = [];
    try {
      pageTypes = (await site.getPageTypes())
        .map((pageType) => ({ ...pageType, regEx: new RegExp(pageType.pattern) }));
      log.info(`[MSDA] Page types: ${JSON.stringify(pageTypes)}`);

      // Classify pages by its URL
      for (const page of topPages) {
        page.pageType = classifyUrl(page.pathname, pageTypes);
      }
    } catch (error) {
      log.error(`[MSDA] Failed to get page types for site ${finalUrl} (${siteId})`, error);
    }

    log.info(`[MSDA] Top pages with page types: ${JSON.stringify(topPages)}`);

    const results = {};
    for (const page of topPages) {
      // Fetch scrape data from S3
      let { pathname } = page;
      if (pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      const scrapeResult = await getScrapeForPath(pathname, context, site);
      const { microdata, rdfa, jsonld } = scrapeResult.scrapeResult.structuredData;
      page.structuredDataEntities.push(
        ...Object.keys(microdata ?? {}),
        ...Object.keys(rdfa ?? {}),
        ...Object.keys(jsonld ?? {}),
      );

      log.info(`[MSDA] Page ${page.url} has existing structured data entities: ${JSON.stringify(page.structuredDataEntities)}`);

      // Apply rules
      log.info(`[MSDA] Applying rules to page ${page.url}`);
      results[page.url] = {
        candidate: [],
        accepted: [],
      };
      for (const rule of missingRules) {
        const result = await rule(page);
        if (result.candidate.length > 0) {
          results[page.url].candidate.push(...result.candidate);
        }
        if (result.accepted.length > 0) {
          results[page.url].accepted.push(...result.accepted);
        }
      }
    }
    log.info(`[MSDA] Results: ${JSON.stringify(results)}`);

    // TODO: Now send the results over to mystique to validate candidates

  } catch (error) {
    log.error(`[MSDA] Missing structured data audit failed for site ${finalUrl} (${siteId})`, error);
    throw error;
  }

  // Data collection phase

    // Get all rum bundle data

    // Extract keywords

    // Extract clickable elements

    // Extract CSS classes and blocks

    // Send data to Mystique

}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('detect-missing-structured-data-candidates', detectMissingStructuredDataCandidates)
  .build();
