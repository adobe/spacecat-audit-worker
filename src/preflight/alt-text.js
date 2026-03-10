/*
 * Copyright 2026 Adobe. All rights reserved.
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
 * @module preflight/alt-text
 * @description Preflight audit handler for detecting image alt text issues
 * affecting accessibility and SEO.
 *
 * This module extracts images from scraped HTML pages and analyzes their alt attributes
 * to identify accessibility and SEO issues. It detects four types of problems:
 *
 * 1. **Missing alt attribute** (High SEO impact): Images without any alt attribute
 *    fail WCAG accessibility guidelines and hurt SEO since search engines can't
 *    understand the image content.
 *
 * 2. **Empty alt attribute** (Low impact): Empty alt="" is valid for decorative images
 *    per WCAG guidelines, but flagged for review to ensure it's intentional.
 *
 * 3. **Low-quality alt text** (Moderate impact): Generic or placeholder alt text
 *    like "image", "photo", "DSC0001" provides no meaningful description.
 *
 * 4. **Long alt text** (Low impact): Alt text exceeding 125 characters is too verbose
 *    for screen readers and may be truncated by search engines.
 *
 * In the 'suggest' step, images with missing or low-quality alt text are sent to
 * Mystique for AI-powered alt text suggestions.
 *
 * @example
 * // This handler is registered in the preflight handler.js and called automatically
 * // when 'image-alt-text-preflight' is enabled for a site.
 *
 * // The handler produces opportunities in this format:
 * {
 *   check: 'missing-alt',
 *   issue: [{
 *     src: '/images/hero.jpg',
 *     alt: undefined,
 *     issue: 'Image is missing alt attribute',
 *     seoImpact: 'High',
 *     seoRecommendation: 'Add descriptive alt text...'
 *   }]
 * }
 */

import { stripTrailingSlash } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';
import { saveIntermediateResults } from './utils.js';
import {
  PREFLIGHT_ALT_TEXT_GUIDANCE_TYPE,
  PREFLIGHT_ALT_TEXT_OBSERVATION,
  MAX_ALT_TEXT_LENGTH,
} from '../image-alt-text/constants.js';
import { AUDIT_ALT_TEXT, PREFLIGHT_AUDIT_TYPE_ACCESSIBILITY } from './audit-constants.js';

/**
 * Regular expression patterns that identify low-quality or generic alt text.
 * These patterns match common placeholder text, camera default filenames,
 * and non-descriptive generic terms that don't provide meaningful image descriptions.
 *
 * @constant {RegExp[]}
 * @private
 */
const LOW_QUALITY_ALT_PATTERNS = [
  /^image$/i,
  /^img$/i,
  /^photo$/i,
  /^picture$/i,
  /^graphic$/i,
  /^icon$/i,
  /^logo$/i,
  /^banner$/i,
  /^placeholder$/i,
  /^untitled$/i,
  /^screenshot$/i,
  /^image\s*\d+$/i, // "image 1", "image2", etc.
  /^img\s*\d+$/i,
  /^photo\s*\d+$/i,
  /^dsc\d+$/i, // Camera default names like DSC0001
  /^img_\d+$/i, // IMG_0001 patterns
  /^screen\s*shot/i,
];

/**
 * Checks if alt text is considered low quality or non-descriptive.
 *
 * Alt text is flagged as low quality if:
 * - It's empty or undefined
 * - It's shorter than 5 characters (too brief to be descriptive)
 * - It matches any of the LOW_QUALITY_ALT_PATTERNS (generic terms, camera defaults, etc.)
 *
 * @param {string} altText - The alt text to check
 * @returns {boolean} True if the alt text is low quality, false if acceptable
 * @private
 */
function isLowQualityAltText(altText) {
  if (!altText || altText.length < 5) {
    return true;
  }
  return LOW_QUALITY_ALT_PATTERNS.some((pattern) => pattern.test(altText.trim()));
}

