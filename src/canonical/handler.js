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

import { JSDOM } from 'jsdom';
import { composeBaseURL, tracingFetch as fetch, retrievePageAuthentication } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { isPreviewPage } from '../utils/url-utils.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { CANONICAL_CHECKS } from './constants.js';

/**
 * @import {type RequestOptions} from "@adobe/fetch"
*/

const auditType = Audit.AUDIT_TYPES.CANONICAL;

/**
 * Retrieves the top pages for a given site.
 *
 * @param dataAccess
 * @param {string} siteId - The page of the site to retrieve the top pages for.
 * @param {Object} context - The context object containing necessary information.
 * @param log
 * @param {Object} context.log - The logging object to log information.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of top pages.
 */
export async function getTopPagesForSiteId(dataAccess, siteId, context, log) {
  try {
    const { SiteTopPage } = dataAccess;
    const result = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    log.info('Received top pages response:', JSON.stringify(result, null, 2));

    const topPages = result || [];
    if (topPages.length > 0) {
      const topPagesUrls = topPages.map((page) => ({ url: page.getUrl() }));
      log.info(`Found ${topPagesUrls.length} top pages`);
      return topPagesUrls;
    } else {
      log.info('No top pages found');
      return [];
    }
  } catch (error) {
    log.error(`Error retrieving top pages for site ${siteId}: ${error.message}`);
    throw error;
  }
}

/**
 * Validates the canonical tag of a given URL
 *
 * @param {string} url - The URL to validate the canonical tag for.
 * @param {Object} log - The logging object to log information.
 * @param {RequestOptions} options - The options object to pass to the fetch function.
 * @param {boolean} isPreview - Whether the URL is for a preview page.
 * @returns {Promise<Object>} An object containing the canonical URL and an array of checks.
 */
export async function validateCanonicalTag(url, log, options = {}, isPreview = false) {
  // in case of undefined or null URL in the 200 top pages list
  if (!url) {
    const errorMessage = 'URL is undefined or null';
    log.error(errorMessage);
    return {
      canonicalUrl: null,
      checks: [{
        check: CANONICAL_CHECKS.URL_UNDEFINED.check,
        success: false,
        explanation: CANONICAL_CHECKS.URL_UNDEFINED.explanation,
      }],
    };
  }

  try {
    log.info(`Fetching URL: ${url}`);
    const response = await fetch(url, options);
    // finalUrl is the URL after any redirects
    const finalUrl = response.url;
    const html = await response.text();
    const dom = new JSDOM(html);
    const { document } = dom.window;

    const canonicalLinks = document.querySelectorAll('link[rel="canonical"]');
    const checks = [];
    let canonicalUrl = null;

    // Check if any canonical tag exists
    if (canonicalLinks.length === 0) {
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.explanation,
      });
      log.info(`No canonical tag found for URL: ${url}`);
    } else {
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.check,
        success: true,
      });
      log.info(`Canonical tag exists for URL: ${url}`);
    }

    // Proceed with the checks only if there is at least one canonical tag
    if (canonicalLinks.length > 0) {
      if (canonicalLinks.length > 1) {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE.explanation,
        });
        log.info(`Multiple canonical tags found for URL: ${url}`);
      } else {
        const canonicalLink = canonicalLinks[0];
        const href = canonicalLink.getAttribute('href');
        if (!href) {
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.explanation,
          });
          log.info(`Empty canonical tag found for URL: ${url}`);
        } else {
          try {
            canonicalUrl = href.startsWith('/')
              ? new URL(href, finalUrl).toString()
              : new URL(href).toString();

            if (!href.endsWith('/') && canonicalUrl.endsWith('/')) {
              canonicalUrl = canonicalUrl.substring(0, canonicalUrl.length - 1);
            }

            checks.push({
              check: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.check,
              success: true,
            });
            const normalize = (u) => (typeof u === 'string' && u.endsWith('/') ? u.slice(0, -1) : u);
            const canonicalPath = normalize(new URL(canonicalUrl).pathname).replace(/\/([^/]+)\.[a-zA-Z0-9]+$/, '/$1');
            const finalPath = normalize(new URL(finalUrl).pathname).replace(/\/([^/]+)\.[a-zA-Z0-9]+$/, '/$1');
            const normalizedCanonical = normalize(canonicalUrl);
            const normalizedFinal = normalize(finalUrl);
            if ((isPreview && canonicalPath === finalPath)
                || normalizedCanonical === normalizedFinal) {
              checks.push({
                check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
                success: true,
              });
              log.info(`Canonical URL ${canonicalUrl} references itself`);
            } else {
              checks.push({
                check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
                success: false,
                explanation: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.explanation,
              });
              log.info(`Canonical URL ${canonicalUrl} does not reference itself`);
            }
          } catch {
            checks.push({
              check: CANONICAL_CHECKS.CANONICAL_URL_INVALID.check,
              success: false,
              explanation: CANONICAL_CHECKS.CANONICAL_URL_INVALID.explanation,
            });
            log.info(`Invalid canonical URL found for page ${url}`);
          }
        }

        // Check if canonical link is in the head section
        if (!canonicalLink.closest('head')) {
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.explanation,
          });
          log.info('Canonical tag is not in the head section');
        } else {
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
            success: true,
          });
        }
      }
    }

    return { canonicalUrl, checks };
  } catch (error) {
    const errorMessage = `Error validating canonical tag for ${url}: ${error.message}`;
    log.error(errorMessage);
    return {
      canonicalUrl: null,
      checks: [{
        check: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.explanation,
      }],
    };
  }
}

