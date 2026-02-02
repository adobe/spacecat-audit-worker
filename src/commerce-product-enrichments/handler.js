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
import { getObjectFromKey } from '../utils/s3-utils.js';
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
  const {
    site, finalUrl, log, data,
  } = context;

  // Parse data if it's a string (from Slack bot), or use as-is if it's an object
  let parsedData = {};
  if (typeof data === 'string' && data.length > 0) {
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      log.warn(`${LOG_PREFIX} Could not parse data as JSON: ${data}`);
    }
  } else if (data && typeof data === 'object') {
    parsedData = data;
  }

  const { limit } = parsedData;
  const limitInfo = limit ? ` with limit: ${limit}` : '';

  log.info(`${LOG_PREFIX} Step 1: importTopPages started for site: ${site.getId()}${limitInfo}`);
  log.info(`${LOG_PREFIX} Final URL: ${finalUrl}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  const result = {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
  };

  // Add limit to auditContext so it's preserved between steps
  if (limit) {
    result.auditContext = { limit };
  }

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
    data,
    auditContext,
  } = context;

  // Parse data if it's a string (from Slack bot), or use as-is if it's an object
  let parsedData = {};
  if (typeof data === 'string' && data.length > 0) {
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      log.warn(`${LOG_PREFIX} Could not parse data as JSON: ${data}`);
    }
  } else if (data && typeof data === 'object') {
    parsedData = data;
  }

  // Read limit from auditContext (for step chaining) or data (for initial call)
  const limit = auditContext?.limit || parsedData.limit;
  const limitInfo = limit ? ` with limit: ${limit}` : '';

  log.info(`${LOG_PREFIX} Step 2: submitForScraping started for site: ${site.getId()}${limitInfo}`);

  const { SiteTopPage } = dataAccess;
  const allTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  log.info(`${LOG_PREFIX} Retrieved ${allTopPages.length} top pages from database`);

  // Limit top pages for scraping if limit is provided
  const topPages = limit ? allTopPages.slice(0, limit) : allTopPages;
  if (limit) {
    log.info(`${LOG_PREFIX} Limited to ${topPages.length} top pages for scraping`);
  }

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
    jobId: site.getId(), // Use siteId as jobId so scraper stores results in correct path
    processingType: 'default',
    auditContext: {
      scrapeJobId: site.getId(), // Pass scrapeJobId to Step 3 for retrieving results
    },
    options: {
      waitTimeoutForMetaTags: 5000,
    },
    allowCache: false,
    maxScrapeAge: 0,
  };

  log.info(`${LOG_PREFIX} Step 2: submitForScraping completed, returning ${result.urls.length} URLs for scraping`);
  return result;
}

/**
 * Step 3: Run Audit and Process Results
 * This step is called after scraping is complete.
 * Reads scrape results from S3 and processes them to identify product pages.
 *
 * @param {object} context - The audit context
 * @returns {object} - Result object with audit status
 */
export async function runAuditAndProcessResults(context) {
  const {
    site, audit, finalUrl, log, scrapeResultPaths, s3Client, env, auditContext,
  } = context;

  log.info(`${LOG_PREFIX} Step 3: runAuditAndProcessResults started`);

  // Debug logging to understand what context we're receiving
  log.info(`${LOG_PREFIX} Full auditContext:`, JSON.stringify(auditContext));
  log.info(`${LOG_PREFIX} scrapeJobId from auditContext:`, auditContext?.scrapeJobId);
  log.info(`${LOG_PREFIX} Context:`, {
    siteId: site.getId(),
    auditId: audit.getId(),
    finalUrl,
    scrapeResultPathsSize: scrapeResultPaths?.size || 0,
    hasScrapeResultPaths: !!scrapeResultPaths,
    scrapeResultPathsType: typeof scrapeResultPaths,
    scrapeResultPathsIsMap: scrapeResultPaths instanceof Map,
  });

  if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
    let scrapeResultPathsState = 'empty';
    if (scrapeResultPaths === undefined) {
      scrapeResultPathsState = 'undefined';
    } else if (scrapeResultPaths === null) {
      scrapeResultPathsState = 'null';
    }
    log.info(`${LOG_PREFIX} No scraped pages found - scrapeResultPaths is ${scrapeResultPathsState}`);
    log.info(`${LOG_PREFIX} DEBUG: This might indicate scrapeJobId wasn't found or getScrapeResultPaths() returned empty`);
    return {
      auditResult: {
        status: 'NO_OPPORTUNITIES',
        message: 'No scraped content found',
      },
      fullAuditRef: finalUrl,
    };
  }

  // Log the actual scrape result paths for debugging
  log.info(`${LOG_PREFIX} scrapeResultPaths entries:`, Array.from(scrapeResultPaths.entries()).slice(0, 5));

  // Get S3 bucket configuration
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for commerce audit';
    log.error(`${LOG_PREFIX} ERROR: ${errorMsg}`);
    return {
      auditResult: {
        status: 'PROCESSING_FAILED',
        error: errorMsg,
      },
      fullAuditRef: finalUrl,
    };
  }

  log.info(`${LOG_PREFIX} Processing ${scrapeResultPaths.size} scrape results from S3 bucket: ${bucketName}`);

  // Process each scraped result in parallel
  const processResults = await Promise.all(
    [...scrapeResultPaths].map(async ([url, s3Path]) => {
      try {
        // Read the scrape.json file from S3
        log.debug(`${LOG_PREFIX} Reading scrape data from S3: ${s3Path}`);
        const scrapeData = await getObjectFromKey(s3Client, bucketName, s3Path, log);

        if (!scrapeData) {
          log.warn(`${LOG_PREFIX} No scrape data found for: ${url}`);
          return {
            success: false,
            url,
            status: 'NO_DATA',
            reason: 'Empty scrape data',
          };
        }

        // Product page detection logic
        // Check for JSON-LD Product structure with SKU (follows product-metatags pattern)
        let isProductPage = false;
        let skuCount = 0;

        const Product = scrapeData?.scrapeResult?.structuredData?.jsonld?.Product;
        if (Array.isArray(Product) && Product.length > 0) {
          // Count products with SKU
          skuCount = Product.filter((product) => product.sku).length;
          isProductPage = skuCount === 1;
        }

        log.debug(`${LOG_PREFIX} Processed page: ${url} (isProductPage: ${isProductPage})`);

        return {
          success: true,
          url,
          location: s3Path,
          isProductPage,
          skuCount,
        };
      } catch (error) {
        log.error(`${LOG_PREFIX} Error processing scrape result for ${url}: ${error.message}`, error);
        return {
          success: false,
          url,
          status: 'PROCESSING_ERROR',
          reason: error.message,
        };
      }
    }),
  );

  // Separate successful and failed results
  const processedPages = processResults.filter((r) => r.success);
  const failedPages = processResults.filter((r) => !r.success);

  // Filter for product pages only
  const productPages = processedPages.filter((page) => page.isProductPage);

  log.info(`${LOG_PREFIX} ============================================`);
  log.info(`${LOG_PREFIX} Audit Processing Complete`);
  log.info(`${LOG_PREFIX} Total scraped pages: ${scrapeResultPaths.size}`);
  log.info(`${LOG_PREFIX} Successfully processed: ${processedPages.length}`);
  log.info(`${LOG_PREFIX} Failed/Skipped: ${failedPages.length}`);
  log.info(`${LOG_PREFIX} Product pages found: ${productPages.length}`);
  log.info(`${LOG_PREFIX} Site ID: ${site.getId()}`);
  log.info(`${LOG_PREFIX} Audit ID: ${audit.getId()}`);
  log.info(`${LOG_PREFIX} ============================================`);

  // Return audit results
  return {
    auditResult: {
      status: productPages.length > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
      message: `Found ${productPages.length} product pages out of ${processedPages.length} processed pages`,
      totalScraped: scrapeResultPaths.size,
      processedPages: processedPages.length,
      failedPages: failedPages.length,
      productPages: productPages.length,
    },
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-process-results', runAuditAndProcessResults)
  .build();
