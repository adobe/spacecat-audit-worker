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

import { composeBaseURL, tracingFetch as fetch, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { retrievePageAuthentication } from '@adobe/spacecat-shared-ims-client';
import { load as cheerioLoad } from 'cheerio';

import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { isPreviewPage } from '../utils/url-utils.js';
import { syncSuggestions, keepLatestMergeDataFunction } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityDataForElmo } from './opportunity-data-mapper.js';
import { CANONICAL_CHECKS } from './constants.js';
import { limitConcurrencyAllSettled } from '../support/utils.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';

/**
 * @import {type RequestOptions} from "@adobe/fetch"
*/

const auditType = Audit.AUDIT_TYPES.CANONICAL;
const { AUDIT_STEP_DESTINATIONS } = Audit;

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
 * Step 1: Import top pages (used in multi-step audit)
 */
/* c8 ignore start */
export async function importTopPages(context) {
  const { site, finalUrl } = context;

  return {
    auditResult: { status: 'importing' },
    fullAuditRef: finalUrl,
    siteId: site.getId(),
  };
}
/* c8 ignore stop */

/**
 * Step 2: Submit pages for scraping with JavaScript rendering
 */
/* c8 ignore start */
export async function submitForScraping(context) {
  const {
    site, log, finalUrl, dataAccess,
  } = context;
  const siteId = site.getId();

  log.info(`Start submitForScraping step for: ${siteId}`);

  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');

  if (!isNonEmptyArray(topPages)) {
    log.info(`No top pages found for site ${siteId}, skipping scraping`);
    return {
      auditResult: {
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      },
      fullAuditRef: finalUrl,
    };
  }

  const topPagesUrls = topPages.map((page) => page.getUrl());
  log.info(`Found ${topPagesUrls.length} top pages for scraping`);

  // Filter out auth pages and PDFs
  const shouldSkipAuthPage = (u) => {
    try {
      const pathname = new URL(u).pathname.toLowerCase();
      return pathname.includes('/login')
        || pathname.includes('/signin')
        || pathname.includes('/authenticate')
        || pathname.includes('/oauth')
        || pathname.includes('/sso')
        || pathname === '/auth'
        || pathname.startsWith('/auth/');
    } catch {
      return false;
    }
  };

  const isPdfUrl = (u) => {
    try {
      const pathname = new URL(u).pathname.toLowerCase();
      return pathname.endsWith('.pdf');
    } catch {
      return false;
    }
  };

  const filteredUrls = topPagesUrls.filter((url) => {
    if (shouldSkipAuthPage(url)) {
      log.info(`Skipping auth/login page: ${url}`);
      return false;
    }
    if (isPdfUrl(url)) {
      log.info(`Skipping PDF file: ${url}`);
      return false;
    }
    return true;
  });

  log.info(`Finish submitForScraping step for: ${siteId}`);

  return {
    auditResult: {
      status: 'SCRAPING_REQUESTED',
      message: 'Content scraping for canonical audit initiated.',
      scrapedUrls: filteredUrls,
    },
    fullAuditRef: finalUrl,
    // Data for the CONTENT_SCRAPER
    urls: filteredUrls.map((url) => ({ url })),
    siteId,
    type: 'default',
    allowCache: false,
    maxScrapeAge: 0,
    options: {
      waitTimeoutForMetaTags: 5000, // Wait for JavaScript to execute
    },
  };
}
/* c8 ignore stop */

/**
 * Validates the canonical tag from HTML content
 *
 * @param {string} url - The URL being validated
 * @param {string} html - The HTML content to parse
 * @param {Object} log - The logging object to log information.
 * @param {boolean} isPreview - Whether the URL is for a preview page.
 * @param {string} finalUrl - The final URL after redirects
 * @returns {Promise<Object>} An object with the canonical URL and checks.
 */