/**
 * Validates the format of a canonical URL against a base URL.
 *
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @param {string} baseUrl - The base URL to compare against.
 * @param log
 * @param {boolean} isPreview - Whether the URL is for a preview page.
 * @returns {Array<Object>} Array of check results.
 */
export function validateCanonicalFormat(canonicalUrl, baseUrl, log, isPreview = false) {
  const checks = [];
  let base;

  try {
    base = new URL(baseUrl);
  } catch {
    log.error(`Invalid URL: ${baseUrl}`);
    checks.push({
      check: CANONICAL_CHECKS.URL_UNDEFINED.check,
      success: false,
      explanation: CANONICAL_CHECKS.URL_UNDEFINED.explanation,
    });
    return checks;
  }

  // Check if the canonical URL is fully uppercased
  if (canonicalUrl) {
    if (typeof canonicalUrl === 'string') {
      const isAllCaps = canonicalUrl === canonicalUrl.toUpperCase();
      if (isAllCaps) {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.explanation,
        });
        log.info(`Canonical URL is fully uppercased: ${canonicalUrl}`);
      } else {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.check,
          success: true,
        });
      }
    } else {
      checks.push({
        check: CANONICAL_CHECKS.URL_UNDEFINED.check,
        success: false,
        explanation: CANONICAL_CHECKS.URL_UNDEFINED.explanation,
      });
      return checks;
    }
  }

  // Check if the canonical URL is absolute
  if (!canonicalUrl.startsWith('http://') && !canonicalUrl.startsWith('https://')) {
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.check,
      success: false,
      explanation: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.explanation,
    });
    log.info('Canonical URL is not absolute');
  } else {
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.check,
      success: true,
    });
    let url;

    try {
      url = new URL(canonicalUrl);
    } catch {
      log.error(`Invalid URL: ${canonicalUrl}`);
      checks.push({
        check: CANONICAL_CHECKS.URL_UNDEFINED.check,
        success: false,
        explanation: CANONICAL_CHECKS.URL_UNDEFINED.explanation,
      });
      return checks;
    }

    // Check if the canonical URL has the same protocol as the base URL
    if (!url.href.startsWith(base.protocol)) {
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.explanation,
      });
      log.info(`Canonical URL  ${canonicalUrl} uses a different protocol than base URL ${baseUrl}`);
    } else {
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.check,
        success: true,
      });
    }

    // Check if the canonical URL has the same domain as the base URL
    if (!isPreview) {
      if (composeBaseURL(url.hostname) !== composeBaseURL(base.hostname)) {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.explanation,
        });
        log.info(`Canonical URL ${canonicalUrl} does not have the same domain as base URL ${baseUrl}`);
      } else {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.check,
          success: true,
        });
      }
    }
  }

  return checks;
}

/**
 * Recursively validates the contents of a canonical URL.
 *
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @param {Object} log - The logging object to log information.
 * @param {RequestOptions} options - The options object to pass to the fetch function.
 * @param {Set<string>} [visitedUrls=new Set()] - A set of visited URLs to detect redirect loops.
 * @returns {Promise<Object>} An object with the check result and any error if the check failed.
 */
