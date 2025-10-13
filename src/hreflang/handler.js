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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { isLangCode } from 'is-language-code';
import { JSDOM } from 'jsdom';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions, keepLatestMergeDataFunction } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityDataForElmo } from './opportunity-data-mapper.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';

const auditType = Audit.AUDIT_TYPES.HREFLANG;

export const HREFLANG_CHECKS = Object.freeze({
  HREFLANG_INVALID_LANGUAGE_TAG: {
    check: 'hreflang-invalid-language-tag',
    title: 'Invalid Language Tag',
    explanation: 'Invalid language tag found in hreflang attribute. Language tags must follow IANA standards.',
  },
  HREFLANG_X_DEFAULT_MISSING: {
    check: 'hreflang-x-default-missing',
    title: 'Missing X-Default Tag',
    explanation: 'Missing x-default hreflang tag for international fallback.',
  },
  HREFLANG_OUTSIDE_HEAD: {
    check: 'hreflang-outside-head',
    title: 'Hreflang Outside Head',
    explanation: 'Hreflang tags found outside the head section. Hreflang tags should be placed in the HTML head.',
  },
  TOPPAGES: {
    check: 'top-pages',
    title: 'Top Pages',
    explanation: 'No top pages found',
  },

});

/**
 * Validates hreflang implementation for a single page
 * @param {string} url - The URL to validate
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Validation results
 */
