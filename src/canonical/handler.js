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
import { composeBaseURL, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';

export const CANONICAL_CHECKS = Object.freeze({
  CANONICAL_TAG_EXISTS: {
    check: 'canonical-tag-exists',
    explanation: 'The canonical tag is missing, which can lead to duplicate content issues and negatively affect SEO rankings.',
  },
  CANONICAL_TAG_ONCE: {
    check: 'canonical-tag-once',
    explanation: 'Multiple canonical tags detected, which confuses search engines and can dilute page authority.',
  },
  CANONICAL_TAG_NONEMPTY: {
    check: 'canonical-tag-nonempty',
    explanation: 'The canonical tag is empty. It should point to the preferred version of the page to avoid content duplication.',
  },
  CANONICAL_TAG_IN_HEAD: {
    check: 'canonical-tag-in-head',
    explanation: 'The canonical tag must be placed in the head section of the HTML document to ensure it is recognized by search engines.',
  },
  CANONICAL_URL_STATUS_OK: {
    check: 'canonical-url-status-ok',
    explanation: 'The canonical URL should return a 200 status code to ensure it is accessible and indexable by search engines.',
  },
  CANONICAL_URL_NO_REDIRECT: {
    check: 'canonical-url-no-redirect',
    explanation: 'The canonical URL should be a direct link without redirects to ensure search engines recognize the intended page.',
  },
  CANONICAL_URL_4XX: {
    check: 'canonical-url-4xx',
    explanation: 'The canonical URL returns a 4xx error, indicating it is inaccessible, which can harm SEO visibility.',
  },
  CANONICAL_URL_5XX: {
    check: 'canonical-url-5xx',
    explanation: 'The canonical URL returns a 5xx server error, indicating it is temporarily or permanently unavailable, affecting SEO performance.',
  },
  CANONICAL_SELF_REFERENCED: {
    check: 'canonical-self-referenced',
    explanation: 'The canonical URL should point to itself to indicate that it is the preferred version of the content.',
  },
  CANONICAL_URL_ABSOLUTE: {
    check: 'canonical-url-absolute',
    explanation: 'Canonical URLs must be absolute to avoid ambiguity in URL resolution and ensure proper indexing by search engines.',
  },
  CANONICAL_URL_SAME_DOMAIN: {
    check: 'canonical-url-same-domain',
    explanation: 'The canonical URL should match the domain of the page to avoid signaling to search engines that the content is duplicated elsewhere.',
  },
  CANONICAL_URL_SAME_PROTOCOL: {
    check: 'canonical-url-same-protocol',
    explanation: 'The canonical URL must use the same protocol (HTTP or HTTPS) as the page to maintain consistency and avoid indexing issues.',
  },
  CANONICAL_URL_LOWERCASED: {
    check: 'canonical-url-lowercased',
    explanation: 'Canonical URLs should be in lowercase to prevent duplicate content issues since URLs are case-sensitive.',
  },
  CANONICAL_URL_FETCH_ERROR: {
    check: 'canonical-url-fetch-error',
    explanation: 'There was an error fetching the canonical URL, which prevents validation of the canonical tag.',
  },
  CANONICAL_URL_INVALID: {
    check: 'canonical-url-invalid',
    explanation: 'The canonical URL is malformed or invalid.',
  },
  TOPPAGES: {
    check: 'top-pages',
    explanation: 'No top pages found',
  },
  URL_UNDEFINED: {
    check: 'url-defined',
    explanation: 'The URL is undefined or null, which prevents the canonical tag validation process.',
  },
  UNEXPECTED_STATUS_CODE: {
    check: 'unexpected-status-code',
    explanation: 'The response returned an unexpected status code, indicating an unforeseen issue with the canonical URL.',
  },
});

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
 * @returns {Promise<Object>} An object containing the canonical URL and an array of checks.
 */
export async function validateCanonicalTag(url, log) {
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
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const { document } = dom.window;

    const canonicalLinks = document.querySelectorAll('link[rel="canonical"]');
    const checks = [];
    let canonicalUrl = null;

    // Check if any canonical tag exists
    if (canonicalLinks.length === 0) {
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_TAG_EXISTS.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_TAG_EXISTS.explanation,
      });
      log.info(`No canonical tag found for URL: ${url}`);
    } else {
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_TAG_EXISTS.check,
        success: true,
      });
      log.info(`Canonical tag exists for URL: ${url}`);
    }

    // Proceed with the checks only if there is at least one canonical tag
    if (canonicalLinks.length > 0) {
      if (canonicalLinks.length > 1) {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_TAG_ONCE.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_TAG_ONCE.explanation,
        });
        log.info(`Multiple canonical tags found for URL: ${url}`);
      } else {
        const canonicalLink = canonicalLinks[0];
        const href = canonicalLink.getAttribute('href');
        if (!href) {
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_NONEMPTY.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_NONEMPTY.explanation,
          });
          log.info(`Empty canonical tag found for URL: ${url}`);
        } else {
          try {
            canonicalUrl = href.startsWith('/')
              ? new URL(href, url).toString()
              : new URL(href).toString();

            if (!href.endsWith('/') && canonicalUrl.endsWith('/')) {
              canonicalUrl = canonicalUrl.substring(0, canonicalUrl.length - 1);
            }

            checks.push({
              check: CANONICAL_CHECKS.CANONICAL_TAG_NONEMPTY.check,
              success: true,
            });
            if (canonicalUrl === url) {
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
            check: CANONICAL_CHECKS.CANONICAL_TAG_IN_HEAD.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_IN_HEAD.explanation,
          });
          log.info('Canonical tag is not in the head section');
        } else {
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_IN_HEAD.check,
            success: true,
          });
        }
      }
    }

    log.info(`Checks: ${JSON.stringify(checks)}`);
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
 * @returns {Array<Object>} Array of check results.
 */
