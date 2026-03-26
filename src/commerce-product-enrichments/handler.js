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
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { LOG_PREFIX, AUDIT_TYPE } from './constants.js';
import { getCommerceConfig } from '../utils/saas.js';
import { getSitemapUrls } from '../sitemap/common.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const MAX_EXCLUDED_URLS = 500;

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

  log.debug(`${LOG_PREFIX} Step 1: input:`, { siteId: site.getId(), finalUrl, data });

  // Parse data if it's a string (from Slack bot), or use as-is if it's an object
  let parsedData = {};
  if (typeof data === 'string' && data.length > 0) {
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      log.warn(`${LOG_PREFIX} Step 1: Could not parse data as JSON: ${e.message}`);
    }
  } else if (data && typeof data === 'object') {
    parsedData = data;
  }

  const limit = parsedData.limit ? Number(parsedData.limit) : undefined;

  log.info(`${LOG_PREFIX} Step 1: importTopPages for site: ${site.getId()}, url: ${finalUrl}${limit ? `, limit: ${limit}` : ''}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  const result = {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    ...(limit && { auditContext: { limit } }),
  };

  log.debug(`${LOG_PREFIX} Step 1: result:`, result);
  return result;
}

/**
 * Builds the scrape payload from a list of source URLs, applying exclusion/inclusion
 * filters, PDF filtering, and deduplication.
 *
 * @param {object} params
 * @param {string[]} params.sourceUrls - Raw source URLs (from top-pages or sitemap)
 * @param {object} params.site - The site object
 * @param {object} params.log - Logger
 * @returns {object} - Scrape payload ready for the scrape client
 */
async function buildScrapePayload({
  sourceUrls, site, log,
}) {
  const auditType = AUDIT_TYPE;
  const includedURLs = await site?.getConfig()?.getIncludedURLs(auditType) || [];
  const excludedURLs = site?.getConfig()?.getExcludedURLs?.(auditType) || [];

  const filteredSourceUrls = sourceUrls.filter((url) => !excludedURLs.includes(url));
  const finalUrls = [...new Set([...filteredSourceUrls, ...includedURLs])];

  if (finalUrls.length === 0) {
    log.error(`${LOG_PREFIX} Step 2: No URLs found for site ${site.getId()} - neither top pages nor included URLs`);
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
      log.debug(`${LOG_PREFIX} Step 2: Skipping PDF: ${url}`);
      return false;
    }
    return true;
  });

  log.info(`${LOG_PREFIX} Step 2: submitting ${filteredUrls.length} URLs (sourceUrls: ${sourceUrls.length}, excludedURLs: ${excludedURLs.length}, includedURLs: ${includedURLs.length}, pdfsFiltered: ${finalUrls.length - filteredUrls.length})`);

  const result = {
    urls: filteredUrls.map((url) => ({ url })),
    siteId: site.getId(),
    jobId: site.getId(),
    processingType: 'default',
    auditContext: {
      scrapeJobId: site.getId(),
    },
    options: {
      waitTimeoutForMetaTags: 5000,
      screenshotTypes: [],
      expandShadowDOM: false,
    },
    allowCache: false,
    maxScrapeAge: 0,
  };

  log.debug(`${LOG_PREFIX} Step 2: output:`, result);
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
    auditContext,
  } = context;

  log.debug(`${LOG_PREFIX} Step 2: input:`, { siteId: site.getId(), auditContext });

  const limit = auditContext?.limit ? Number(auditContext.limit) : undefined;

  log.info(`${LOG_PREFIX} Step 2: submitForScraping for site: ${site.getId()}${limit ? `, limit: ${limit}` : ''}`);

  const { SiteTopPage } = dataAccess;
  const allTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  const topPages = limit ? allTopPages.slice(0, limit) : allTopPages;
  const sourceUrls = topPages.map((page) => page.getUrl());

  return buildScrapePayload({ sourceUrls, site, log });
}

/**
 * Builds scrape entries for category pages that have preFetch config.
 * Category pages (e.g., /sactionals, /sacs, /snugg) don't have SKUs but carry
 * preFetch directives that tell CAS to fetch category-level catalog data.
 * This is currently specific to clients like Lovesac that need category bundle data
 * alongside product enrichment.
 *
 * @param {object} handlerConfig - The site's handler config for this audit type
 * @param {Map} scrapeResultPaths - Map of URL -> S3 path from scrape results
 * @param {object} log - Logger
 * @returns {object[]} Array of scrape entries for category pages
 */
function buildCategoryPageScrapes(handlerConfig, scrapeResultPaths, log) {
  const categoryPages = handlerConfig?.categoryPages || [];
  if (categoryPages.length === 0) {
    return [];
  }

  return categoryPages.reduce((scrapes, categoryPage) => {
    const { url, categoryId, preFetch } = categoryPage;
    if (!url || !categoryId || !preFetch) {
      log.warn(`${LOG_PREFIX} Step 3: Skipping invalid categoryPages entry (missing url, categoryId, or preFetch)`);
      return scrapes;
    }

    const s3Path = scrapeResultPaths?.get(url);
    if (!s3Path) {
      log.warn(`${LOG_PREFIX} Step 3: No scrape result found for category page: ${url}`);
      return scrapes;
    }

    log.info(`${LOG_PREFIX} Step 3: Including category page: ${url} (categoryId: ${categoryId}, preFetch strategies: ${preFetch.length})`);
    scrapes.push({
      sku: categoryId, // SKU is the category ID.
      key: s3Path,
      preFetch,
    });
    return scrapes;
  }, []);
}

async function sendEnrichment(productPages, commerceConfig, site, env, log, {
  categoryPageScrapes = [],
} = {}) {
  const allScrapes = [
    ...productPages.map((page) => {
      const scrape = { sku: page.sku, key: page.location };
      if (page.preFetch) {
        scrape.preFetch = page.preFetch;
      }
      return scrape;
    }),
    ...categoryPageScrapes,
  ];

  if (allScrapes.length === 0 || !commerceConfig) {
    return null;
  }

  const enrichmentEndpoint = env.CATALOG_ENRICHMENT_ENDPOINT;
  if (!enrichmentEndpoint) {
    log.warn(`${LOG_PREFIX} Step 3: CATALOG_ENRICHMENT_ENDPOINT not configured, skipping enrichment`);
    return null;
  }

  const enrichmentPayload = {
    siteId: site.getId(),
    environmentId: commerceConfig.headers['Magento-Environment-Id'],
    websiteCode: commerceConfig.headers['Magento-Website-Code'],
    storeCode: commerceConfig.headers['Magento-Store-Code'],
    storeViewCode: commerceConfig.headers['Magento-Store-View-Code'],
    scrapes: allScrapes,
  };

  log.info(`${LOG_PREFIX} Step 3: Sending enrichment to ${enrichmentEndpoint} with ${enrichmentPayload.scrapes.length} scrapes`);
  log.debug(`${LOG_PREFIX} Step 3: Enrichment payload:`, JSON.stringify(enrichmentPayload));

  const imsClient = ImsClient.createFrom({
    log,
    env: {
      IMS_HOST: env.IMS_HOST,
      IMS_CLIENT_ID: env.IMS_CLIENT_ID,
      IMS_CLIENT_CODE: env.IMS_CLIENT_CODE,
      IMS_CLIENT_SECRET: env.IMS_CLIENT_SECRET,
    },
  });
  let token;
  try {
    token = await imsClient.getServiceAccessToken();
  } catch (imsError) {
    log.error(`${LOG_PREFIX} Step 3: IMS token request failed - host=${env.IMS_HOST}, client_id=${env.IMS_CLIENT_ID}, imsError=${JSON.stringify(imsError)}`);
    throw imsError;
  }

  const response = await fetch(enrichmentEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.access_token}`,
    },
    body: JSON.stringify(enrichmentPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error(`${LOG_PREFIX} Step 3: Enrichment API failed with status ${response.status}: ${errorText}`);
    return { error: `HTTP ${response.status}`, details: errorText };
  }

  const responseData = await response.json();
  log.debug(`${LOG_PREFIX} Step 3: Enrichment API response:`, responseData);
  return responseData;
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
    site, audit, finalUrl, log, scrapeResultPaths, s3Client, env,
  } = context;

  log.debug(`${LOG_PREFIX} Step 3: input:`, {
    siteId: site.getId(),
    auditId: audit.getId(),
    finalUrl,
    scrapeResultPathsSize: scrapeResultPaths?.size || 0,
    envKeys: Object.keys(env),
  });
  log.info(`${LOG_PREFIX} Step 3: processing site: ${site.getId()}, audit: ${audit.getId()}, scrapeResults: ${scrapeResultPaths?.size || 0}`);

  if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
    log.warn(`${LOG_PREFIX} Step 3: No scrape results found for site ${site.getId()}`);
    const earlyResult = {
      auditResult: {
        status: 'NO_OPPORTUNITIES',
        message: 'No scraped content found',
      },
      fullAuditRef: finalUrl,
    };
    log.debug(`${LOG_PREFIX} Step 3: output:`, earlyResult);
    return earlyResult;
  }

  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  if (!bucketName) {
    log.error(`${LOG_PREFIX} Step 3: S3_SCRAPER_BUCKET_NAME not configured`);
    const earlyResult = {
      auditResult: {
        status: 'PROCESSING_FAILED',
        error: 'S3_SCRAPER_BUCKET_NAME not configured',
      },
      fullAuditRef: finalUrl,
    };
    log.debug(`${LOG_PREFIX} Step 3: output:`, earlyResult);
    return earlyResult;
  }

  let commerceConfig = null;
  try {
    commerceConfig = await getCommerceConfig(site, AUDIT_TYPE, finalUrl, log);
    const redactedHeaders = { ...commerceConfig.headers };
    if (redactedHeaders['x-api-key']) {
      redactedHeaders['x-api-key'] = '[REDACTED]';
    }
    log.debug(`${LOG_PREFIX} Step 3: Commerce config:`, { url: commerceConfig.url, headers: redactedHeaders });
  } catch (configError) {
    log.warn(`${LOG_PREFIX} Step 3: Failed to extract commerce config: ${configError.message}`);
  }

  const handlerConfig = site.getConfig()?.getHandlers()?.[AUDIT_TYPE];

  // Process each scraped result in parallel
  const processResults = await Promise.all(
    [...scrapeResultPaths].map(async ([url, s3Path]) => {
      try {
        // Read the scrape.json file from S3
        log.debug(`${LOG_PREFIX} Step 3: Reading scrape data from S3: ${s3Path}`);
        const scrapeData = await getObjectFromKey(s3Client, bucketName, s3Path, log);

        if (!scrapeData) {
          log.warn(`${LOG_PREFIX} Step 3: No scrape data found for: ${url}`);
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
        let sku = null;
        let preFetch = null;

        const Product = scrapeData?.scrapeResult?.structuredData?.jsonld?.Product;
        if (Array.isArray(Product) && Product.length > 0) {
          // Count products with SKU
          skuCount = Product.filter((product) => product.sku).length;
          isProductPage = skuCount === 1;
          // Extract the actual SKU value
          if (isProductPage) {
            sku = Product.find((p) => p.sku)?.sku;
          }

          const categoryProductUrl = Product.find((p) => p.url)?.url;
          const categoryPage = handlerConfig?.categoryPages?.find(
            (cp) => categoryProductUrl && cp.url && categoryProductUrl.includes(cp.url),
          );

          if (categoryPage) {
            preFetch = categoryPage.preFetch;
          }
        }

        log.debug(`${LOG_PREFIX} Step 3: Processed page: ${url} (isProductPage: ${isProductPage})`);

        return {
          success: true,
          url,
          location: s3Path,
          isProductPage,
          skuCount,
          sku,
          preFetch,
        };
      } catch (error) {
        log.error(`${LOG_PREFIX} Step 3: Error processing scrape result for ${url}: ${error.message}`, error);
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

  // Build category page scrapes from handler config
  const categoryPageScrapes = buildCategoryPageScrapes(handlerConfig, scrapeResultPaths, log);

  let enrichmentResponse = null;
  try {
    const opts = { categoryPageScrapes };
    enrichmentResponse = await sendEnrichment(productPages, commerceConfig, site, env, log, opts);
  } catch (enrichmentError) {
    log.error(`${LOG_PREFIX} Step 3: Enrichment API call failed: ${enrichmentError.message}`);
    enrichmentResponse = { error: enrichmentError.message };
  }

  // Persist non-product URLs as excluded for future runs,
  // but skip URLs that are configured as category pages
  const categoryPageUrls = new Set(
    (handlerConfig?.categoryPages || []).map((cp) => cp.url),
  );
  const nonProductUrls = processedPages
    .filter((page) => !page.isProductPage && !categoryPageUrls.has(page.url))
    .map((page) => page.url);

  if (nonProductUrls.length > 0) {
    try {
      const siteConfig = site.getConfig();
      const existingExcluded = siteConfig.getExcludedURLs?.(AUDIT_TYPE) || [];
      const mergedExcluded = [...new Set([...existingExcluded, ...nonProductUrls])]
        .slice(0, MAX_EXCLUDED_URLS);
      siteConfig.updateExcludedURLs(AUDIT_TYPE, mergedExcluded);
      site.setConfig(Config.toDynamoItem(siteConfig));
      await site.save();
      log.info(`${LOG_PREFIX} Step 3: Updated excludedURLs with ${nonProductUrls.length} non-product URLs (total: ${mergedExcluded.length})`);
    } catch (e) {
      log.error(`${LOG_PREFIX} Step 3: Failed to persist excludedURLs: ${e.message}`);
    }
  }

  const totalEnrichmentScrapes = productPages.length + categoryPageScrapes.length;

  log.info(`${LOG_PREFIX} Step 3: completed`, {
    totalScraped: scrapeResultPaths.size,
    processed: processedPages.length,
    failed: failedPages.length,
    productPages: productPages.length,
    categoryPages: categoryPageScrapes.length,
  });

  const result = {
    status: 'complete',
    auditResult: {
      status: totalEnrichmentScrapes > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
      message: `Found ${productPages.length} product pages and ${categoryPageScrapes.length} category pages out of ${processedPages.length} processed pages`,
      totalScraped: scrapeResultPaths.size,
      processedPages: processedPages.length,
      failedPages: failedPages.length,
      productPages: productPages.length,
      categoryPages: categoryPageScrapes.length,
      enrichmentResponse,
    },
    fullAuditRef: finalUrl,
  };

  log.debug(`${LOG_PREFIX} Step 3: output:`, result);
  return result;
}

/**
 * Step 1 (yearly): Discover Sitemap URLs and Submit for Scraping
 * Discovers URLs from the site's sitemaps and builds a scrape payload.
 *
 * @param {object} context - The audit context
 * @returns {object} - Scrape payload with discovered sitemap URLs
 */
export async function discoverSitemapUrlsAndSubmitForScraping(context) {
  const { site, log, data } = context;

  let parsedData = {};
  if (typeof data === 'string' && data.length > 0) {
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
      log.warn(`${LOG_PREFIX} Step 1 (yearly): Could not parse data as JSON: ${e.message}`);
    }
  } else if (data && typeof data === 'object') {
    parsedData = data;
  }

  const limit = parsedData.limit ? Number(parsedData.limit) : undefined;
  const baseURL = site.getBaseURL();

  log.info(`${LOG_PREFIX} Step 1 (yearly): Discovering sitemap URLs for ${baseURL}${limit ? `, limit: ${limit}` : ''}`);

  const sitemapResult = await getSitemapUrls(baseURL, log);

  if (!sitemapResult.success || !sitemapResult.details?.extractedPaths) {
    log.error(`${LOG_PREFIX} Step 1 (yearly): Sitemap discovery failed for ${baseURL}`, sitemapResult.reasons);
    throw new Error(`Sitemap discovery failed: ${sitemapResult.reasons?.map((r) => r.error || r.value).join(', ')}`);
  }

  const allSitemapUrls = Object.values(
    sitemapResult.details.extractedPaths,
  ).flat();
  const sourceUrls = limit ? allSitemapUrls.slice(0, limit) : allSitemapUrls;

  log.info(`${LOG_PREFIX} Step 1 (yearly): Found ${allSitemapUrls.length} URLs from sitemaps, using ${sourceUrls.length}${limit ? ` (limit: ${limit})` : ''}`);

  const scrapePayload = await buildScrapePayload({ sourceUrls, site, log });
  const s3BucketPath = `scrapes/${site.getId()}/`;

  return {
    ...scrapePayload,
    auditResult: {
      status: 'preparing',
      finalUrl: baseURL,
      totalSitemapUrls: allSitemapUrls.length,
    },
    fullAuditRef: s3BucketPath,
  };
}

export const commerceProductEnrichments = new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-process-results', runAuditAndProcessResults)
  .build();

export const commerceProductEnrichmentsYearly = new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('discover-sitemap-urls', discoverSitemapUrlsAndSubmitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-process-results', runAuditAndProcessResults)
  .build();

export default commerceProductEnrichments;