export async function validateCanonicalFromHTML(
  url,
  html,
  log,
  isPreview = false,
  finalUrl = null,
) {
  if (!html) {
    log.error(`No HTML content provided for URL: ${url}`);
    return {
      canonicalUrl: null,
      checks: [],
    };
  }

  const actualFinalUrl = finalUrl || url;

  // Use Cheerio to check if canonical is in <head>
  const $ = cheerioLoad(html);
  const cheerioCanonicalInHead = $('head link[rel="canonical"]').length > 0;
  const canonicalLinks = $('link[rel="canonical"]');

  log.info(`Cheerio found ${canonicalLinks.length} canonical link(s), ${cheerioCanonicalInHead ? 'in HEAD' : 'NOT in HEAD'}`);

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
      const canonicalLink = canonicalLinks.first();
      const href = canonicalLink.attr('href');
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
            ? new URL(href, actualFinalUrl).toString()
            : new URL(href).toString();

          if (!href.endsWith('/') && canonicalUrl.endsWith('/')) {
            canonicalUrl = canonicalUrl.substring(0, canonicalUrl.length - 1);
          }

          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.check,
            success: true,
          });

          const normalize = (u) => (typeof u === 'string' && u.endsWith('/') ? u.slice(0, -1) : u);

          // strip query params and hash
          const stripQueryParams = (u) => {
            try {
              const urlObj = new URL(u);
              return `${urlObj.origin}${urlObj.pathname}`;
              /* c8 ignore next 3 */
            } catch {
              return u;
            }
          };

          const canonicalPath = normalize(new URL(canonicalUrl).pathname).replace(/\/([^/]+)\.[a-zA-Z0-9]+$/, '/$1');
          const finalPath = normalize(new URL(actualFinalUrl).pathname).replace(/\/([^/]+)\.[a-zA-Z0-9]+$/, '/$1');
          const normalizedCanonical = normalize(stripQueryParams(canonicalUrl));
          const normalizedFinal = normalize(stripQueryParams(actualFinalUrl));

          // Check if canonical points to same page (query params are ignored)
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

      // Check if canonical link is in the <head> section.
      if (!cheerioCanonicalInHead) {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.explanation,
        });
        log.info('Canonical tag is not in the head section (detected via Cheerio)');
      } else {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
          success: true,
        });
        log.info('Canonical tag is in the head section (verified via Cheerio)');
      }
    }
  }

  return { canonicalUrl, checks };
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
    log.error('URL is undefined or null, cannot validate canonical tags');
    // Return empty result - URL validation errors should only be logged
    return {
      canonicalUrl: null,
      checks: [],
    };
  }

  try {
    log.info(`Fetching URL: ${url}`);
    const response = await fetch(url, options);
    // finalUrl is the URL after any redirects
    const finalUrl = response.url;
    const html = await response.text();

    // Use the new HTML-based validation function
    return validateCanonicalFromHTML(url, html, log, isPreview, finalUrl);
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
    // Skip adding check for invalid URL - validation errors should only be logged
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
      log.error(`Canonical URL is not a string: ${typeof canonicalUrl}`);
      // Skip adding check for invalid type - validation errors should only be logged
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
      log.error(`Invalid canonical URL: ${canonicalUrl}`);
      // Skip adding check for invalid URL - validation errors should only be logged
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
 * Generates a suggestion for fixing a canonical issue based on the check type.
 *
 * @param {string} checkType - The type of canonical check that failed.
 * @returns {string} A suggestion for fixing the canonical issue.
 */
export function generateCanonicalSuggestion(checkType) {
  const checkObj = Object.values(CANONICAL_CHECKS).find((check) => check.check === checkType);

  if (checkObj && checkObj.suggestion) {
    return checkObj.suggestion;
  }

  // fallback suggestion
  return 'Review and fix the canonical tag implementation according to SEO best practices.';
}

/**
 * Step 3: Process scraped content and generate audit results
 */
/* c8 ignore start */
export async function processScrapedContent(context) {
  const {
    site, log, s3Client, env,
  } = context;
  const siteId = site.getId();
  const baseURL = site.getBaseURL();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  log.info(`Start processScrapedContent step for: ${siteId}`);

  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for canonical audit';
    log.error(`${errorMsg}`);
    return {
      auditResult: {
        status: 'PROCESSING_FAILED',
        error: errorMsg,
      },
      fullAuditRef: baseURL,
    };
  }

  // Get scraped content from S3
  const prefix = `scrapes/${siteId}/`;
  let scrapeKeys;
  try {
    scrapeKeys = await getObjectKeysUsingPrefix(
      s3Client,
      bucketName,
      prefix,
      log,
      1000,
      'scrape.json',
    );
    log.info(`Found ${scrapeKeys.length} scraped objects in S3 for site ${siteId}`);
  } catch (error) {
    log.error(`Error retrieving S3 keys for site ${siteId}: ${error.message}`);
    return {
      auditResult: {
        status: 'PROCESSING_FAILED',
        error: `Failed to retrieve scraped content: ${error.message}`,
      },
      fullAuditRef: baseURL,
    };
  }

  if (scrapeKeys.length === 0) {
    log.info(`No scraped content found for site ${siteId}`);
    return {
      auditResult: {
        status: 'NO_OPPORTUNITIES',
        message: 'No scraped content found',
      },
      fullAuditRef: baseURL,
    };
  }

  // Process each scraped page
  const auditPromises = scrapeKeys.map(async (key) => {
    try {
      const scrapedObject = await getObjectFromKey(s3Client, bucketName, key, log);

      if (!scrapedObject?.scrapeResult?.rawBody) {
        log.warn(`No HTML content in S3 object: ${key}`);
        return null;
      }

      const url = scrapedObject.url || scrapedObject.finalUrl;
      if (!url) {
        log.warn(`No URL found in S3 object: ${key}`);
        return null;
      }

      const html = scrapedObject.scrapeResult.rawBody;
      const finalUrl = scrapedObject.finalUrl || url;
      const isPreview = isPreviewPage(baseURL);

      log.info(`Processing scraped content for: ${url}`);

      // Validate canonical from the JavaScript-rendered HTML
      const {
        canonicalUrl, checks: canonicalTagChecks,
      } = await validateCanonicalFromHTML(url, html, log, isPreview, finalUrl);

      const checks = [...canonicalTagChecks];

      if (canonicalUrl) {
        log.info(`Found Canonical URL: ${canonicalUrl}`);

        const urlFormatChecks = validateCanonicalFormat(canonicalUrl, baseURL, log, isPreview);
        checks.push(...urlFormatChecks);

        // self-reference check
        const selfRefCheck = canonicalTagChecks.find(
          (c) => c.check === CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
        );
        const isSelfReferenced = selfRefCheck?.success === true;

        // if self-referenced - skip accessibility
        if (isSelfReferenced) {
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_URL_STATUS_OK.check,
            success: true,
          });
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
            success: true,
          });
        } else {
          // if not self-referenced - validate accessibility
          log.info(`Canonical URL points to different page, validating accessibility: ${canonicalUrl}`);

          const options = {};
          if (isPreview) {
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

          const urlContentCheck = await validateCanonicalRecursively(canonicalUrl, log, options);
          checks.push(...urlContentCheck);
        }
      }

      return { url, checks };
    } catch (error) {
      log.error(`Error processing scraped content from ${key}: ${error.message}`);
      return null;
    }
  });

  const auditResultsArray = await Promise.allSettled(auditPromises);

  // Aggregate results
  const aggregatedResults = auditResultsArray.reduce((acc, result) => {
    if (result.status === 'fulfilled' && result.value) {
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

  log.info(`Successfully completed canonical audit for site: ${baseURL}`);

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
      suggestion: generateCanonicalSuggestion(checkType),
    })),
  }));

  return {
    fullAuditRef: baseURL,
    auditResult: results,
  };
}
/* c8 ignore stop */