/**
 * Analyzes an image's alt attribute and determines if there's an accessibility/SEO issue.
 *
 * The analysis categorizes issues into four types:
 * - 'missing-alt': No alt attribute present (High impact)
 * - 'empty-alt': Alt attribute exists but is empty (Low impact, may be intentional for decorative)
 * - 'low-quality-alt': Alt text exists but is generic/non-descriptive (Moderate impact)
 * - 'long-alt': Alt text exceeds recommended length of 125 characters (Low impact)
 *
 * @param {string|undefined} altAttr - The alt attribute value from the image element.
 *   undefined means the attribute is missing entirely, '' means empty alt attribute.
 * @returns {Object|null} Issue details object with type, issue description, and seoImpact,
 *   or null if the alt text is acceptable.
 * @returns {string} return.type - The issue type identifier
 * @returns {string} return.issue - Human-readable issue description
 * @returns {string} return.seoImpact - Impact level ('High', 'Moderate', or 'Low')
 * @private
 */
function analyzeAltAttribute(altAttr) {
  if (altAttr === undefined) {
    return {
      type: 'missing-alt',
      issue: 'Image is missing alt attribute',
      seoImpact: 'High',
    };
  }

  if (altAttr === '') {
    // Empty alt is valid for decorative images, but we flag it for review
    return {
      type: 'empty-alt',
      issue: 'Image has empty alt attribute (decorative image?)',
      seoImpact: 'Low',
    };
  }

  if (isLowQualityAltText(altAttr)) {
    return {
      type: 'low-quality-alt',
      issue: `Image has low-quality alt text: "${altAttr}"`,
      seoImpact: 'Moderate',
    };
  }

  if (altAttr.length > MAX_ALT_TEXT_LENGTH) {
    return {
      type: 'long-alt',
      issue: `Image alt text is too long (${altAttr.length} characters, recommended max is ${MAX_ALT_TEXT_LENGTH})`,
      seoImpact: 'Low',
    };
  }

  return null; // Alt text is acceptable
}

/**
 * Extracts all images from an HTML document and analyzes their alt attributes.
 *
 * This function parses the HTML using cheerio, finds all <img> elements,
 * and runs alt attribute analysis on each. It filters out:
 * - Images without a src attribute (invalid/broken images)
 * - Small data URI images (<200 chars) which are likely tracking pixels or tiny icons
 *
 * @param {string} rawBody - The raw HTML content of the page
 * @returns {Array<Object>} Array of image issue objects, each containing:
 *   - src: The image source URL
 *   - alt: The current alt attribute value (may be undefined)
 *   - type: Issue type ('missing-alt', 'empty-alt', 'low-quality-alt', or 'long-alt')
 *   - issue: Human-readable issue description
 *   - seoImpact: Impact level string
 * @private
 */
function extractAndAnalyzeImages(rawBody) {
  const $ = cheerioLoad(rawBody);
  const issues = [];

  $('img').each((index, img) => {
    const $img = $(img);
    const src = $img.attr('src');
    const altAttr = $img.attr('alt');

    // Skip images without src (likely invalid)
    if (!src) {
      return;
    }

    // Skip data URIs that are likely tiny placeholders/icons
    if (src.startsWith('data:') && src.length < 200) {
      return;
    }

    const analysis = analyzeAltAttribute(altAttr);
    if (analysis) {
      issues.push({
        src,
        alt: altAttr,
        ...analysis,
      });
    }
  });

  return issues;
}

/**
 * Returns the SEO recommendation message for a given issue type.
 *
 * Provides actionable guidance for fixing each type of alt text issue.
 *
 * @param {string} type - The issue type
 *   ('missing-alt', 'empty-alt', 'low-quality-alt', or 'long-alt')
 * @returns {string} A recommendation string explaining how to fix the issue
 * @private
 */
function getRecommendation(type) {
  const recommendations = {
    'missing-alt': 'Add descriptive alt text that accurately describes the image content for accessibility and SEO',
    'empty-alt': 'If this is a decorative image, empty alt is correct. Otherwise, add descriptive alt text',
    'low-quality-alt': 'Replace generic alt text with a meaningful description of the image content',
    'long-alt': `Shorten alt text to ${MAX_ALT_TEXT_LENGTH} characters or less. Keep it concise while maintaining a clear description`,
  };
  /* c8 ignore next */
  return recommendations[type] || 'Review and improve image alt text';
}

