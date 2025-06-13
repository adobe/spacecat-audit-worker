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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { noopUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import { checkSoft404Indicators, extractTextAndCountWords } from './utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * Makes HTTP request to check current status of URL
 * @param {string} url - URL to check
 * @param {object} log - Logger instance
 * @returns {Promise<object>} - Promise that resolves to object with status,
 *   statusCode, and error info
 */
async function checkUrlStatus(url, log) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      timeout: 10000,
    });

    return Promise.resolve({
      status: 'success',
      statusCode: response.status,
      finalUrl: response.url,
    });
  } catch (error) {
    log.warn(`Failed to check status for ${url}: ${error.message}`);
    return Promise.resolve({
      status: 'error',
      statusCode: null,
      error: error.message,
    });
  }
}

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`Importing top pages for ${finalUrl}`);

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
  const { site, dataAccess, log } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(
    site.getId(),
    'ahrefs',
    'global',
  );

  if (topPages.length === 0) {
    throw new Error('No top pages found for site');
  }
  const topPagesUrls = topPages.map((page) => page.getUrl());
  // Combine includedURLs and topPages URLs to scrape
  const includedURLs = (await site?.getConfig())?.getIncludedURLs('soft-404s') || [];

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(
    `Total top pages: ${topPagesUrls.length}, Total included URLs: ${includedURLs.length}, Final URLs to scrape after removing duplicates: ${finalUrls.length}`,
  );

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'soft404s',
  };
}

export async function fetchAndProcessPageObject(
  s3Client,
  bucketName,
  key,
  prefix,
  log,
) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (
    !object?.scrapeResult?.tags
    || typeof object.scrapeResult.tags !== 'object'
  ) {
    log.error(`No Scraped tags found in S3 ${key} object`);
    return null;
  }
  let pageUrl = object.finalUrl
    ? new URL(object.finalUrl).pathname
    : key.slice(prefix.length - 1).replace('/scrape.json', ''); // Remove the prefix and scrape.json suffix
  // handling for homepage
  if (pageUrl === '') {
    pageUrl = '/';
  }
  return {
    [pageUrl]: {
      rawBody: object.scrapeResult.rawBody,
      finalUrl: object.finalUrl,
    },
  };
}

