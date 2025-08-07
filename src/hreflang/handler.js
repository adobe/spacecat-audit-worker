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

import { JSDOM } from 'jsdom';
import { isLangCode } from 'is-language-code';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';

const auditType = Audit.AUDIT_TYPES.HREFLANG;

export const HREFLANG_CHECKS = Object.freeze({
  HREFLANG_EXISTS: {
    check: 'hreflang-exists',
    explanation: 'No hreflang tags found. Hreflang tags help search engines understand which language versions of pages to serve to users.',
  },
  HREFLANG_INVALID_LANGUAGE_CODE: {
    check: 'hreflang-invalid-language-code',
    explanation: 'Invalid language code found in hreflang attribute. Language codes must follow IANA standards.',
  },
  HREFLANG_SELF_REFERENCE_MISSING: {
    check: 'hreflang-self-reference-missing',
    explanation: 'Missing self-referencing hreflang tag. Each page should include a hreflang tag pointing to itself.',
  },
  HREFLANG_NOT_IN_HEAD: {
    check: 'hreflang-not-in-head',
    explanation: 'Hreflang tags found outside the head section. Hreflang tags should be placed in the HTML head.',
  },
  TOPPAGES: {
    check: 'top-pages',
    explanation: 'No top pages found',
  },
  URL_UNDEFINED: {
    check: 'url-defined',
    explanation: 'The URL is undefined or null, which prevents the hreflang validation process.',
  },
  FETCH_ERROR: {
    check: 'hreflang-fetch-error',
    explanation: 'Error fetching the page content for hreflang validation.',
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
    return {
      url,
      checks: [{
        check: HREFLANG_CHECKS.URL_UNDEFINED.check,
        success: false,
        explanation: HREFLANG_CHECKS.URL_UNDEFINED.explanation,
      }],
    };
  }

  try {
    log.info(`Checking hreflang for URL: ${url}`);
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const { document } = dom.window;

    // Extract hreflang links
    const hreflangLinks = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'));
    const checks = [];

    // Check if any hreflang tags exist
    if (hreflangLinks.length === 0) {
      checks.push({
        check: HREFLANG_CHECKS.HREFLANG_EXISTS.check,
        success: false,
        explanation: HREFLANG_CHECKS.HREFLANG_EXISTS.explanation,
      });
      log.info(`No hreflang tags found for URL: ${url}`);
    } else {
      checks.push({
        check: HREFLANG_CHECKS.HREFLANG_EXISTS.check,
        success: true,
      });
      log.info(`Found ${hreflangLinks.length} hreflang tags for URL: ${url}`);
    }

    if (hreflangLinks.length > 0) {
      let selfReferenceFound = false;
      const currentUrl = new URL(url);

      // Validate each hreflang link
      for (const link of hreflangLinks) {
        const hreflang = link.getAttribute('hreflang');
        const href = link.getAttribute('href');

        // Check if hreflang is in head section
        if (!link.closest('head')) {
          checks.push({
            check: HREFLANG_CHECKS.HREFLANG_NOT_IN_HEAD.check,
            success: false,
            explanation: HREFLANG_CHECKS.HREFLANG_NOT_IN_HEAD.explanation,
            hreflang,
            href,
          });
        }

        // Validate language code
        if (hreflang !== 'x-default') {
          const validation = isLangCode(hreflang);
          if (!validation.res) {
            const errorMsg = `${HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.explanation} Error: ${validation.message}`;
            checks.push({
              check: HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.check,
              success: false,
              explanation: errorMsg,
              hreflang,
              href,
            });
          }
        }

        // Check for self-reference
        try {
          const linkUrl = new URL(href, url);
          if (linkUrl.href === currentUrl.href || linkUrl.pathname === currentUrl.pathname) {
            selfReferenceFound = true;
          }
        } catch {
          log.warn(`Invalid hreflang URL: ${href} for page ${url}`);
        }
      }

      // Check self-reference
      if (!selfReferenceFound) {
        checks.push({
          check: HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.check,
          success: false,
          explanation: HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.explanation,
        });
      }
    }

    return { url, checks };
  } catch (error) {
    log.error(`Error validating hreflang for ${url}: ${error.message}`);
    return {
      url,
      checks: [{
        check: HREFLANG_CHECKS.FETCH_ERROR.check,
        success: false,
        explanation: HREFLANG_CHECKS.FETCH_ERROR.explanation,
      }],
    };
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
  if (auditData.auditResult?.status === 'success' || auditData.auditResult?.error) {
    log.info(`Hreflang audit for ${auditUrl} has no issues or failed, skipping suggestions generation`);
    return { ...auditData };
  }

  // transform audit results into suggestions
  const suggestions = [];

  // Iterate through each check type in the audit results
  Object.entries(auditData.auditResult).forEach(([checkType, checkResult]) => {
    if (checkResult.success === false && Array.isArray(checkResult.urls)) {
      checkResult.urls.forEach((url) => {
        suggestions.push({
          type: 'CODE_CHANGE',
          checkType,
          explanation: checkResult.explanation,
          url,
          // eslint-disable-next-line no-use-before-define
          recommendedAction: generateRecommendedAction(checkType),
        });
      });
    }
  });

  log.info(`Generated ${suggestions.length} hreflang suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

/**
 * Generates recommended actions based on the check type.
 *
 * @param {string} checkType - The type of hreflang check that failed.
 * @returns {string} The recommended action for fixing the issue.
 */
function generateRecommendedAction(checkType) {
  switch (checkType) {
    case HREFLANG_CHECKS.HREFLANG_EXISTS.check:
      return 'Add hreflang tags to the <head> section to specify language and region targeting.';
    case HREFLANG_CHECKS.HREFLANG_INVALID_LANGUAGE_CODE.check:
      return 'Update hreflang attribute to use valid ISO 639-1 language codes and ISO 3166-1 Alpha 2 country codes.';
    case HREFLANG_CHECKS.HREFLANG_SELF_REFERENCE_MISSING.check:
      return 'Add a self-referencing hreflang tag that points to the current page with its own language/region.';
    case HREFLANG_CHECKS.HREFLANG_NOT_IN_HEAD.check:
      return 'Move hreflang tags from the body to the <head> section of the HTML document.';
    case HREFLANG_CHECKS.FETCH_ERROR.check:
      return 'Ensure the page is accessible and fix any server or network issues preventing content retrieval.';
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
    log,
  });

  log.info(`Hreflang opportunity created and ${auditData.suggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(hreflangAuditRunner)
  .withPostProcessors([generateSuggestions, opportunityAndSuggestions])
  .build();