export function validateCanonicalFormat(canonicalUrl, baseUrl, log) {
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

  // Check if the canonical URL is in lowercase
  if (canonicalUrl) {
    if (typeof canonicalUrl === 'string') {
      if (canonicalUrl !== canonicalUrl.toLowerCase()) {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.explanation,
        });
        log.info(`Canonical URL is not lowercased: ${canonicalUrl}`);
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

  return checks;
}

/**
 * Recursively validates the contents of a canonical URL.
 *
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @param {Object} log - The logging object to log information.
 * @param {Set<string>} [visitedUrls=new Set()] - A set of visited URLs to detect redirect loops.
 * @returns {Promise<Object>} An object with the check result and any error if the check failed.
 */
export async function validateCanonicalRecursively(canonicalUrl, log, visitedUrls = new Set()) {
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
    const response = await fetch(canonicalUrl, { redirect: 'manual' });
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

export async function canonicalCheck(baseURL, url, log) {
  const checks = [];

  const { canonicalUrl, checks: canonicalTagChecks } = await validateCanonicalTag(url, log);
  checks.push(...canonicalTagChecks);

  if (canonicalUrl) {
    log.info(`Found Canonical URL: ${canonicalUrl}`);

    const urlFormatChecks = validateCanonicalFormat(canonicalUrl, baseURL, log);
    checks.push(...urlFormatChecks);

    const urlContentCheck = await validateCanonicalRecursively(canonicalUrl, log);
    checks.push(...urlContentCheck);
  }

  return checks;
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

    const auditPromises = topPages.map(async (page) => {
      const { url } = page;
      const checks = await canonicalCheck(baseURL, url, log);
      return { url, checks };
    });

    const auditResultsArray = await Promise.allSettled(auditPromises);
    const aggregatedResults = auditResultsArray.reduce((acc, result) => {
      if (result.status === 'fulfilled') {
        const { url, checks } = result.value;
        checks.forEach((check) => {
          const { check: checkType, success, error } = check;
          if (!acc[checkType]) {
            acc[checkType] = { success, error, url: [] };
          }
          acc[checkType].url.push(url);
        });
      }
      return acc;
    }, {});

    log.info(`Successfully completed Canonical Audit for site: ${baseURL}`);

    return {
      fullAuditRef: baseURL,
      auditResult: aggregatedResults,
    };
  } catch (error) {
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
  .withUrlResolver(noopUrlResolver)
  .withRunner(canonicalAuditRunner)
  .build();