/**
 * Groups image issues by their type to create audit opportunities.
 *
 * This function organizes individual image issues into grouped opportunities
 * that match the PreflightResultItem schema. Each issue type becomes a separate
 * opportunity with an array of affected images.
 *
 * @param {Array<Object>} imageIssues - Array of image issues from extractAndAnalyzeImages
 * @returns {Array<Object>} Array of opportunity objects formatted for the preflight audit result.
 *   Each opportunity contains:
 *   - check: The issue type identifier ('missing-alt', 'empty-alt', 'low-quality-alt', 'long-alt')
 *   - issue: Array of affected images with their details and recommendations
 * @private
 */
function groupIssuesByType(imageIssues) {
  const grouped = {
    'missing-alt': [],
    'empty-alt': [],
    'low-quality-alt': [],
    'long-alt': [],
  };

  imageIssues.forEach((issue) => {
    grouped[issue.type].push({
      src: issue.src,
      alt: issue.alt,
      issue: issue.issue,
      seoImpact: issue.seoImpact,
      seoRecommendation: getRecommendation(issue.type),
    });
  });

  return Object.entries(grouped)
    .filter(([, issues]) => issues.length > 0)
    .map(([check, issues]) => ({ check, issue: issues }));
}

/**
 * Sends images with alt text issues to Mystique for AI-powered suggestions.
 *
 * This function is called during the 'suggest' step of the preflight audit.
 * It sends all images with issues to Mystique via SQS for AI analysis:
 * - missing-alt: generate new alt text from image analysis
 * - empty-alt: determine if decorative or generate alt text
 * - low-quality-alt: generate better, more descriptive alt text
 * - long-alt: suggest a concise version while maintaining meaning
 *
 * @param {Object} context - The audit context object
 * @param {Object} context.sqs - SQS client for sending messages
 * @param {Object} context.env - Environment variables including queue URLs
 * @param {Object} context.log - Logger instance
 * @param {Object} site - The site object being audited
 * @param {Object} job - The AsyncJob instance for tracking
 * @param {string} pageUrl - The URL of the page containing the images
 * @param {Array<Object>} imageIssues - Array of image issues to potentially send
 * @returns {Promise<Object>} Result object with:
 *   - processing: {boolean} True if images were sent to Mystique, false otherwise
 * @private
 */
