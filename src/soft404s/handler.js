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
import { AuditBuilder } from '../common/audit-builder.js';
import { findSitemap } from '../sitemap/handler.js';
import {
  getObjectFromKey,
  getObjectKeysUsingPrefix,
} from '../utils/s3-utils.js';
import {
  checkSoft404Indicators,
  extractTextAndCountWords,
  isNonHtmlFile,
} from './utils.js';

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

/**
 * Imports top pages for a site
 * @param {object} context - Context object containing site, finalUrl, and log
 * @returns {Promise<object>} - Promise that resolves to object with type, siteId,
 *   auditResult, fullAuditRef, and finalUrl
 */
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
  const { site, log } = context;

  log.info(`Submitting for scraping for site ${site.getId()}`);
  // Get the base URL for the site
  const baseURL = site.getBaseURL();

  const sitemapResult = await findSitemap(baseURL);

  if (!sitemapResult.success) {
    throw new Error(`Failed to find sitemap for ${baseURL}: ${sitemapResult.reasons.map((r) => r.error || r.value).join(', ')}`);
  }

  // Extract all URLs from sitemaps using Object.values().flat()
  const sitemapUrls = Object.values(sitemapResult.extractedPaths || {}).flat();

  if (sitemapUrls.length === 0) {
    throw new Error('No URLs found in sitemaps');
  }

  // Combine sitemap URLs and included URLs to scrape
  const includedURLs = (await site?.getConfig())?.getIncludedURLs('soft-404s') || [];

  // Filter out non-HTML files from both sitemap URLs and included URLs
  const filteredSitemapUrls = sitemapUrls.filter(
    (url) => !isNonHtmlFile(url),
  );
  const filteredIncludedUrls = includedURLs.filter(
    (url) => !isNonHtmlFile(url),
  );

  const finalUrls = [
    ...new Set([...filteredSitemapUrls, ...filteredIncludedUrls]),
  ];

  log.info(
    `Total sitemap URLs: ${sitemapUrls.length}, Total included URLs: ${includedURLs.length}, `
      + `Filtered sitemap URLs: ${filteredSitemapUrls.length}, Filtered included URLs: ${filteredIncludedUrls.length}, `
      + `Final URLs to scrape after removing duplicates: ${finalUrls.length}`,
  );

  log.info(`Final URLs to scrape: ${finalUrls}`);

  return {
    urls: finalUrls.map((url) => ({ url })).slice(0, 20),
    siteId: site.getId(),
    type: 'soft-404s',
    fullAuditRef: baseURL,
    auditResult: { status: 'preparing', finalUrlsToScrape: finalUrls.length },
    url: baseURL,
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

  const pageMetadataResults = await Promise.all(
    scrapedObjectKeys
      .filter((key) => pagesSet.has(key))
      .map((key) => fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log)),
  );

  log.info(
    `Page metadata results: ${pageMetadataResults.length} pages processed`,
  );

  const soft404Results = {};
  const urlStatusChecks = [];

  // Process each page for soft 404 detection
  for (const pageMetadata of pageMetadataResults) {
    if (pageMetadata) {
      const pageUrl = Object.keys(pageMetadata)[0];
      const pageData = pageMetadata[pageUrl];

      if (pageData.rawBody && pageData.finalUrl) {
        // Extract text content and count words
        const { textContent, wordCount, cleanHTML } = extractTextAndCountWords(
          pageData.rawBody,
        );

        // Count images in the page
        const imageCount = (cleanHTML.match(/<img[^>]+>/g) || []).length;

        // Check for soft 404 indicators
        const matchedIndicators = checkSoft404Indicators(textContent);

        // Determine if this might be a soft 404 based on content analysis
        const hasSoft404Indicators = matchedIndicators.length > 0;
        const hasLowWordCount = wordCount < 500;
        const isEmptyPage = wordCount === 0;

        // A page is considered a potential soft 404 if:
        // 1. It's completely empty (0 words), OR
        // 2. It has soft 404 indicators AND low word count (< 500 words)
        // This prevents false positives for legitimate pages like login screens
        const isPotentialSoft404 = isEmptyPage
          || (hasSoft404Indicators && hasLowWordCount);

        if (isPotentialSoft404) {
          // Add to URL status check queue
          urlStatusChecks.push({
            pageUrl,
            finalUrl: pageData.finalUrl,
            matchedIndicators,
            wordCount,
            imageCount,
            textContent,
          });
        }
      } else {
        log.warn(
          `Missing rawBody or finalUrl for page: ${
            Object.keys(pageMetadata)[0]
          }`,
        );
      }
    }
  }

  log.info(
    `Found ${urlStatusChecks.length} potential soft 404 pages to verify`,
  );

  // Check current HTTP status for potential soft 404 pages using Promise.allSettled
  // This ensures all requests complete even if some individual requests fail
  const statusCheckPromises = urlStatusChecks.map(async (page) => {
    const statusResult = await checkUrlStatus(page.finalUrl, log);

    // A page is considered a soft 404 if:
    // 1. HTTP status is 200 (OK)
    // 2. AND either:
    //    a. It's completely empty (0 words), OR
    //    b. Has soft 404 indicators AND low word count (< 500 words)
    if (statusResult.statusCode === 200) {
      return {
        pageUrl: page.pageUrl,
        finalUrl: page.finalUrl,
        isSoft404: true,
        statusCode: statusResult.statusCode,
        matchedIndicators: page.matchedIndicators,
        wordCount: page.wordCount,
        imageCount: page.imageCount,
        textPreview: page.textContent,
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
      imageCount: result.imageCount,
      textPreview: result.textPreview,
    };
  });

  const detectedCount = Object.keys(soft404Results).length;
  log.info(
    `Detected ${detectedCount} soft 404 pages out of ${pageMetadataResults.length} total pages`,
  );

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
    site, log, dataAccess, baseURL, job, audit,
  } = context;

  const siteId = site.getId();

  log.info(`Starting Soft404s Audit with siteId: ${JSON.stringify(siteId)}`);

  try {
    // Get top pages for a site
    // const topPages = await getTopPagesForSiteId(
    //   dataAccess,
    //   siteId,
    //   context,
    //   log,
    // );
    // const includedURLs = (await site?.getConfig())?.getIncludedURLs('soft-404s') || [];

    // // Transform URLs into scrape.json paths and combine them into a Set
    // const topPagePaths = topPages.map((page) => getScrapeJsonPath(page.url, siteId));
    // const includedUrlPaths = includedURLs.map((url) => getScrapeJsonPath(url, siteId));
    // const totalPagesSet = new Set([...topPagePaths, ...includedUrlPaths]);

    log.info('audit context', audit);
    log.info('audit.auditResult', audit.getAuditResult());
    const { urls } = audit.getAuditResult();

    log.info('job', job);
    log.info('finalUrlsToScrape', urls);

    const totalPagesSet = new Set(urls.map((url) => getScrapeJsonPath(url, siteId)));

    log.info(
      `Received finalUrlsToScrape: ${urls.length}, totalPages to process after removing duplicates: ${totalPagesSet.size}`,
    );

    const soft404Results = await soft404sAutoDetect(
      site,
      totalPagesSet,
      context,
    );

    /** store the soft404 audit result in dynamo db */

    const { Audit: AuditDataAccess } = dataAccess;

    const auditResult = {
      soft404Pages: soft404Results,
      totalPagesChecked: totalPagesSet.size,
      soft404Count: Object.keys(soft404Results).length,
      success: true,
    };

    const s3BucketPath = `scrapes/${site.getId()}/`;

    // save the soft404 audit result in db
    await AuditDataAccess.create({
      siteId: site.getId(),
      isLive: site.getIsLive(),
      auditedAt: new Date().toISOString(),
      auditType: 'soft-404s',
      auditResult,
      fullAuditRef: s3BucketPath,
    });

    log.info('Soft404s audit result successfully saved in the db');

    return {
      auditResult,
      fullAuditRef: s3BucketPath,
    };
  } catch (error) {
    log.error(`Soft-404s audit failed for ${baseURL}`, error);
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
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('soft404s-audit-runner', soft404sAuditRunner)
  .build();
