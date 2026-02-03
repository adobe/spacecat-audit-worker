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

import { stripTrailingSlash } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';
import {
  validatePageHeadingFromScrapeJson,
  getH1HeadingASuggestion,
  HEADINGS_CHECKS,
} from '../headings/handler.js';
import { getBrandGuidelines } from '../headings/shared-utils.js';
import { saveIntermediateResults } from './utils.js';
import SeoChecks from '../metatags/seo-checks.js';
import { getDomElementSelector, toElementTargets } from '../utils/dom-selector.js';

export const PREFLIGHT_HEADINGS = 'headings';

/**
 * Get SEO impact level for a given check type
 * @param {string} checkType - The check type identifier
 * @returns {string} SEO impact level
 */
function getSeoImpact(checkType) {
  const highImpactChecks = [
    HEADINGS_CHECKS.HEADING_MISSING_H1.check,
    HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check,
    HEADINGS_CHECKS.HEADING_H1_LENGTH.check,
  ];

  return highImpactChecks.includes(checkType) ? 'High' : 'Moderate';
}

/**
 * Extract selectors for heading issues from the scraped HTML
 * @param {Object} scrapeJsonObject - The scraped page data
 * @param {Object} check - The check result from validatePageHeadingFromScrapeJson
 * @returns {Object} Element targets with selectors
 */
function getElementsFromCheck(scrapeJsonObject, check) {
  if (!scrapeJsonObject?.scrapeResult?.rawBody) {
    return {};
  }

  const $ = cheerioLoad(scrapeJsonObject.scrapeResult.rawBody);
  const { check: checkType } = check;
  let selectors = [];

  // Use string comparison for check types to avoid dependency on HEADINGS_CHECKS constants
  switch (checkType) {
    case 'heading-missing-h1': {
      // Target the main content area where H1 should be added
      const mainElement = $('body > main').get(0) || $('body').get(0);
      const selector = getDomElementSelector(mainElement);
      if (selector) selectors.push(selector);
      break;
    }

    case 'heading-multiple-h1': {
      // Target all H1 elements
      const h1Elements = $('h1').toArray();
      selectors = h1Elements
        .map((h1) => getDomElementSelector(h1))
        .filter(Boolean);
      break;
    }

    case 'heading-h1-length': {
      // Target the H1 element
      const h1Element = $('h1').get(0);
      if (h1Element) {
        const selector = getDomElementSelector(h1Element);
        if (selector) selectors.push(selector);
      }
      break;
    }

    case 'heading-empty': {
      // Find empty headings - extract tag name from check
      const tagName = check.tagName?.toLowerCase();
      if (tagName && /^h[1-6]$/.test(tagName)) {
        const headingsArray = $(tagName).toArray();
        // Find empty ones
        const emptyHeadings = headingsArray.filter((h) => $(h).text().trim().length === 0);
        selectors = emptyHeadings
          .map((h) => getDomElementSelector(h))
          .filter(Boolean);
      }
      break;
    }

    case 'heading-order-invalid': {
      // Use the selector from transformRules if available, otherwise find headings
      if (check.transformRules?.selector) {
        selectors.push(check.transformRules.selector);
      } else {
        // Find all headings and identify order violations
        const allHeadings = $('h1, h2, h3, h4, h5, h6').toArray();
        // For now, return all headings involved in order issues
        // A more precise implementation could identify the specific violating heading
        selectors = allHeadings
          .map((h) => getDomElementSelector(h))
          .filter(Boolean);
      }
      break;
    }

    default:
      // For other check types, try to extract from transformRules or selectors
      if (check.selectors && Array.isArray(check.selectors)) {
        selectors = check.selectors;
      } else if (check.transformRules?.selector) {
        selectors.push(check.transformRules.selector);
      }
  }

  return toElementTargets(selectors);
}

/**
 * Enhance heading results with AI suggestions for specific check types
 * @param {Array} headingsResults - Array of heading validation results
 * @param {Object} brandGuidelines - Brand guidelines for AI suggestions
 * @param {Object} context - Audit context
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} Enhanced results with AI suggestions
 */
