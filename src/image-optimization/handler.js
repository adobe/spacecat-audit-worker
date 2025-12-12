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

import crypto from 'crypto';
// import { Audit } from '@adobe/spacecat-shared-data-access'; // Uncomment for full pipeline
import { AuditBuilder } from '../common/audit-builder.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import { runAllChecks } from './checkers/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { DATA_SOURCES } from '../common/constants.js';
import { DYNAMIC_MEDIA_PATTERNS } from './constants.js';
import { batchVerifyNonDmFormats } from './non-dm-format-verifier.js';

/**
 * Checks if a URL belongs to Adobe Dynamic Media
 * @param {string} url - Image URL to check
 * @returns {boolean} True if the URL is a Dynamic Media URL
 */
function isDynamicMedia(url) {
  if (!url) return false;
  return DYNAMIC_MEDIA_PATTERNS.some((pattern) => pattern.test(url));
}

const AUDIT_TYPE = 'image-optimization';
// const { AUDIT_STEP_DESTINATIONS } = Audit; // Uncomment for full pipeline

/**
 * Build a unique key for suggestion deduplication
 * @param {Object} data - Suggestion data
 * @returns {string} Unique key
 */
export const buildKey = (data) => `${data.url}|${data.type}|${data.imageSrc}`;

/**
 * Sanitize numeric values to ensure DynamoDB compatibility
 * Replaces Infinity and NaN with null
 * @param {*} value - Value to sanitize
 * @returns {*} Sanitized value
 */
function sanitizeNumericValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null; // Replace Infinity and NaN with null
    }
  }
  return value;
}

/**
 * Recursively sanitize an object's numeric values
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized object
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    Object.keys(obj).forEach((key) => {
      sanitized[key] = sanitizeObject(obj[key]);
    });
    return sanitized;
  }

  return sanitizeNumericValue(obj);
}

/**
 * Map checker types to valid Suggestion types
 * @param {string} checkerType - Type from checker (e.g., 'oversized-image')
 * @returns {string} Valid suggestion type
 */
function mapCheckerTypeToSuggestionType(checkerType) {
  const typeMapping = {
    'oversized-image': 'CONTENT_UPDATE',
    'upscaled-image': 'CONTENT_UPDATE',
    'blurry-image': 'CONTENT_UPDATE',
    'wrong-file-type': 'CONTENT_UPDATE',
    'format-detection': 'CONTENT_UPDATE',
    'non-dm-format-verified': 'CONTENT_UPDATE',
    'missing-dimensions': 'CODE_CHANGE',
    'missing-lazy-loading': 'CODE_CHANGE',
    'responsive-images': 'CODE_CHANGE',
    'picture-element': 'CODE_CHANGE',
    'svg-opportunity': 'CONTENT_UPDATE',
    'cdn-delivery': 'CONFIG_UPDATE',
    'cache-control': 'CONFIG_UPDATE',
  };

  return typeMapping[checkerType] || 'CONTENT_UPDATE';
}

/**
 * Map severity string to numeric rank
 * @param {string} severity - Severity level ('high', 'medium', 'low')
 * @returns {number} Numeric rank
 */
function mapSeverityToRank(severity) {
  const rankMap = {
    high: 100,
    medium: 50,
    low: 25,
  };

  return rankMap[severity] || 50; // Default to medium
}

/**
 * Fetch and process a scraped page object from S3
 * @param {Object} s3Client - S3 client
 * @param {string} bucketName - S3 bucket name
 * @param {string} url - Page URL
 * @param {string} key - S3 object key
 * @param {Object} log - Logger
 * @returns {Promise<Object|null>} Processed image data or null
 */