/**
 * Audits the canonical URLs for a given site (legacy single-step function).
 *
 * @param {string} baseURL -- not sure if baseURL like in apex or siteId as we see in logs
 * @param {Object} context - The context object containing necessary information.
 * @param {Object} context.log - The logging object to log information.
 * @param {Object} site
 * @returns {Promise<Object>} An object containing the audit results.
 */
export async function canonicalAuditRunner(baseURL, context, site) {
  const MAX_CONCURRENT_FETCH_CALLS = 10;
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
      try {
        const pathname = new URL(u).pathname.toLowerCase();
        return pathname.includes('/login')
          || pathname.includes('/signin')
          || pathname.includes('/authenticate')
          || pathname.includes('/oauth')
          || pathname.includes('/sso')
          || pathname === '/auth'
          || pathname.startsWith('/auth/');
      } catch {
        // If URL is malformed, don't skip it (return false)
        return false;
      }
    };

    // Exclude PDF files from canonical checks
    const isPdfUrl = (u) => {
      try {
        const pathname = new URL(u).pathname.toLowerCase();
        return pathname.endsWith('.pdf');
      } catch {
        return false;
      }
    };

    const filteredTopPages = topPages.filter(({ url }) => {
      if (shouldSkipAuthPage(url)) {
        log.info(`Skipping canonical checks for auth/login page: ${url}`);
        return false;
      }
      if (isPdfUrl(url)) {
        log.info(`Skipping canonical checks for PDF file: ${url}`);
        return false;
      }
      return true;
    });

    // Check which pages return 200 status
    log.info('Checking HTTP status for top pages...');
    const statusCheckPromises = filteredTopPages.map(({ url }) => async () => {
      try {
        const response = await fetch(url, options);
        const { status } = response;
        const finalUrl = response.url;

        // Check if page redirected to an auth/login page
        if (finalUrl !== url && shouldSkipAuthPage(finalUrl)) {
          log.info(`Page ${url} redirected to auth page ${finalUrl}, skipping`);
          return {
            url, status, isOk: false,
          };
        }

        log.info(`Page ${url} returned status: ${status}`);
        return { url, status, isOk: status === 200 };
      } catch (error) {
        log.error(`Error fetching ${url}: ${error.message}`);
        return { url, status: null, isOk: false };
      }
    });

    // Using AllSettled variant to continue processing other pages even if some fail
    const statusCheckResults = await limitConcurrencyAllSettled(
      statusCheckPromises,
      MAX_CONCURRENT_FETCH_CALLS,
    );
    const pagesWithOkStatus = statusCheckResults.filter(({ isOk }) => isOk);

    if (pagesWithOkStatus.length === 0) {
      log.info('No pages returned 200 status, ending audit without creating opportunities.');
      return {
        fullAuditRef: baseURL,
        auditResult: {
          status: 'success',
          message: 'No pages with 200 status found to analyze for canonical tags',
        },
      };
    }

    log.info(`Found ${pagesWithOkStatus.length} pages with 200 status out of ${filteredTopPages.length} filtered pages`);

    const auditPromises = pagesWithOkStatus.map(({ url }) => async () => {
      const checks = [];

      const {
        canonicalUrl, checks: canonicalTagChecks,
      } = await validateCanonicalTag(url, log, options);
      checks.push(...canonicalTagChecks);

      if (canonicalUrl) {
        log.info(`Found Canonical URL: ${canonicalUrl}`);

        const urlFormatChecks = validateCanonicalFormat(canonicalUrl, baseURL, log);
        checks.push(...urlFormatChecks);

        // self-reference check
        const selfRefCheck = canonicalTagChecks.find(
          (c) => c.check === CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
        );
        const isSelfReferenced = selfRefCheck?.success === true;

        // if self-referenced - skip accessibility
        if (isSelfReferenced) {
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_URL_STATUS_OK.check,
            success: true,
          });
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
            success: true,
          });
        } else {
          // if not self-referenced  - validate accessibility
          log.info(`Canonical URL points to different page, validating accessibility: ${canonicalUrl}`);
          const urlContentCheck = await validateCanonicalRecursively(canonicalUrl, log, options);
          checks.push(...urlContentCheck);
        }
      }
      return { url, checks };
    });

    // Using AllSettled variant to continue processing other pages even if some fail
    const auditResultsArray = await limitConcurrencyAllSettled(
      auditPromises,
      MAX_CONCURRENT_FETCH_CALLS,
    );
    const aggregatedResults = auditResultsArray.reduce((acc, result) => {
      const { url, checks } = result;
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
        suggestion: generateCanonicalSuggestion(checkType),
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

  // Get the order from CANONICAL_CHECKS object
  const auditTypeOrder = [
    ...Object.keys(CANONICAL_CHECKS),
  ];

  // Group suggestions by audit type
  const suggestionsByType = {};
  const allSuggestions = [];

  // transform audit results into suggestions
  auditData.auditResult.forEach((issue) => {
    const checkType = issue.type;
    if (!suggestionsByType[checkType]) {
      suggestionsByType[checkType] = [];
    }

    issue.affectedUrls.forEach((urlData) => {
      const suggestion = {
        type: 'CODE_CHANGE',
        checkType: issue.type,
        explanation: issue.explanation,
        url: urlData.url,
        suggestion: urlData.suggestion,
        recommendedAction: urlData.suggestion,
      };
      suggestionsByType[checkType].push(suggestion);
      allSuggestions.push(suggestion);
    });
  });

  // Build markdown table for Elmo
  let mdTable = '';
  auditTypeOrder.forEach((currentAuditType) => {
    const checkType = CANONICAL_CHECKS[currentAuditType].check;
    if (suggestionsByType[checkType] && suggestionsByType[checkType].length > 0) {
      mdTable += `## ${CANONICAL_CHECKS[currentAuditType].title}\n\n`;
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

  log.info(`Generated ${suggestions.length} canonical suggestions for ${auditUrl}`);
  return { ...auditData, suggestions, elmoSuggestions };
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

/**
 * Creates opportunities and syncs suggestions for canonical issues for Elmo.
 *
 * @param {string} auditUrl - The URL that was audited.
 * @param {Object} auditData - The audit data containing results and suggestions.
 * @param {Object} context - The context object containing log, dataAccess, etc.
 * @returns {Object} The audit data unchanged (opportunities created as side effect).
 */
export async function opportunityAndSuggestionsForElmo(auditUrl, auditData, context) {
  const { log } = context;
  if (!auditData.elmoSuggestions?.length) {
    log.info('Canonical audit has no issues, skipping opportunity creation for Elmo');
    return { ...auditData };
  }

  const elmoOpportunityType = 'generic-opportunity';
  const comparisonFn = (oppty) => {
    const opptyData = oppty.getData();
    const opptyAdditionalMetrics = opptyData?.additionalMetrics;
    if (!opptyAdditionalMetrics || !Array.isArray(opptyAdditionalMetrics)) {
      return false;
    }
    return opptyAdditionalMetrics.some(
      (metric) => metric.key === 'subtype' && metric.value === 'canonical',
    );
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

  log.info(`Canonical opportunity created for Elmo with oppty id ${opportunity.getId()}`);

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

  log.info(`Canonical opportunity created for Elmo and ${auditData.elmoSuggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .addStep('importTopPages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submitForScraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('processScrapedContent', processScrapedContent)
  .withPostProcessors([
    generateSuggestions,
    opportunityAndSuggestions,
    opportunityAndSuggestionsForElmo,
  ])
  .build();