export async function validateCanonicalRecursively(
  canonicalUrl,
  log,
  options = {},
  visitedUrls = new Set(),
) {
  const checks = [];

  // Check for redirect loops
  if (visitedUrls.has(canonicalUrl)) {
    log.info(`Detected a redirect loop for canonical URL ${canonicalUrl}`);
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
      success: false,
      explanation: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.explanation,
    });
    return checks;
  }

  // Add the current URL to the visited set
  visitedUrls.add(canonicalUrl);

  try {
    const response = await fetch(canonicalUrl, { ...options, redirect: 'manual' });
    if (response.ok) {
      log.info(`Canonical URL is accessible: ${canonicalUrl}, statusCode: ${response.status}`);
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_STATUS_OK.check,
        success: true,
      });
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
        success: true,
      });
    } else if ([301, 302, 303, 307, 308].includes(response.status)) {
      log.info(`Canonical URL ${canonicalUrl} returned a 3xx status: ${response.status}`);
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.explanation,
      });
    } else if (response.status >= 400 && response.status < 500) {
      log.info(`Canonical URL ${canonicalUrl} returned a 4xx error: ${response.status}`);
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_4XX.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_4XX.explanation,
      });
    } else if (response.status >= 500) {
      log.info(`Canonical URL ${canonicalUrl} returned a 5xx error: ${response.status} `);
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_5XX.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_5XX.explanation,
      });
    } else {
      log.info(`Unexpected status code ${response.status} for canonical URL: ${canonicalUrl}`);
      checks.push({
        check: CANONICAL_CHECKS.UNEXPECTED_STATUS_CODE.check,
        success: false,
        explanation: CANONICAL_CHECKS.UNEXPECTED_STATUS_CODE.explanation,
      });
    }
  } catch (error) {
    log.error(`Error fetching canonical URL ${canonicalUrl}: ${error.message}`);
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.check,
      success: false,
      explanation: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.explanation,
    });
  }

  return checks;
}

/**
 * Generates a suggestion for fixing a canonical issue based on the check type and URL.
 *
 * @param {string} checkType - The type of canonical check that failed.
 * @param {string} url - The URL that has the canonical issue.
 * @param {string} baseURL - The base URL of the site.
 * @returns {string} A suggestion for fixing the canonical issue.
 */
export function generateCanonicalSuggestion(checkType, url, baseURL) {
  const checkObj = Object.values(CANONICAL_CHECKS).find((check) => check.check === checkType);

  if (checkObj && checkObj.suggestion) {
    return checkObj.suggestion(url, baseURL);
  }

  // fallback suggestion
  return 'Review and fix the canonical tag implementation according to SEO best practices.';
}

/**
 * Audits the canonical URLs for a given site.
 *
 * @param {string} baseURL -- not sure if baseURL like in apex or siteId as we see in logs
 * @param {Object} context - The context object containing necessary information.
 * @param {Object} context.log - The logging object to log information.
 * @param {Object} site
 * @returns {Promise<Object>} An object containing the audit results.
 */
