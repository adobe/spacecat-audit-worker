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
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { notFound } from '@adobe/spacecat-shared-http-utils';
import { fetch, ChecksAndErrors, limitTopPages } from '../support/utils.js';
import { getBaseUrlPagesFromSitemaps } from '../sitemap/handler.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';
import { retrieveSiteBySiteId } from '../utils/data-access.js';

/**
 * Retrieves the top pages for a given site.
 *
 * @param url
 * @param {Object} context - The context object containing necessary information.
 * @param log
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of top pages.
 */
async function getTopPagesForSite(url, context, log) {
  try {
    const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);

    const { result } = await ahrefsAPIClient.getTopPages(url, limitTopPages);

    log.info('Received top pages response:', JSON.stringify(result, null, 2));

    const topPages = result?.pages || [];
    if (topPages.length > 0) {
      const topPagesUrls = topPages.map((page) => ({ url: page.url }));
      log.info(`Found ${topPagesUrls.length} top pages`);
      return topPagesUrls;
    } else {
      log.info('No top pages found');
      return [];
    }
  } catch (error) {
    log.error(`Error retrieving top pages for site ${url}: ${error.message}`);
    return [];
  }
}

/**
 * Validates the canonical tag of a given URL
 *
 * @param {string} url - The URL to validate the canonical tag for.
 * @param {Object} log - The logging object to log information.
 * @returns {Promise<Object>} An object containing the canonical URL and an array of checks.
 */
async function validateCanonicalTag(url, log) {
  // in case of undefined or null URL in the 200 top pages list
  if (!url) {
    const errorMessage = 'URL is undefined or null';
    log.error(errorMessage);
    return {
      canonicalUrl: null,
      checks: [{
        check: ChecksAndErrors.URL_UNDEFINED.check,
        error: ChecksAndErrors.URL_UNDEFINED.error,
        success: false,
      }],
    };
  }

  try {
    log.info(`Fetching URL: ${url}`);
    const response = await fetch(url);
    const html = await response.text();

    const dom = new JSDOM(html);
    const { head } = dom.window.document;
    const canonicalLinks = head.querySelectorAll('link[rel="canonical"]');

    // Initialize checks array and canonicalUrl variable
    const checks = [];
    let canonicalUrl = null;

    // Log presence or absence of canonical tags
    if (canonicalLinks.length === 0) {
      checks.push({
        check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
        error: ChecksAndErrors.CANONICAL_TAG_EXISTS.error,
        success: false,
      });
      log.info(`No canonical tag found for URL: ${url}`);
    } else {
      // Log the success of canonical tag existence
      checks.push({
        check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
        success: true,
      });
      log.info(`Canonical tag exists for URL: ${url}`);
    }

    // Handle multiple canonical tags
    if (canonicalLinks.length > 1) {
      checks.push({
        check: ChecksAndErrors.CANONICAL_TAG_ONCE.check,
        error: ChecksAndErrors.CANONICAL_TAG_ONCE.error,
        success: false,
      });
      log.info(`Multiple canonical tags found for URL: ${url}`);
    } else if (canonicalLinks.length === 1) {
      const canonicalLink = canonicalLinks[0];
      log.info(`Canonical link element: ${JSON.stringify(canonicalLink.outerHTML)}`);

      const href = canonicalLink.getAttribute('href');
      if (!href) {
        checks.push({
          check: ChecksAndErrors.CANONICAL_TAG_NONEMPTY.check,
          error: ChecksAndErrors.CANONICAL_TAG_NONEMPTY.error,
          success: false,
        });
        log.info(`Empty canonical tag found for URL: ${url}`);
      } else {
        try {
          canonicalUrl = new URL(href, url).toString();
          checks.push({
            check: ChecksAndErrors.CANONICAL_TAG_NONEMPTY.check,
            success: true,
          });
          log.info(`Valid canonical URL resolved: ${canonicalUrl}`);
          // Check if canonical URL points to itself
          if (canonicalUrl === url) {
            checks.push({
              check: ChecksAndErrors.CANONICAL_SELF_REFERENCED.check,
              success: true,
            });
            log.info(`Canonical URL correctly references itself: ${canonicalUrl}`);
          } else {
            checks.push({
              check: ChecksAndErrors.CANONICAL_SELF_REFERENCED.check,
              error: ChecksAndErrors.CANONICAL_SELF_REFERENCED.error,
              success: false,
            });
            log.info(`Canonical URL does not reference itself: ${canonicalUrl}`);
          }
        } catch (error) {
          checks.push({
            check: ChecksAndErrors.CANONICAL_TAG_NONEMPTY.check,
            error: 'invalid-canonical-url',
            success: false,
          });
          log.error(`Invalid canonical URL found: ${href} on page ${url}`);
        }
      }

      // Check if canonical link is in the head section
      if (!canonicalLink.closest('head')) {
        checks.push({
          check: ChecksAndErrors.CANONICAL_TAG_IN_HEAD.check,
          error: ChecksAndErrors.CANONICAL_TAG_IN_HEAD.error,
          success: false,
        });
        log.info(`Canonical tag is not in the head section for URL: ${url}`);
      } else {
        checks.push({
          check: ChecksAndErrors.CANONICAL_TAG_IN_HEAD.check,
          success: true,
        });
        log.info(`Canonical tag is in the head section for URL: ${url}`);
      }
    }

    log.info(`Validation checks for URL: ${url}, Checks: ${JSON.stringify(checks)}`);
    return { canonicalUrl, checks };
  } catch (error) {
    const errorMessage = `Error validating canonical tag for ${url}: ${error.message}`;
    log.error(errorMessage);
    return {
      canonicalUrl: null,
      checks: [{
        check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
        error: 'Error fetching or parsing HTML document',
        success: false,
      }],
    };
  }
}