export async function validatePageHreflang(url, log) {
  if (!url) {
    log.error('URL is undefined or null, cannot validate hreflang');
    // Return empty result - URL validation errors should only be logged
    return {
      url,
      checks: [],
    };
  }

  try {
    log.info(`Checking hreflang for URL: ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      log.warn(`Failed to fetch ${url}: ${response.status} ${response.statusText}. Skipping hreflang validation.`);
      return { url, checks: [] }; // Skip validation
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const { document } = dom.window;

    // Extract hreflang links
    const hreflangLinks = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'));
    const checks = [];

    // Skip validation if no hreflang tags exist
    if (hreflangLinks.length === 0) {
      log.info(`No hreflang tags found for URL: ${url} - this is valid for single-language sites`);
      return { url, checks: [] }; // Return empty checks - no issues to report
    }

    log.info(`Found ${hreflangLinks.length} hreflang tags for URL: ${url}, validating implementation quality`);

    if (hreflangLinks.length > 0) {
      let hasXDefault = false;
      const languageCodes = new Set();

      // Validate each hreflang link
      for (const link of hreflangLinks) {
        const hreflang = link.getAttribute('hreflang');
        const href = link.getAttribute('href');

        // Check if hreflang is in head section
        if (!link.closest('head')) {
          checks.push({
            check: HREFLANG_CHECKS.HREFLANG_OUTSIDE_HEAD.check,
            success: false,
            explanation: HREFLANG_CHECKS.HREFLANG_OUTSIDE_HEAD.explanation,
            hreflang,
            href,
          });
        }

        // Check for x-default
        if (hreflang === 'x-default') {
          hasXDefault = true;
        } else {
          // Validate language code for non-x-default values
          languageCodes.add(hreflang);
          const validation = isLangCode(hreflang);
          if (!validation.res) {
            const errorMsg = `${HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_TAG.explanation} Error: ${validation.message}`;
            checks.push({
              check: HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_TAG.check,
              success: false,
              explanation: errorMsg,
              hreflang,
              href,
            });
          }
        }

        try {
          // eslint-disable-next-line no-new
          new URL(href, url);
        } catch {
          log.warn(`Invalid hreflang URL: ${href} for page ${url}`);
        }
      }

      // Check x-default
      if (languageCodes.size > 1 && !hasXDefault) {
        checks.push({
          check: HREFLANG_CHECKS.HREFLANG_X_DEFAULT_MISSING.check,
          success: false,
          explanation: HREFLANG_CHECKS.HREFLANG_X_DEFAULT_MISSING.explanation,
        });
      }
    }

    return { url, checks };
  } catch (error) {
    log.warn(`Unable to validate hreflang for ${url}: ${error.message}. Skipping hreflang validation.`);
    return { url, checks: [] }; // Skip validation, don't report fetch errors as audit issues
  }
}

/**
 * Main hreflang audit runner
 * @param {string} baseURL - Base URL of the site
 * @param {Object} context - Audit context
 * @param {Object} site - Site object
 * @returns {Promise<Object>} Audit results
 */
export async function hreflangAuditRunner(baseURL, context, site) {
  const siteId = site.getId();
  const { log, dataAccess } = context;
  log.info(`Starting Hreflang Audit with siteId: ${siteId}`);

  try {
    // Get top 200 pages
    const allTopPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
    const topPages = allTopPages.slice(0, 200);

    log.info(`Processing ${topPages.length} top pages for hreflang audit (limited to 200)`);

    if (topPages.length === 0) {
      log.info('No top pages found, ending audit.');
      return {
        fullAuditRef: baseURL,
        auditResult: {
          check: HREFLANG_CHECKS.TOPPAGES.check,
          success: false,
          explanation: HREFLANG_CHECKS.TOPPAGES.explanation,
        },
      };
    }

    // Validate hreflang for each page
    const auditPromises = topPages.map(async (page) => validatePageHreflang(page.url, log));

    const auditResultsArray = await Promise.allSettled(auditPromises);
    const aggregatedResults = auditResultsArray.reduce((acc, result) => {
      if (result.status === 'fulfilled') {
        const { url, checks } = result.value;
        checks.forEach((check) => {
          const { check: checkType, success, explanation } = check;

          // Only process failed checks
          if (success === false) {
            if (!acc[checkType]) {
              acc[checkType] = {
                success: false,
                explanation,
                urls: [],
              };
            }
            acc[checkType].urls.push(url);
          }
        });
      }
      return acc;
    }, {});

    log.info(`Successfully completed Hreflang Audit for site: ${baseURL}`);

    // All checks passed
    if (Object.keys(aggregatedResults).length === 0) {
      return {
        fullAuditRef: baseURL,
        auditResult: {
          status: 'success',
          message: 'No hreflang issues detected',
        },
      };
    }

    return {
      fullAuditRef: baseURL,
      auditResult: {
        ...aggregatedResults,
      },
    };
  } catch (error) {
    log.error(`Hreflang audit failed: ${error.message}`);
    return {
      fullAuditRef: baseURL,
      auditResult: {
        error: `Audit failed with error: ${error.message}`,
        success: false,
      },
    };
  }
}

/**
 * Generates suggestions based on hreflang audit results.
 * Transforms the audit result object into a format suitable for the suggestions system.
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results.
 * @param {Object} context - The context object containing log and other utilities.
 * @returns {Object} The audit data with suggestions added.
 */
export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  // if audit succeeded or failed with no specific issues, skip suggestions generation
  if (auditData.auditResult?.status === 'success'
      || auditData.auditResult?.error
      || auditData.auditResult?.check === HREFLANG_CHECKS.TOPPAGES.check) {
    log.info(`Hreflang audit for ${auditUrl} has no issues or failed, skipping suggestions generation`);
    return { ...auditData };
  }

  // Get the order from HREFLANG_CHECKS object
  const auditTypeOrder = [
    ...Object.keys(HREFLANG_CHECKS),
  ];

  // Group suggestions by audit type
  const suggestionsByType = {};
  const allSuggestions = [];

  // transform audit results into suggestions
  // Iterate through each check type in the audit results
  Object.entries(auditData.auditResult).forEach(([checkType, checkResult]) => {
    if (checkResult.success === false && Array.isArray(checkResult.urls)) {
      if (!suggestionsByType[checkType]) {
        suggestionsByType[checkType] = [];
      }

      checkResult.urls.forEach((url) => {
        const suggestion = {
          type: 'CODE_CHANGE',
          checkType,
          explanation: checkResult.explanation,
          url,
          // eslint-disable-next-line no-use-before-define
          recommendedAction: generateRecommendedAction(checkType),
        };
        suggestionsByType[checkType].push(suggestion);
        allSuggestions.push(suggestion);
      });
    }
  });

  // Build markdown table for Elmo
  let mdTable = '';
  auditTypeOrder.forEach((currentAuditType) => {
    const checkType = HREFLANG_CHECKS[currentAuditType].check;
    if (suggestionsByType[checkType] && suggestionsByType[checkType].length > 0) {
      mdTable += `## ${HREFLANG_CHECKS[currentAuditType].title}\n\n`;
      mdTable += '| Page Url | Explanation | Suggestion |\n';
      mdTable += '|-------|-------|-------|\n';
      suggestionsByType[checkType].forEach((suggestion) => {
        mdTable += `| ${suggestion.url} | ${suggestion.explanation} | ${suggestion.recommendedAction} |\n`;
      });
      mdTable += '\n';
    }
  });

  const elmoSuggestions = [];
  elmoSuggestions.push({
    type: 'CODE_CHANGE',
    recommendedAction: mdTable,
  });

  const suggestions = [...allSuggestions];

  log.info(`Generated ${suggestions.length} hreflang suggestions for ${auditUrl}`);
  return { ...auditData, suggestions, elmoSuggestions };
}