async function enhanceWithAISuggestions(headingsResults, brandGuidelines, context, log) {
  const enhancedResults = await Promise.all(
    headingsResults.map(async (pageResult) => {
      const { url, checks } = pageResult;
      const enhancedChecks = await Promise.all(
        checks.map(async (check) => {
          if (!check.success) {
            const checkType = check.check;
            // Generate AI suggestions for H1-related issues only
            if (checkType === HEADINGS_CHECKS.HEADING_MISSING_H1.check
              || checkType === HEADINGS_CHECKS.HEADING_H1_LENGTH.check
              || checkType === HEADINGS_CHECKS.HEADING_EMPTY.check) {
              try {
                const aiSuggestion = await getH1HeadingASuggestion(
                  url,
                  log,
                  check.pageTags,
                  context,
                  brandGuidelines,
                );
                if (aiSuggestion) {
                  return {
                    ...check,
                    suggestion: aiSuggestion,
                    isAISuggested: true,
                  };
                }
              } catch (error) {
                log.error(`[preflight-headings] Error generating AI suggestion for ${url}: ${error.message}`);
              }
            }
          }
          return check;
        }),
      );
      return { url, checks: enhancedChecks };
    }),
  );
  return enhancedResults;
}

export default async function headings(context, auditContext) {
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

  const headingsStartTime = Date.now();
  const headingsStartTimestamp = new Date().toISOString();

  // Create headings audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ name: PREFLIGHT_HEADINGS, type: 'seo', opportunities: [] });
  });

  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Starting headings audit`);

  try {
    const seoChecks = new SeoChecks(log);

    // Create a map from URL to scrapeJsonObject for selector generation
    const scrapeDataByUrl = new Map();
    scrapedObjects.forEach(({ data }) => {
      const url = stripTrailingSlash(data.finalUrl);
      scrapeDataByUrl.set(url, data);
    });

    // Validate headings for each scraped page
    const detectedIssues = await Promise.all(
      scrapedObjects.map(async ({ data }) => {
        const scrapeJsonObject = data;
        const url = stripTrailingSlash(scrapeJsonObject.finalUrl);

        const result = await validatePageHeadingFromScrapeJson(
          url,
          scrapeJsonObject,
          log,
          seoChecks,
        );

        return result || { url, checks: [] };
      }),
    );

    // Enhance with AI suggestions for 'suggest' step
    const headingsResults = step === 'suggest'
      ? await (async () => {
        const healthyTags = seoChecks.getFewHealthyTags();
        const healthyTagsObject = {
          title: healthyTags.title.join(', '),
          description: healthyTags.description.join(', '),
          h1: healthyTags.h1.join(', '),
        };
        log.debug(`[preflight-headings] AI Suggestions Healthy tags object: ${JSON.stringify(healthyTagsObject)}`);
        try {
          const brandGuidelines = await getBrandGuidelines(healthyTagsObject, log, context, site);
          return await enhanceWithAISuggestions(detectedIssues, brandGuidelines, context, log);
        } catch (error) {
          log.error(`[preflight-headings] Failed to generate AI suggestions: ${error.message}`);
          return detectedIssues;
        }
      })()
      : detectedIssues;

    // Process results and add to audit opportunities
    headingsResults.forEach(({ url, checks }) => {
      const audit = audits.get(url)?.audits.find((a) => a.name === PREFLIGHT_HEADINGS);
      if (!audit) {
        log.warn(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. No audit entry found for ${url}`);
        return;
      }

      // Get scrape data for this URL to generate selectors
      const scrapeJsonObject = scrapeDataByUrl.get(url);

      // Add each check as an opportunity
      checks.forEach((check) => {
        if (!check.success) {
          const opportunity = {
            check: check.check,
            issue: check.checkTitle,
            issueDetails: check.description,
            seoImpact: getSeoImpact(check.check),
            seoRecommendation: check.explanation,
          };

          // Add AI suggestion if available
          if (check.isAISuggested) {
            opportunity.aiSuggestion = check.suggestion;
          } else {
            opportunity.suggestion = check.suggestion;
          }

          // Generate selectors from the scraped HTML
          if (scrapeJsonObject) {
            const elementData = getElementsFromCheck(scrapeJsonObject, check);
            if (elementData?.elements?.length > 0) {
              Object.assign(opportunity, elementData);
            }
          }

          audit.opportunities.push(opportunity);
        }
      });
    });
  } catch (error) {
    log.error(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Headings audit failed: ${error.message}`);
  }

  const headingsEndTime = Date.now();
  const headingsEndTimestamp = new Date().toISOString();
  const headingsElapsed = ((headingsEndTime - headingsStartTime) / 1000).toFixed(2);
  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Headings audit completed in ${headingsElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'headings',
    duration: `${headingsElapsed} seconds`,
    startTime: headingsStartTimestamp,
    endTime: headingsEndTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'headings audit');
}