export async function canonicalAuditRunner(baseURL, context, site) {
  const siteId = site.getId();
  const { log, dataAccess } = context;
  log.info(`Starting Canonical Audit with siteId: ${JSON.stringify(siteId)}`);

  try {
    const topPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
    log.info(`Top pages for baseURL ${baseURL}: ${JSON.stringify(topPages)}`);

    if (topPages.length === 0) {
      log.info('No top pages found, ending audit.');

      return {
        fullAuditRef: baseURL,
        auditResult: {
          check: CANONICAL_CHECKS.TOPPAGES.check,
          success: false,
          explanation: CANONICAL_CHECKS.TOPPAGES.explanation,
        },
      };
    }

    /**
     * @type {RequestOptions}
     */
    const options = {};
    if (isPreviewPage(baseURL)) {
      try {
        log.info(`Retrieving page authentication for pageUrl ${baseURL}`);
        const token = await retrievePageAuthentication(site, context);
        options.headers = {
          Authorization: `token ${token}`,
        };
      } catch (error) {
        log.error(`Error retrieving page authentication for pageUrl ${baseURL}: ${error.message}`);
      }
    }

    // Exclude login/authentication-related pages from canonical checks
    const shouldSkipAuthPage = (u) => {
      const pathname = new URL(u).pathname.toLowerCase();
      return pathname.includes('/login')
        || pathname.includes('/signin')
        || pathname.includes('/authenticate')
        || pathname.includes('/oauth')
        || pathname.includes('/sso')
        || pathname === '/auth'
        || pathname.startsWith('/auth/');
    };

    const filteredTopPages = topPages.filter(({ url }) => {
      if (shouldSkipAuthPage(url)) {
        log.info(`Skipping canonical checks for auth/login page: ${url}`);
        return false;
      }
      return true;
    });

    const auditPromises = filteredTopPages.map(async (page) => {
      const { url } = page;
      const checks = [];

      const {
        canonicalUrl, checks: canonicalTagChecks,
      } = await validateCanonicalTag(url, log, options);
      checks.push(...canonicalTagChecks);

      if (canonicalUrl) {
        log.info(`Found Canonical URL: ${canonicalUrl}`);

        const urlFormatChecks = validateCanonicalFormat(canonicalUrl, baseURL, log);
        checks.push(...urlFormatChecks);

        const urlContentCheck = await validateCanonicalRecursively(canonicalUrl, log, options);
        checks.push(...urlContentCheck);
      }
      return { url, checks };
    });

    const auditResultsArray = await Promise.allSettled(auditPromises);
    const aggregatedResults = auditResultsArray.reduce((acc, result) => {
      if (result.status === 'fulfilled') {
        const { url, checks } = result.value;
        checks.forEach((check) => {
          const { check: checkType, success, explanation } = check;

          // only process failed checks
          if (success === false) {
            if (!acc[checkType]) {
              acc[checkType] = {
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

    const filteredAggregatedResults = Object.fromEntries(
      Object.entries(aggregatedResults).filter(
        ([checkType]) => checkType !== CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.check,
      ),
    );

    log.info(`Successfully completed Canonical Audit for site: ${baseURL}`);

    // all checks are successful, no issues were found
    if (Object.keys(filteredAggregatedResults).length === 0) {
      return {
        fullAuditRef: baseURL,
        auditResult: {
          status: 'success',
          message: 'No canonical issues detected',
        },
      };
    }

    // final results structure
    const results = Object.entries(filteredAggregatedResults).map(([checkType, checkData]) => ({
      type: checkType,
      explanation: checkData.explanation,
      affectedUrls: checkData.urls.map((url) => ({
        url,
        suggestion: generateCanonicalSuggestion(checkType, url, baseURL),
      })),
    }));

    return {
      fullAuditRef: baseURL,
      auditResult: results,
    };
  } catch (error) {
    log.info(`Canonical audit failed for site ${siteId}: ${error.message}`);

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
 * Generates suggestions based on canonical audit results.
 * Transforms the audit result array into a format suitable for the suggestions system.
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results.
 * @param {Object} context - The context object containing log and other utilities.
 * @returns {Object} The audit data with suggestions added.
 */
export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  // if audit failed or has no issues, skip suggestions generation
  if (!Array.isArray(auditData.auditResult)) {
    log.info(`Canonical audit for ${auditUrl} has no issues or failed, skipping suggestions generation`);
    return { ...auditData };
  }

  // transform audit results into suggestions
  const suggestions = auditData.auditResult
    .flatMap((issue) => issue.affectedUrls.map((urlData) => ({
      type: 'CODE_CHANGE',
      checkType: issue.type,
      explanation: issue.explanation,
      url: urlData.url,
      suggestion: urlData.suggestion,
      recommendedAction: urlData.suggestion,
    })));

  log.info(`Generated ${suggestions.length} canonical suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

/**
 * Creates opportunities and syncs suggestions for canonical issues.
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results and suggestions.
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  // if audit failed or has no suggestions, skip opportunity creation
  if (!Array.isArray(auditData.auditResult) || !auditData.suggestions?.length) {
    log.info('Canonical audit has no issues, skipping opportunity creation');
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
        suggestion: suggestion.suggestion,
        recommendedAction: suggestion.recommendedAction,
      },
    }),
  });

  log.info(`Canonical opportunity created and ${auditData.suggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(canonicalAuditRunner)
  .withPostProcessors([generateSuggestions, opportunityAndSuggestions])
  .build();