/**
 * Validates if the canonical URL is present in the sitemap.
 *
 * @param {Object} pageLinks - An array of page links from the sitemap.
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @returns {Object} An object containing the check result and any error if the check failed.
 */
function validateCanonicalInSitemap(pageLinks, canonicalUrl) {
  if (pageLinks.includes(canonicalUrl)) {
    return { check: ChecksAndErrors.CANONICAL_URL_IN_SITEMAP.check, success: true };
  }
  return {
    check: ChecksAndErrors.CANONICAL_URL_IN_SITEMAP.check,
    error: ChecksAndErrors.CANONICAL_URL_IN_SITEMAP.error,
  };
}

/**
 * Validates the format of a canonical URL against a base URL.
 *
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @param {string} baseUrl - The base URL to compare against.
 * @param log
 * @returns {Array<Object>} Array of check results, each with a check and error if the check failed.
 */
function validateCanonicalUrlFormat(canonicalUrl, baseUrl, log) {
  const url = new URL(canonicalUrl);
  const base = new URL(baseUrl);
  const checks = [];

  // Check if the canonical URL is absolute
  if (!url.href.startsWith('http://') && !url.href.startsWith('https://')) {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_ABSOLUTE.check,
      error: ChecksAndErrors.CANONICAL_URL_ABSOLUTE.error,
    });
    log.info(`Canonical URL is not absolute: ${canonicalUrl}`);
  } else {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_ABSOLUTE.check,
      success: true,
    });
    log.info(`Canonical URL is absolute: ${canonicalUrl}`);
  }

  // Check if the canonical URL has the same protocol as the base URL
  if (!url.href.startsWith(base.protocol)) {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_SAME_PROTOCOL.check,
      error: ChecksAndErrors.CANONICAL_URL_SAME_PROTOCOL.error,
    });
    log.info(`Canonical URL does not have the same protocol as base URL: ${canonicalUrl}`);
  } else {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_SAME_PROTOCOL.check,
      success: true,
    });
    log.info(`Canonical URL has the same protocol as base URL: ${canonicalUrl}`);
  }

  // Check if the canonical URL has the same domain as the base URL
  if (url.hostname !== base.hostname) {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_SAME_DOMAIN.check,
      error: ChecksAndErrors.CANONICAL_URL_SAME_DOMAIN.error,
    });
    log.info(`Canonical URL does not have the same domain as base URL: ${canonicalUrl}`);
  } else {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_SAME_DOMAIN.check,
      success: true,
    });
    log.info(`Canonical URL has the same domain as base URL: ${canonicalUrl}`);
  }

  // Check if the canonical URL is in lowercase
  if (canonicalUrl !== canonicalUrl.toLowerCase()) {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_LOWERCASED.check,
      error: ChecksAndErrors.CANONICAL_URL_LOWERCASED.error,
    });
    log.info(`Canonical URL is not in lowercase: ${canonicalUrl}`);
  } else {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_LOWERCASED.check,
      success: true,
    });
    log.info(`Canonical URL is in lowercase: ${canonicalUrl}`);
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
async function validateCanonicalUrlContentsRecursive(canonicalUrl, log, visitedUrls = new Set()) {
  const checks = [];

  // Check for redirect loops
  if (visitedUrls.has(canonicalUrl)) {
    log.error(`Detected a redirect loop for canonical URL ${canonicalUrl}`);
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_NO_REDIRECT.check,
      error: ChecksAndErrors.CANONICAL_URL_NO_REDIRECT.error,
      success: false,
    });
    return checks;
  }

  // Add the current URL to the visited set
  visitedUrls.add(canonicalUrl);

  try {
    const response = await fetch(canonicalUrl);
    const finalUrl = response.url;

    // Only accept 2xx responses
    if (response.ok) { // 2xx status codes
      log.info(`Canonical URL is valid and accessible: ${canonicalUrl}`);
      checks.push({
        check: ChecksAndErrors.CANONICAL_URL_STATUS_OK.check,
        success: true,
      });

      // Check for redirection to another URL
      if (canonicalUrl !== finalUrl) {
        log.info(`Canonical URL redirects to: ${finalUrl}`);
        const result = await validateCanonicalUrlContentsRecursive(finalUrl, log, visitedUrls);
        checks.push(...result.checks);
      } else {
        checks.push({
          check: ChecksAndErrors.CANONICAL_URL_NO_REDIRECT.check,
          success: true,
        });
      }
    } else if (response.status >= 300 && response.status < 400) {
      log.error(`Canonical URL returned a 3xx redirect: ${canonicalUrl}`);
      checks.push({
        check: ChecksAndErrors.CANONICAL_URL_3XX.check,
        error: ChecksAndErrors.CANONICAL_URL_3XX.error,
        success: false,
      });
    } else if (response.status >= 400 && response.status < 500) {
      log.error(`Canonical URL returned a 4xx error: ${canonicalUrl}`);
      checks.push({
        check: ChecksAndErrors.CANONICAL_URL_4XX.check,
        error: ChecksAndErrors.CANONICAL_URL_4XX.error,
        success: false,
      });
    } else if (response.status >= 500) {
      log.error(`Canonical URL returned a 5xx error: ${canonicalUrl}`);
      checks.push({
        check: ChecksAndErrors.CANONICAL_URL_5XX.check,
        error: ChecksAndErrors.CANONICAL_URL_5XX.error,
        success: false,
      });
    } else {
      log.error(`Unexpected status code ${response.status} for canonical URL: ${canonicalUrl}`);
      checks.push({
        check: ChecksAndErrors.UNEXPECTED_STATUS_CODE.check,
        error: ChecksAndErrors.UNEXPECTED_STATUS_CODE.error,
        success: false,
      });
    }
  } catch (error) {
    log.error(`Error fetching canonical URL ${canonicalUrl}: ${error.message}`);
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_FETCH_ERROR.check,
      error: ChecksAndErrors.CANONICAL_URL_FETCH_ERROR.error,
      success: false,
    });
  }

  return checks;
}

