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
import { runAllChecks } from './checkers/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { DATA_SOURCES } from '../common/constants.js';

const AUDIT_TYPE = 'image-optimization';
const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * Build a unique key for suggestion deduplication
 * @param {Object} data - Suggestion data
 * @returns {string} Unique key
 */
export const buildKey = (data) => `${data.url}|${data.type}|${data.imageSrc}`;

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
  const object = await getObjectFromKey(s3Client, bucketName, key, log);

  if (!object?.imageData || !Array.isArray(object.imageData)) {
    log.warn(`[${AUDIT_TYPE}]: No imageData found in S3 object for ${key}`);
    return null;
  }

  log.info(`[${AUDIT_TYPE}]: Found ${object.imageData.length} images for ${url}`);
  return {
    url: object.finalUrl || url,
    images: object.imageData,
  };
}

/**
 * Process images and generate suggestions
 * @param {Array<Object>} pagesWithImages - Array of page objects with images
 * @param {Object} log - Logger
 * @returns {Array<Object>} Array of suggestions
 */
function processImagesAndGenerateSuggestions(pagesWithImages, log) {
  const allSuggestions = [];

  pagesWithImages.forEach((page) => {
    if (!page || !page.images) {
      return;
    }

    log.info(`[${AUDIT_TYPE}]: Processing ${page.images.length} images from ${page.url}`);

    page.images.forEach((imageData) => {
      try {
        // Run all checkers on the image
        const suggestions = runAllChecks(imageData);

        suggestions.forEach((suggestion) => {
          allSuggestions.push({
            ...suggestion,
            url: page.url,
            imageSrc: imageData.src,
            imageAlt: imageData.alt || '',
            imagePosition: imageData.position,
          });
        });
      } catch (error) {
        log.error(`[${AUDIT_TYPE}]: Error processing image ${imageData.src}: ${error.message}`);
      }
    });
  });

  log.info(`[${AUDIT_TYPE}]: Generated ${allSuggestions.length} total suggestions`);
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
    site, audit, log, scrapeResultPaths, dataAccess, s3Client,
  } = context;
  const { Opportunity } = dataAccess;

  log.info(`[${AUDIT_TYPE}]: scrapeResultPaths for ${site.getId()}: ${JSON.stringify(scrapeResultPaths)}`);
  log.info(`[${AUDIT_TYPE}]: Start runAuditAndGenerateSuggestions step for: ${site.getId()}`);

  // Fetch image data from S3 for all scraped pages
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
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
    log.info(`[${AUDIT_TYPE}]: No pages with image data found for site ${site.getId()}`);
    return {
      status: 'complete',
    };
  }

  // Process images and generate suggestions
  const suggestions = processImagesAndGenerateSuggestions(pagesWithImages, log);

  if (suggestions.length === 0) {
    log.info(`[${AUDIT_TYPE}]: No image optimization suggestions found for site ${site.getId()}`);
    return {
      status: 'complete',
    };
  }

  // Create or find opportunity
  const opportunity = await findOrCreateOpportunity({
    Opportunity,
    siteId: site.getId(),
    auditId: audit.getId(),
    log,
  });

  // Sync suggestions
  await syncSuggestions({
    opportunity,
    newData: suggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: suggestion.type,
      rank: suggestion.severity || 'medium',
      data: { ...suggestion },
    }),
  });

  // Update opportunity data
  const opptyData = opportunity.getData() || {};
  const totalImages = pagesWithImages.reduce(
    (sum, page) => sum + (page.images?.length || 0),
    0,
  );
  opptyData.totalImages = totalImages;
  opptyData.issuesFound = suggestions.length;
  opportunity.setData(opptyData);
  await opportunity.save();

  log.info(`[${AUDIT_TYPE}]: Finish runAuditAndGenerateSuggestions step for: ${site.getId()}`);

  return {
    status: 'complete',
  };
}

// Build and export the audit using the fluent builder pattern
export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