async function sendToMystiqueForSuggestions(context, site, job, pageUrl, imageIssues) {
  const { sqs, env, log } = context;
  const siteId = site.getId();
  const jobId = job.getId();

  // Send all images with alt text issues to Mystique for AI-powered suggestions
  // - missing-alt: generate new alt text
  // - empty-alt: determine if decorative or generate alt text
  // - low-quality-alt: generate better alt text
  // - long-alt: suggest a concise version
  /* c8 ignore next 3 */
  if (imageIssues.length === 0) {
    return { processing: false };
  }

  try {
    const mystiqueMessage = {
      type: PREFLIGHT_ALT_TEXT_GUIDANCE_TYPE,
      siteId,
      auditId: jobId,
      mode: 'preflight',
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      observation: PREFLIGHT_ALT_TEXT_OBSERVATION,
      data: {
        jobId,
        url: pageUrl,
        images: imageIssues.map((img) => ({
          src: img.src,
          currentAlt: img.alt,
          issueType: img.type,
        })),
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
    log.debug(`[preflight-alt-text] Sent ${imageIssues.length} images to Mystique for suggestions`);

    return { processing: true };
  } catch (error) {
    log.error(`[preflight-alt-text] Failed to send to Mystique: ${error.message}`);
    return { processing: false };
  }
}

/**
 * Main handler for the alt-text preflight audit check.
 *
 * This handler is called by the preflight audit system when 'image-alt-text-preflight'
 * is enabled for a site. It processes all scraped pages, extracts images,
 * analyzes their alt attributes, and records any issues as opportunities.
 *
 * The handler supports two steps:
 * - 'identify': Detects issues and records them in the audit result
 * - 'suggest': Additionally sends images to Mystique for AI alt text suggestions
 *
 * @param {Object} context - The audit context from the preflight system
 * @param {Object} context.site - The site being audited
 * @param {Object} context.job - The current job instance
 * @param {Object} context.log - Logger instance
 * @param {Object} context.sqs - SQS client (used in suggest step)
 * @param {Object} context.env - Environment variables
 * @param {Object} auditContext - The preflight audit context
 * @param {Array<string>} auditContext.previewUrls - URLs being audited
 * @param {string} auditContext.step - Current step ('identify' or 'suggest')
 * @param {Map} auditContext.audits - Map of URL to audit results
 * @param {Array} auditContext.auditsResult - Array of audit result objects
 * @param {Array<Object>} auditContext.scrapedObjects - Scraped page data from S3
 * @param {Array} auditContext.timeExecutionBreakdown - Profiling data array
 * @returns {Promise<Object>} Result object with:
 *   - processing: {boolean} True if async processing (Mystique) was triggered
 * @exports
 */
export default async function imageAltText(context, auditContext) {
  const {
    site, job, log,
  } = context;
  const {
    previewUrls,
    step,
    audits,
    auditsResult,
    scrapedObjects,
    timeExecutionBreakdown,
  } = auditContext;

  const imageAltTextStartTime = Date.now();
  const imageAltTextStartTimestamp = new Date().toISOString();

  // Create alt-text audit entries for all pages in the audit map
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({
      name: AUDIT_ALT_TEXT,
      type: PREFLIGHT_AUDIT_TYPE_ACCESSIBILITY,
      opportunities: [],
    });
  });

  // Pre-index audits for O(1) lookups
  const imageAltTextAuditMap = new Map();
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    if (pageResult) {
      const imageAltTextAudit = pageResult.audits.find((a) => a.name === AUDIT_ALT_TEXT);
      if (imageAltTextAudit) {
        imageAltTextAuditMap.set(url, imageAltTextAudit);
      }
    }
  });

  let anyProcessing = false;

  // Process each scraped page
  for (const { data } of scrapedObjects) {
    const { finalUrl, scrapeResult: { rawBody } } = data;
    const pageUrl = stripTrailingSlash(finalUrl);
    const audit = imageAltTextAuditMap.get(pageUrl);

    if (!audit) {
      log.warn(`[preflight-alt-text] No audit found for URL: ${pageUrl}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    // Extract and analyze images
    const imageIssues = extractAndAnalyzeImages(rawBody);

    if (imageIssues.length === 0) {
      log.debug(`[preflight-alt-text] No image issues found for ${pageUrl}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    log.debug(`[preflight-alt-text] Found ${imageIssues.length} image issues for ${pageUrl}`);

    // For suggest step, send to Mystique for AI suggestions
    if (step === 'suggest') {
      // eslint-disable-next-line no-await-in-loop
      const result = await sendToMystiqueForSuggestions(
        context,
        site,
        job,
        pageUrl,
        imageIssues,
      );
      if (result.processing) {
        anyProcessing = true;
      }
    }

    // Group issues and add to audit opportunities
    const opportunities = groupIssuesByType(imageIssues);
    opportunities.forEach((opportunity) => {
      audit.opportunities.push(opportunity);
    });
  }

  const imageAltTextEndTime = Date.now();
  const imageAltTextEndTimestamp = new Date().toISOString();
  const imageAltTextElapsed = ((imageAltTextEndTime - imageAltTextStartTime) / 1000).toFixed(2);

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. ${AUDIT_ALT_TEXT} audit completed in ${imageAltTextElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'alt-text',
    duration: `${imageAltTextElapsed} seconds`,
    startTime: imageAltTextStartTimestamp,
    endTime: imageAltTextEndTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'alt text audit');

  return { processing: anyProcessing };
}