/**
 * Generates recommended actions based on the check type.
 *
 * @param {string} checkType - The type of hreflang check that failed.
 * @returns {string} The recommended action for fixing the issue.
 */
function generateRecommendedAction(checkType) {
  switch (checkType) {
    case HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_TAG.check:
      return 'Update hreflang attribute to use valid language tags (ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes).';
    case HREFLANG_CHECKS.HREFLANG_X_DEFAULT_MISSING.check:
      return 'Add x-default hreflang tag: <link rel="alternate" href="https://example.com/" hreflang="x-default" />';
    case HREFLANG_CHECKS.HREFLANG_OUTSIDE_HEAD.check:
      return 'Move hreflang tags from the body to the <head> section of the HTML document.';

    default:
      return 'Review and fix hreflang implementation according to international SEO best practices.';
  }
}

/**
 * Creates opportunities and syncs suggestions for hreflang issues.
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results and suggestions.
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  // if audit has no suggestions, skip opportunity creation
  if (!auditData.suggestions?.length) {
    log.info('Hreflang audit has no issues, skipping opportunity creation');
    return { ...auditData };
  }

  // create opportunity
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const buildKey = (suggestion) => `${suggestion.checkType}|${suggestion.url}`;

  // sync suggestions with opportunity
  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: suggestion.type,
      rank: 0, // all suggestions are ranked equally
      data: {
        type: 'url',
        url: suggestion.url,
        checkType: suggestion.checkType,
        explanation: suggestion.explanation,
        recommendedAction: suggestion.recommendedAction,
      },
    }),
  });

  log.info(`Hreflang opportunity created and ${auditData.suggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

/**
 * Creates opportunities and syncs suggestions for hreflang issues for Elmo.
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results and suggestions.
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export async function opportunityAndSuggestionsForElmo(auditUrl, auditData, context) {
  const { log } = context;
  if (!auditData.elmoSuggestions?.length) {
    log.info('Hreflang audit has no issues, skipping opportunity creation for Elmo');
    return { ...auditData };
  }

  const elmoOpportunityType = 'generic-opportunity';
  const comparisonFn = (oppty) => {
    const opptyData = oppty.getData();
    const opptyAdditionalMetrics = opptyData?.additionalMetrics;
    if (!opptyAdditionalMetrics || !Array.isArray(opptyAdditionalMetrics)) {
      return false;
    }
    const hasHreflangSubtype = opptyAdditionalMetrics.some(
      (metric) => metric.key === 'subtype' && metric.value === 'hreflang',
    );
    return hasHreflangSubtype;
  };

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityDataForElmo,
    elmoOpportunityType,
    {},
    comparisonFn,
  );

  log.info(`Hreflang opportunity created for Elmo with oppty id ${opportunity.getId()}`);

  const buildKey = (suggestion) => `${suggestion.type}`;
  await syncSuggestions({
    opportunity,
    newData: auditData.elmoSuggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: suggestion.type,
      rank: 0,
      data: {
        suggestionValue: suggestion.recommendedAction,
      },
    }),
    keepLatestMergeDataFunction,
    log,
  });

  log.info(`Hreflang opportunity created for Elmo and ${auditData.elmoSuggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(hreflangAuditRunner)
  .withPostProcessors([
    generateSuggestions,
    opportunityAndSuggestions,
    opportunityAndSuggestionsForElmo,
  ])
  .build();