export async function fetchAndProcessPageImages(s3Client, bucketName, url, key, log) {
  log.info(`[${AUDIT_TYPE}]: Fetching S3 object: bucket=${bucketName}, key=${key}, url=${url}`);

  const object = await getObjectFromKey(s3Client, bucketName, key, log);

  if (!object) {
    log.warn(`[${AUDIT_TYPE}]: S3 object not found for key: ${key}`);
    return null;
  }

  if (!object?.imageData || !Array.isArray(object.imageData)) {
    log.warn(`[${AUDIT_TYPE}]: No imageData found in S3 object for ${key}. Object keys: ${Object.keys(object || {}).join(', ')}`);
    return null;
  }

  log.info(`[${AUDIT_TYPE}]: Successfully fetched ${object.imageData.length} images for ${url}`);
  return {
    url: object.finalUrl || url,
    images: object.imageData,
  };
}

/**
 * Process images and generate suggestions
 * For DM images: runs all checkers (includes DM format verification via HEAD requests)
 * For non-DM images: runs all checkers + Scene7 Snapshot upload API for format verification
 * @param {Array<Object>} pagesWithImages - Array of page objects with images
 * @param {Object} log - Logger
 * @returns {Promise<Array<Object>>} Array of suggestions
 */
async function processImagesAndGenerateSuggestions(pagesWithImages, log) {
  log.info(`[${AUDIT_TYPE}]: Starting to process ${pagesWithImages.length} pages`);
  const allSuggestions = [];
  const nonDmImagesForVerification = [];
  let totalImagesProcessed = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (const page of pagesWithImages) {
    if (!page || !page.images) {
      log.warn(`[${AUDIT_TYPE}]: Skipping page with no images: ${page?.url || 'unknown'}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    log.info(`[${AUDIT_TYPE}]: Processing ${page.images.length} images from ${page.url}`);

    // eslint-disable-next-line no-restricted-syntax
    for (const imageData of page.images) {
      try {
        totalImagesProcessed += 1;
        const isImageDm = isDynamicMedia(imageData.src);
        imageData.isDynamicMedia = isImageDm;

        log.debug(`[${AUDIT_TYPE}]: Analyzing image ${totalImagesProcessed}: ${imageData.src} (DM: ${isImageDm})`);

        // For DM images: run all checkers (includes format verification via HEAD requests)
        // For non-DM images: run all checkers EXCEPT format (format will be verified via Scene7)
        const enabledChecks = isImageDm
          ? null // Run all checkers for DM
          : ['oversized', 'responsive', 'picture', 'dimensions', 'lazy-loading', 'file-type', 'svg', 'upscaled'];

        // eslint-disable-next-line no-await-in-loop
        const suggestions = await runAllChecks(imageData, enabledChecks, log);

        if (suggestions.length > 0) {
          log.debug(`[${AUDIT_TYPE}]: Found ${suggestions.length} issues for image: ${imageData.src}`);
        }

        suggestions.forEach((suggestion) => {
          allSuggestions.push({
            ...suggestion,
            url: page.url,
            imageSrc: imageData.src,
            imageAlt: imageData.alt || '',
            imagePosition: imageData.position,
          });
        });

        // Collect non-DM images for Scene7 format verification
        if (!isImageDm) {
          nonDmImagesForVerification.push({
            src: imageData.src,
            pageUrl: page.url,
            alt: imageData.alt,
            naturalWidth: imageData.naturalWidth,
            naturalHeight: imageData.naturalHeight,
          });
        }
      } catch (error) {
        log.error(`[${AUDIT_TYPE}]: Error processing image ${imageData.src}: ${error.message}`, { error });
      }
    }

    log.info(`[${AUDIT_TYPE}]: Completed processing page ${page.url}. Current total suggestions: ${allSuggestions.length}`);
  }

  // Verify non-DM images using Scene7 Snapshot upload API
  if (nonDmImagesForVerification.length > 0) {
    log.info(`[${AUDIT_TYPE}]: Verifying ${nonDmImagesForVerification.length} non-DM images via Scene7 Snapshot...`);
    try {
      const nonDmResults = await batchVerifyNonDmFormats(nonDmImagesForVerification, log, {
        concurrency: 2,
      });

      // Add verified non-DM format suggestions
      nonDmResults.forEach((result) => {
        if (result.success && result.recommendations && result.recommendations.length > 0) {
          const rec = result.recommendations[0];
          allSuggestions.push({
            type: 'non-dm-format-verified',
            severity: rec.savingsPercent > 50 ? 'high' : 'medium',
            impact: rec.savingsPercent > 50 ? 'high' : 'medium',
            title: `Convert to ${rec.recommendedFormat?.toUpperCase() || 'AVIF'}`,
            description: `Scene7 format comparison shows ${rec.recommendedFormat?.toUpperCase()} is optimal.`,
            recommendation: rec.message,
            url: result.pageUrl,
            imageSrc: result.originalUrl,
            imageAlt: result.alt || '',
            verified: true,
            currentFormat: rec.currentFormat,
            recommendedFormat: rec.recommendedFormat,
            currentSize: rec.currentSize,
            projectedSize: rec.recommendedSize,
            savingsBytes: rec.savingsBytes,
            savingsPercent: rec.savingsPercent,
            previewUrl: result.previewUrl,
            previewExpiry: result.previewExpiry,
            formatComparison: result.formats,
          });
        }
      });

      const successCount = nonDmResults.filter((r) => r.success).length;
      const withRecs = nonDmResults.filter(
        (r) => r.success && r.recommendations?.length > 0,
      ).length;
      log.info(`[${AUDIT_TYPE}]: ✅ Non-DM verification complete: ${successCount} successful, ${withRecs} with recommendations`);
    } catch (nonDmError) {
      log.warn(`[${AUDIT_TYPE}]: ⚠️ Non-DM verification failed: ${nonDmError.message}`);
    }
  }

  log.info(`[${AUDIT_TYPE}]: Processed ${totalImagesProcessed} images and generated ${allSuggestions.length} total suggestions`);
  return allSuggestions;
}

/**
 * Create or find opportunity for image optimization
 * @param {Object} params - Parameters
 * @returns {Promise<Object>} Opportunity
 */
async function findOrCreateOpportunity({
  Opportunity, siteId, auditId, log,
}) {
  log.info(`[${AUDIT_TYPE}]: Finding or creating opportunity for site ${siteId}`);

  const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
  let imageOptOppty = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);

  if (!imageOptOppty) {
    const opportunityDTO = {
      siteId,
      auditId,
      runbook: 'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
      type: AUDIT_TYPE,
      origin: 'AUTOMATION',
      title: 'Images can be optimized for better performance',
      description: 'Optimizing images through format conversion, proper sizing, and lazy loading can significantly improve page load times and Core Web Vitals',
      guidance: {
        recommendations: [
          {
            insight: 'Modern image formats and proper sizing improve performance',
            recommendation: 'Enable AVIF/WebP formats, ensure proper image dimensions, and implement lazy loading',
            type: null,
            rationale: 'Optimized images reduce bandwidth, improve load times, and enhance user experience',
          },
        ],
      },
      data: {
        totalImages: 0,
        issuesFound: 0,
        dataSources: [DATA_SOURCES.SITE],
      },
      tags: ['performance', 'core-web-vitals', 'images'],
    };

    imageOptOppty = await Opportunity.create(opportunityDTO);
    log.info(`[${AUDIT_TYPE}]: Created new opportunity: ${imageOptOppty.getId()}`);
  }

  return imageOptOppty;
}

/**
 * Import top pages step - requests scraping
 * @param {Object} context - Context object
 * @returns {Promise<Object>} Import request
 */
export async function importTopPages(context) {
  const { site, log, finalUrl } = context;
  const s3BucketPath = `scrapes/${site.getId()}/`;

  log.info(`[${AUDIT_TYPE}]: importTopPages step requested scraping for ${site.getId()}, bucket path: ${s3BucketPath}`);

  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
  };
}

/**
 * Submit URLs for scraping
 * @param {Object} context - Context object
 * @returns {Promise<Object>} Scrape request
 */
export async function submitForScraping(context) {
  const { site, dataAccess, log } = context;
  const { SiteTopPage } = dataAccess;

  log.info(`[${AUDIT_TYPE}]: Start submitForScraping step for: ${site.getId()}`);

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  const topPagesUrls = topPages.map((page) => page.getUrl());

  // Combine includedURLs and topPages URLs to scrape
  const includedURLs = await site?.getConfig()?.getIncludedURLs(AUDIT_TYPE) || [];
  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];

  log.debug(`[${AUDIT_TYPE}]: Total top pages: ${topPagesUrls.length}, included URLs: ${includedURLs.length}, final URLs: ${finalUrls.length}`);

  if (finalUrls.length === 0) {
    throw new Error(`No URLs found for site ${site.getId()}`);
  }

  log.info(`[${AUDIT_TYPE}]: Finish submitForScraping step for: ${site.getId()}`);

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'image-analysis',
    allowCache: false,
    maxScrapeAge: 0,
    options: {
      includeImageData: true,
    },
  };
}

/**
 * Run audit and generate suggestions
 * @param {Object} context - Context object
 * @returns {Promise<Object>} Audit result
 */
export async function runAuditAndGenerateSuggestions(context) {
  const {
    site, audit, log, dataAccess, s3Client,
  } = context;
  let { scrapeResultPaths } = context;
  const { Opportunity } = dataAccess;

  log.info(`[${AUDIT_TYPE}]: scrapeResultPaths for ${site.getId()}: ${JSON.stringify(scrapeResultPaths)}`);
  log.info(`[${AUDIT_TYPE}]: Start runAuditAndGenerateSuggestions step for: ${site.getId()}`);

  // Fetch image data from S3 for all scraped pages
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;

  // If scrapeResultPaths is not provided, list S3 objects directly
  if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
    log.info(`[${AUDIT_TYPE}]: No scrapeResultPaths from scrapeClient, listing S3 objects directly...`);
    const prefix = `scrapes/${site.getId()}/`;
    log.info(`[${AUDIT_TYPE}]: Listing S3 objects with prefix: ${prefix}`);

    const objectKeys = await getObjectKeysUsingPrefix(
      s3Client,
      bucketName,
      prefix,
      log,
      1000,
      'scrape.json',
    );

    log.info(`[${AUDIT_TYPE}]: Found ${objectKeys.length} scrape.json files in S3`);

    if (objectKeys.length === 0) {
      log.warn(`[${AUDIT_TYPE}]: No scrape.json files found in S3 for site ${site.getId()}`);
      return {
        auditResult: {
          status: 'NO_DATA',
          message: `No scraped data found in S3 at ${prefix}`,
        },
        fullAuditRef: site.getBaseURL(),
      };
    }

    // Build scrapeResultPaths Map from S3 keys
    // Extract URL from path: scrapes/{siteId}/{page-path}/scrape.json -> {page-path}
    scrapeResultPaths = new Map();
    objectKeys.forEach((key) => {
      // Remove prefix and /scrape.json suffix to get the page path
      const pagePath = key.replace(prefix, '').replace('/scrape.json', '');
      // Reconstruct URL (you may need to adjust this based on your site's URL structure)
      const pageUrl = `${site.getBaseURL()}/${pagePath}`;
      scrapeResultPaths.set(pageUrl, key);
    });

    log.info(`[${AUDIT_TYPE}]: Built scrapeResultPaths Map with ${scrapeResultPaths.size} entries`);
  }

  const pagesWithImagesResults = await Promise.all(
    [...scrapeResultPaths].map(([url, path]) => fetchAndProcessPageImages(
      s3Client,
      bucketName,
      url,
      path,
      log,
    )),
  );

  const pagesWithImages = pagesWithImagesResults.filter((page) => page !== null);

  if (pagesWithImages.length === 0) {
    log.error(`[${AUDIT_TYPE}]: Failed to extract image data from scraped content for bucket ${bucketName}`);
  }

  // Process images and generate suggestions
  log.info(`[${AUDIT_TYPE}]: Starting image analysis and suggestion generation...`);
  const suggestions = await processImagesAndGenerateSuggestions(pagesWithImages, log);

  if (suggestions.length === 0) {
    log.info(`[${AUDIT_TYPE}]: No image optimization suggestions found for site ${site.getId()}`);
    log.info(`[${AUDIT_TYPE}]: Returning early with COMPLETE status (no issues found).`);
    return {
      auditResult: {
        status: 'COMPLETE',
        totalImages: pagesWithImages.reduce((sum, page) => sum + (page.images?.length || 0), 0),
        issuesFound: 0,
        message: 'No optimization opportunities found.',
      },
      fullAuditRef: site.getBaseURL(),
    };
  }

  log.info(`[${AUDIT_TYPE}]: Creating or finding opportunity for site ${site.getId()}...`);
  // Create or find opportunity
  const opportunity = await findOrCreateOpportunity({
    Opportunity,
    siteId: site.getId(),
    auditId: audit?.getId() || crypto.randomUUID(),
    log,
  });
  log.info(`[${AUDIT_TYPE}]: Opportunity ID: ${opportunity.getId()}`);

  // Sync suggestions
  log.info(`[${AUDIT_TYPE}]: Syncing ${suggestions.length} suggestions to database...`);

  // Sanitize suggestions to remove Infinity/NaN values that DynamoDB cannot store
  const sanitizedSuggestions = suggestions.map(sanitizeObject);

  const syncResult = await syncSuggestions({
    opportunity,
    newData: sanitizedSuggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: mapCheckerTypeToSuggestionType(suggestion.type),
      rank: mapSeverityToRank(suggestion.severity),
      data: {
        ...suggestion,
        checkerType: suggestion.type, // Preserve original checker type in data
      },
    }),
  });
  log.info(`[${AUDIT_TYPE}]: Suggestion sync complete. Created: ${syncResult?.created || 0}, Updated: ${syncResult?.updated || 0}, Deleted: ${syncResult?.deleted || 0}`);

  // Update opportunity data
  const opptyData = opportunity.getData() || {};
  const totalImages = pagesWithImages.reduce(
    (sum, page) => sum + (page.images?.length || 0),
    0,
  );
  opptyData.totalImages = totalImages;
  opptyData.issuesFound = suggestions.length;
  opportunity.setData(opptyData);

  log.info(`[${AUDIT_TYPE}]: Updating opportunity with final metrics: totalImages=${totalImages}, issuesFound=${suggestions.length}`);
  await opportunity.save();

  log.info(`[${AUDIT_TYPE}]: ========== Image Optimization Audit Complete ==========`);
  log.info(`[${AUDIT_TYPE}]: Total images analyzed: ${totalImages}`);
  log.info(`[${AUDIT_TYPE}]: Issues found: ${suggestions.length}`);
  log.info(`[${AUDIT_TYPE}]: Opportunity ID: ${opportunity.getId()}`);

  return {
    auditResult: {
      status: 'COMPLETE',
      totalImages,
      issuesFound: suggestions.length,
      message: `Analyzed ${totalImages} images and found ${suggestions.length} optimization opportunities`,
    },
    fullAuditRef: site.getBaseURL(),
  };
}

// Build and export the audit using the fluent builder pattern
export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  // STEPS 1 & 2: Handled by external workers (import-worker and scrape-client)
  // Uncomment these lines to enable the full pipeline in production:
  // .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  // .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  // STEP 3: Run analysis on scraped data from S3
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
