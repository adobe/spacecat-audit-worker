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

/**
 * SIMPLE RUNNER VERSION - For testing with existing S3 data
 * This version processes already-scraped imageData from S3
 * Does NOT trigger scraping - assumes data already exists
 */

import { AuditBuilder } from '../common/audit-builder.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { runAllChecks } from './checkers/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { DATA_SOURCES } from '../common/constants.js';

const AUDIT_TYPE = 'image-optimization';

export const buildKey = (data) => `${data.url}|${data.type}|${data.imageSrc}`;

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

function processImagesAndGenerateSuggestions(pagesWithImages, log) {
  const allSuggestions = [];

  pagesWithImages.forEach((page) => {
    if (!page || !page.images) {
      return;
    }

    log.info(`[${AUDIT_TYPE}]: Processing ${page.images.length} images from ${page.url}`);

    page.images.forEach((imageData) => {
      try {
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
 * Simple runner - processes existing scraped data from S3
 * NO scraping orchestration - just analysis
 */
export async function imageOptimizationSimpleRunner(baseURL, context, site) {
  const { log, dataAccess, s3Client } = context;
  const siteId = site.getId();

  log.info(`[${AUDIT_TYPE}]: Starting simple runner for site ${siteId}`);

  try {
    const { Opportunity, SiteTopPage, Audit } = dataAccess;
    const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;

    // Create audit
    const audit = await Audit.create({
      siteId,
      auditType: AUDIT_TYPE,
      auditedAt: new Date().toISOString(),
      fullAuditRef: baseURL,
      isLive: true,
      auditResult: { status: 'processing' },
    });

    // Get top pages to find their scraped data
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    const topPageUrls = topPages.map((page) => page.getUrl());

    // Build S3 keys for scraped data
    // S3 structure: scrapes/{siteId}/{path}/scrape.json
    const scrapeResultPaths = new Map();
    topPageUrls.forEach((url) => {
      const urlObj = new URL(url);
      let pathname = urlObj.pathname.replace(/^\//, '').replace(/\/$/, '');

      // Handle homepage
      if (!pathname) {
        pathname = 'index.html';
      }

      // S3 key structure: scrapes/{siteId}/{path}/scrape.json
      const s3Key = `scrapes/${siteId}/${pathname}/scrape.json`;
      scrapeResultPaths.set(url, s3Key);
      log.debug(`[${AUDIT_TYPE}]: Mapped ${url} -> ${s3Key}`);
    });

    log.info(`[${AUDIT_TYPE}]: Looking for ${scrapeResultPaths.size} scraped pages in S3`);

    // Fetch and process images
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
      log.warn(`[${AUDIT_TYPE}]: No scraped image data found in S3`);
      return {
        fullAuditRef: baseURL,
        auditResult: {
          status: 'completed',
          message: 'No scraped image data found - run scraping first',
        },
      };
    }

    // Generate suggestions
    const suggestions = processImagesAndGenerateSuggestions(pagesWithImages, log);

    if (suggestions.length === 0) {
      return {
        fullAuditRef: baseURL,
        auditResult: {
          status: 'completed',
          message: 'No optimization suggestions found',
        },
      };
    }

    // Create opportunity and sync suggestions
    const opportunity = await findOrCreateOpportunity({
      Opportunity,
      siteId,
      auditId: audit.getId(),
      log,
    });

    await syncSuggestions({
      opportunity,
      newData: suggestions,
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

    // Update opportunity metrics
    const opptyData = opportunity.getData() || {};
    const totalImages = pagesWithImages.reduce(
      (sum, page) => sum + (page.images?.length || 0),
      0,
    );
    opptyData.totalImages = totalImages;
    opptyData.issuesFound = suggestions.length;
    opportunity.setData(opptyData);
    await opportunity.save();

    log.info(`[${AUDIT_TYPE}]: Completed - ${suggestions.length} suggestions created`);

    return {
      fullAuditRef: baseURL,
      auditResult: {
        status: 'completed',
        pagesAnalyzed: pagesWithImages.length,
        totalImages,
        suggestionsCreated: suggestions.length,
        opportunityId: opportunity.getId(),
      },
    };
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Error: ${error.message}`);
    return {
      fullAuditRef: baseURL,
      auditResult: {
        status: 'error',
        error: error.message,
      },
    };
  }
}

// Simple runner version - NO steps, just processes existing S3 data
export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .withRunner(imageOptimizationSimpleRunner)
  .build();