export async function soft404sAutoDetect(site, pagesSet, context) {
  const { log, s3Client } = context;
  // Fetch site's scraped content from S3
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;
  const scrapedObjectKeys = await getObjectKeysUsingPrefix(
    s3Client,
    bucketName,
    prefix,
    log,
  );

  log.info(`Scraped object keys: ${scrapedObjectKeys}`);

  const pageMetadataResults = await Promise.all(
    scrapedObjectKeys
      .filter((key) => pagesSet.has(key))
      .map((key) => fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log)),
  );

  log.info(`Page metadata results: ${pageMetadataResults.length} pages processed`);

  const soft404Results = {};
  const urlStatusChecks = [];

  // Process each page for soft 404 detection
  for (const pageMetadata of pageMetadataResults) {
    if (pageMetadata) {
      const pageUrl = Object.keys(pageMetadata)[0];
      const pageData = pageMetadata[pageUrl];

      log.info(`Page ${pageUrl} has ${pageData.rawBody} raw body`);

      if (pageData.rawBody && pageData.finalUrl) {
        // Extract text content and count words
        const { textContent, wordCount } = extractTextAndCountWords(pageData.rawBody);

        // Check for soft 404 indicators
        const matchedIndicators = checkSoft404Indicators(textContent);

        // Check if this might be a soft 404 based on content analysis
        const hasSoft404Indicators = matchedIndicators.length > 0;
        const hasLowWordCount = wordCount < 500;

        log.info(`Page ${pageUrl} has ${wordCount} words and ${matchedIndicators.length} soft 404 indicators`);
        log.info(`Text content: ${textContent}`);

        if (hasSoft404Indicators && hasLowWordCount) {
          // Add to URL status check queue
          urlStatusChecks.push({
            pageUrl,
            finalUrl: pageData.finalUrl,
            matchedIndicators,
            wordCount,
            textContent: textContent.substring(0, 200), // First 200 chars for context
          });
        }
      } else {
        log.warn(`Missing rawBody or finalUrl for page: ${Object.keys(pageMetadata)[0]}`);
      }
    }
  }

  log.info(`Found ${urlStatusChecks.length} potential soft 404 pages to verify`);

  // Check current HTTP status for potential soft 404 pages using Promise.allSettled
  // This ensures all requests complete even if some individual requests fail
  const statusCheckPromises = urlStatusChecks.map(async (page) => {
    const statusResult = await checkUrlStatus(page.finalUrl, log);

    // Only consider it a soft 404 if:
    // 1. HTTP status is 200 (OK)
    // 2. Content has soft 404 indicators
    // 3. Content has low word count
    if (statusResult.statusCode === 200) {
      return {
        pageUrl: page.pageUrl,
        finalUrl: page.finalUrl,
        isSoft404: true,
        statusCode: statusResult.statusCode,
        matchedIndicators: page.matchedIndicators,
        wordCount: page.wordCount,
        textPreview: page.textContent,
        detectedAt: new Date().toISOString(),
      };
    }

    return null;
  });

  const allSettledResults = await Promise.allSettled(statusCheckPromises);

  // Process results from Promise.allSettled
  const statusResults = allSettledResults
    .filter((result) => result.status === 'fulfilled' && result.value !== null)
    .map((result) => result.value);

  // Build final results object
  statusResults.forEach((result) => {
    soft404Results[result.pageUrl] = {
      finalUrl: result.finalUrl,
      isSoft404: result.isSoft404,
      statusCode: result.statusCode,
      matchedIndicators: result.matchedIndicators,
      wordCount: result.wordCount,
      textPreview: result.textPreview,
      detectedAt: result.detectedAt,
    };
  });

  const detectedCount = Object.keys(soft404Results).length;
  log.info(`Detected ${detectedCount} soft 404 pages out of ${pageMetadataResults.length} total pages`);

  return soft404Results;
}

/**
 * Transforms a URL into a scrape.json path for a given site
 * @param {string} url - The URL to transform
 * @param {string} siteId - The site ID
 * @returns {string} The path to the scrape.json file
 */
function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

export async function soft404sAuditRunner(context) {
  const {
    site,
    log,
    dataAccess,
    baseURL,
  } = context;

  const siteId = site.getId();

  log.info(`Starting Soft404s Audit with siteId: ${JSON.stringify(siteId)}`);

  try {
    // Get top pages for a site
    const topPages = await getTopPagesForSiteId(
      dataAccess,
      siteId,
      context,
      log,
    );
    const includedURLs = (await site?.getConfig())?.getIncludedURLs('soft-404s') || [];

    // Transform URLs into scrape.json paths and combine them into a Set
    const topPagePaths = topPages.map((page) => getScrapeJsonPath(page.url, siteId));
    const includedUrlPaths = includedURLs.map((url) => getScrapeJsonPath(url, siteId));
    const totalPagesSet = new Set([...topPagePaths, ...includedUrlPaths]);

    log.info(
      `Received topPages: ${topPagePaths.length}, includedURLs: ${includedUrlPaths.length}, totalPages to process after removing duplicates: ${totalPagesSet.size}`,
    );

    const soft404Results = await soft404sAutoDetect(site, totalPagesSet, context);

    return {
      auditResult: {
        soft404Pages: soft404Results,
        totalPagesChecked: totalPagesSet.size,
        soft404Count: Object.keys(soft404Results).length,
        success: true,
      },
      fullAuditRef: baseURL,
    };
  } catch (error) {
    return {
      fullAuditRef: baseURL,
      auditResult: {
        error: `Audit failed with error: ${error.message}`,
        success: false,
      },
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('soft404s-audit-runner', soft404sAuditRunner)
  .build();
