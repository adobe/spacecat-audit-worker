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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { LOG_PREFIX } from './constants.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * Step 1: Import Top Pages
 * Prepares the audit context and returns metadata for the import worker.
 *
 * @param {object} context - The audit context
 * @returns {object} - Result object with audit metadata
 */
export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`${LOG_PREFIX} Step 1: importTopPages started for site: ${site.getId()}`);
  log.info(`${LOG_PREFIX} Final URL: ${finalUrl}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  const result = {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
  };

  log.info(`${LOG_PREFIX} Step 1: importTopPages completed, returning:`, result);
  return result;
}

/**
 * Step 2: Submit for Scraping
 * Retrieves top pages from the database and prepares them for scraping.
 *
 * @param {object} context - The audit context
 * @returns {object} - Result object with URLs to scrape
 */
export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
  } = context;

  log.info(`${LOG_PREFIX} Step 2: submitForScraping started for site: ${site.getId()}`);

  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  log.info(`${LOG_PREFIX} Retrieved ${topPages.length} top pages from database`);

  const topPagesUrls = topPages.map((page) => page.getUrl());
  log.info(`${LOG_PREFIX} Reading site config: ${JSON.stringify(site?.getConfig())}`);

  // Combine includedURLs and topPages URLs to scrape
  const auditType = 'commerce-product-enrichments';
  const includedURLs = await site?.getConfig()?.getIncludedURLs(auditType) || [];
  log.info(`${LOG_PREFIX} Retrieved ${includedURLs.length} included URLs from site config`);

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(`${LOG_PREFIX} Total top pages: ${topPagesUrls.length}, Total included URLs: ${includedURLs.length}, Final URLs to scrape after removing duplicates: ${finalUrls.length}`);

  if (finalUrls.length === 0) {
    log.error(`${LOG_PREFIX} No URLs found for site ${site.getId()} - neither top pages nor included URLs`);
    throw new Error('No URLs found for site neither top pages nor included URLs');
  }

  // Filter out PDF files
  const isPdfUrl = (url) => {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      return pathname.endsWith('.pdf');
    } catch {
      return false;
    }
  };

  const filteredUrls = finalUrls.filter((url) => {
    if (isPdfUrl(url)) {
      log.info(`${LOG_PREFIX} Skipping PDF file from scraping: ${url}`);
      return false;
    }
    return true;
  });

  log.info(`${LOG_PREFIX} Filtered ${finalUrls.length - filteredUrls.length} PDF files from ${finalUrls.length} URLs`);

  const result = {
    urls: filteredUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'commerce-product-enrichments',
  };

  log.info(`${LOG_PREFIX} Step 2: submitForScraping completed, returning ${result.urls.length} URLs for scraping`);
  return result;
}

/**
 * Step 3: Run Audit and Process Results
 * This step is called after scraping is complete.
 * Currently stops with a console.log as per initial implementation requirements.
 *
 * @param {object} context - The audit context
 * @returns {object} - Result object with audit status
 */
export async function runAuditAndProcessResults(context) {
  const {
    site, audit, finalUrl, log, scrapeResultPaths,
  } = context;

  log.info(`${LOG_PREFIX} Step 3: runAuditAndProcessResults started`);
  log.info(`${LOG_PREFIX} Context:`, {
    siteId: site.getId(),
    auditId: audit.getId(),
    finalUrl,
    hasScrapeResultPaths: !!scrapeResultPaths,
    scrapeResultPathsSize: scrapeResultPaths?.size || 0,
  });

  // Log all scraped page URLs
  if (scrapeResultPaths && scrapeResultPaths.size > 0) {
    log.info(`${LOG_PREFIX} Successfully retrieved ${scrapeResultPaths.size} scraped pages:`);
    let pageCount = 0;
    for (const [url, s3Path] of scrapeResultPaths) {
      pageCount += 1;
      log.info(`${LOG_PREFIX}   ${pageCount}. URL: ${url}`);
      log.info(`${LOG_PREFIX}     S3 Path: ${s3Path}`);
    }
  } else {
    log.info(`${LOG_PREFIX} No scraped pages found`);
  }

  // STOP HERE - Initial implementation placeholder
  // TODO: Implement the actual audit logic for commerce page enrichment
  log.info(`${LOG_PREFIX} ============================================`);
  log.info(`${LOG_PREFIX} AUDIT STOP POINT - Initial Implementation`);
  log.info(`${LOG_PREFIX} Top pages retrieved and submitted for scraping successfully.`);
  log.info(`${LOG_PREFIX} Total pages scraped: ${scrapeResultPaths?.size || 0}`);
  log.info(`${LOG_PREFIX} Site ID: ${site.getId()}`);
  log.info(`${LOG_PREFIX} Audit ID: ${audit.getId()}`);
  log.info(`${LOG_PREFIX} Final URL: ${finalUrl}`);
  log.info(`${LOG_PREFIX} ============================================`);

  // Return a minimal result indicating the audit completed (for now)
  return {
    status: 'complete',
    auditResult: {
      status: 'initial-implementation',
      message: 'Commerce page enrichment audit - initial implementation stop point',
      pagesScraped: scrapeResultPaths?.size || 0,
    },
  };
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-process-results', runAuditAndProcessResults)
  .build();