/**
 * Audits the canonical URLs for a given site.
 *
 * @param {string} input -- not sure if baseURL like in apex or siteId as we see in logs
 * @param {Object} context - The context object containing necessary information.
 * @param {Object} context.log - The logging object to log information.
 * @returns {Promise<Object>} An object containing the audit results.
 */
export async function canonicalAuditRunner(input, context) {
  const { log, dataAccess } = context;
  log.info(`Starting canonical audit with input: ${JSON.stringify(input)}`);
  // temporary, to check what input it gets
  let baseURL = input;

  try {
    // Retrieve site information if input is not a URL
    if (!baseURL.startsWith('https://')) {
      const site = await retrieveSiteBySiteId(dataAccess, input, log);
      if (!site) {
        return notFound('Site not found');
      }
      baseURL = site.getBaseURL();
      log.info(`Retrieved base URL: ${baseURL} for site ID: ${input}`);
    }

    // Get top pages for the site
    const topPages = await getTopPagesForSite(baseURL, context, log);
    log.info(`Top pages for baseURL ${baseURL}: ${JSON.stringify(topPages)}`);

    if (topPages.length === 0) {
      log.info('No top pages found, ending audit.');
      return {
        domain: baseURL,
        results: [{
          check: ChecksAndErrors.TOPPAGES.check,
          error: ChecksAndErrors.TOPPAGES.error,
        }],
        success: false,
      };
    }

    // Aggregate page links from sitemaps
    const aggregatedPageLinks = await getBaseUrlPagesFromSitemaps(
      baseURL,
      topPages.map((page) => page.url),
    );
    log.info(`Aggregated page links from sitemaps for baseURL ${baseURL}: ${JSON.stringify(aggregatedPageLinks)}`);

    // Audit each top page
    const auditPromises = topPages.map(async (page) => {
      const { url } = page;
      log.info(`Validating canonical tag for URL: ${url}`);
      const checks = [];

      const { canonicalUrl, checks: canonicalTagChecks } = await validateCanonicalTag(url, log);
      checks.push(...canonicalTagChecks);

      if (canonicalUrl) {
        log.info(`Found canonical URL: ${canonicalUrl}`);

        const urlFormatChecks = validateCanonicalUrlFormat(canonicalUrl, baseURL, log);
        log.info(`validateCanonicalUrlFormat results for ${canonicalUrl}: ${JSON.stringify(urlFormatChecks)}`);
        checks.push(...urlFormatChecks);

        const urlContentCheck = await validateCanonicalUrlContentsRecursive(canonicalUrl, log);
        log.info(`validateCanonicalUrlContentsRecursive result for ${canonicalUrl}: ${JSON.stringify(urlContentCheck)}`);
        checks.push(...urlContentCheck);

        // Run validateCanonicalInSitemap but do not include it in checks
        const sitemapCheck = validateCanonicalInSitemap(aggregatedPageLinks, canonicalUrl);
        log.info(`validateCanonicalInSitemap results for ${canonicalUrl}: ${JSON.stringify(sitemapCheck)}`);
      }

      log.info(`Checks for URL ${url}: ${JSON.stringify(checks)}`);
      return { url, checks };
    });

    const auditResultsArray = await Promise.all(auditPromises);
    const aggregatedResults = auditResultsArray.reduce((acc, result) => {
      const { url, checks } = result;
      checks.forEach((check) => {
        const { check: checkType, success, error } = check;
        if (!acc[checkType]) {
          acc[checkType] = { success, error, url: [] };
        }
        acc[checkType].url.push(url);
      });
      return acc;
    }, {});

    log.info(`Successfully completed canonical audit for site: ${baseURL}`);
    log.info(`Audit results: ${JSON.stringify(aggregatedResults)}`);

    return {
      fullAuditRef: baseURL,
      auditResult: aggregatedResults,
    };
  } catch (error) {
    log.error(`canonical audit for site ${baseURL} failed with error: ${error.message} ${JSON.stringify(error)}`, error);
    return {
      error: `Audit failed with error: ${error.message}`,
      success: false,
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(canonicalAuditRunner)
  .build();
