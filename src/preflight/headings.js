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
import {
  validatePageHeadingFromScrapeJson,
  getBrandGuidelines,
  getH1HeadingASuggestion,
  HEADINGS_CHECKS,
} from '../headings/handler.js';
import { saveIntermediateResults } from './utils.js';
import SeoChecks from '../metatags/seo-checks.js';
import { toElementTargets } from '../utils/dom-selector.js';

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

function getElementsFromCheck(check) {
  const selectorSources = check.selectors
    || (check.transformRules?.selector ? [check.transformRules.selector] : []);
  const elements = toElementTargets(selectorSources);
  return elements.length ? elements : undefined;
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
          const brandGuidelines = await getBrandGuidelines(healthyTagsObject, log, context);
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

          const elements = getElementsFromCheck(check);
          if (elements) {
            opportunity.elements = elements;
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
