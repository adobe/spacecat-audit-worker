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

import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { JSDOM } from 'jsdom';
import { notFound } from '@adobe/spacecat-shared-http-utils';
import { fetch } from '../support/utils.js';
// import { getBaseUrlPagesFromSitemaps } from '../sitemap/handler.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';
import { retrieveSiteBySiteId } from '../utils/data-access.js';

// Enums for checks and errors
const ChecksAndErrors = Object.freeze({
  CANONICAL_TAG_EXISTS: {
    check: 'canonical-tag-exists',
    error: 'canonical-tag-not-found',
    explanation: 'The canonical tag is missing, which can lead to duplicate content issues and negatively affect SEO rankings.',
  },
  CANONICAL_TAG_ONCE: {
    check: 'canonical-tag-once',
    error: 'multiple-canonical-tags',
    explanation: 'Multiple canonical tags detected, which confuses search engines and can dilute page authority.',
  },
  CANONICAL_TAG_NONEMPTY: {
    check: 'canonical-tag-nonempty',
    error: 'canonical-tag-empty',
    explanation: 'The canonical tag is empty. It should point to the preferred version of the page to avoid content duplication.',
  },
  CANONICAL_TAG_IN_HEAD: {
    check: 'canonical-tag-in-head',
    error: 'canonical-tag-not-in-head',
    explanation: 'The canonical tag must be placed in the head section of the HTML document to ensure it is recognized by search engines.',
  },
  CANONICAL_URL_IN_SITEMAP: {
    check: 'canonical-url-in-sitemap',
    error: 'canonical-url-not-in-sitemap',
    explanation: 'The canonical URL should be included in the sitemap to facilitate its discovery by search engines, improving indexing.',
  },
  CANONICAL_URL_200: {
    check: 'canonical-url-200',
    error: 'canonical-url-not-200',
    explanation: 'The canonical URL should return a 200 status code to ensure it is accessible and indexable by search engines.',
  },
  CANONICAL_URL_3XX: {
    check: 'canonical-url-3xx',
    error: 'canonical-url-3xx-redirect',
    explanation: 'The canonical URL returns a 3xx redirect, which may lead to confusion for search engines and dilute page authority.',
  },
  CANONICAL_URL_4XX: {
    check: 'canonical-url-4xx',
    error: 'canonical-url-4xx-error',
    explanation: 'The canonical URL returns a 4xx error, indicating it is inaccessible, which can harm SEO visibility.',
  },
  CANONICAL_URL_5XX: {
    check: 'canonical-url-5xx',
    error: 'canonical-url-5xx-error',
    explanation: 'The canonical URL returns a 5xx server error, indicating it is temporarily or permanently unavailable, affecting SEO performance.',
  },
  CANONICAL_URL_NO_REDIRECT: {
    check: 'canonical-url-no-redirect',
    error: 'canonical-url-redirect',
    explanation: 'The canonical URL should be a direct link without redirects to ensure search engines recognize the intended page.',
  },
  CANONICAL_SELF_REFERENCED: {
    check: 'canonical-self-referenced',
    error: 'canonical-url-not-self-referenced',
    explanation: 'The canonical URL should point to itself to indicate that it is the preferred version of the content.',
  },
  CANONICAL_URL_ABSOLUTE: {
    check: 'canonical-url-absolute',
    error: 'canonical-url-not-absolute',
    explanation: 'Canonical URLs must be absolute to avoid ambiguity in URL resolution and ensure proper indexing by search engines.',
  },
  CANONICAL_URL_SAME_DOMAIN: {
    check: 'canonical-url-same-domain',
    error: 'canonical-url-different-domain',
    explanation: 'The canonical URL should match the domain of the page to avoid signaling to search engines that the content is duplicated elsewhere.',
  },
  CANONICAL_URL_SAME_PROTOCOL: {
    check: 'canonical-url-same-protocol',
    error: 'canonical-url-different-protocol',
    explanation: 'The canonical URL must use the same protocol (HTTP or HTTPS) as the page to maintain consistency and avoid indexing issues.',
  },
  CANONICAL_URL_LOWERCASED: {
    check: 'canonical-url-lowercased',
    error: 'canonical-url-not-lowercased',
    explanation: 'Canonical URLs should be in lowercase to prevent duplicate content issues since URLs are case-sensitive.',
  },
  CANONICAL_URL_FETCH_ERROR: {
    check: 'canonical-url-fetch-error',
    error: 'canonical-url-fetch-error',
    explanation: 'There was an error fetching the canonical URL, which prevents validation of the canonical tag.',
  },
  TOPPAGES: {
    check: 'top-pages',
    error: 'no-top-pages-found',
  },
  URL_UNDEFINED: {
    check: 'url-defined',
    error: 'url-undefined',
    explanation: 'The URL is undefined or null, which prevents the canonical tag validation process.',
  },
  UNEXPECTED_STATUS_CODE: {
    check: 'unexpected-status-code',
    error: 'unexpected-status-code',
    explanation: 'The response returned an unexpected status code, indicating an unforeseen issue with the canonical URL.',
  },
});

// const unknowError = 'Unspecified error';

/**
 * Retrieves the top pages for a given site.
 *
 * @param {string} url - The page of the site to retrieve the top pages for.
 * @param {Object} context - The context object containing necessary information.
 * @param log
 * @param {Object} context.log - The logging object to log information.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of top pages.
 */
async function getTopPagesForSite(url, context, log) {
  try {
    const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);

    const { result } = await ahrefsAPIClient.getTopPages(url, 4);

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
    log.info(`Fetched HTML content for URL: ${url}`);

    const dom = new JSDOM(html);
    log.info(`Parsed DOM for URL: ${url}`);

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
          success: false, // Adding success: false
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
        explanation: error.message,
        success: false,
      }],
    };
  }
}

/**
 * Validates if the canonical URL is present in the sitemap.
 *
 * @param {Array<string>} pageLinks - An array of page links from the sitemap.
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @returns {Object} An object containing the check result and any error if the check failed.
 */
// function validateCanonicalInSitemap(pageLinks, canonicalUrl) {
//   if (pageLinks.includes(canonicalUrl)) {
//     return { check: ChecksAndErrors.CANONICAL_URL_IN_SITEMAP.check, success: true };
//   }
//   return {
//     check: ChecksAndErrors.CANONICAL_URL_IN_SITEMAP.check,
//     error: ChecksAndErrors.CANONICAL_URL_IN_SITEMAP.error,
//   };
// }

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
        check: ChecksAndErrors.CANONICAL_URL_200.check,
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
  if (!baseURL.startsWith('https://')) {
    const site = await retrieveSiteBySiteId(dataAccess, input, log);
    if (!site) {
      return notFound('Site not found');
    }
    baseURL = site.getBaseURL();
    log.info(`Retrieved base URL: ${baseURL} for site ID: ${input}`);
  }
  try {
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

    // const aggregatedPageLinks = await getBaseUrlPagesFromSitemaps(
    //   baseURL,
    //   topPages.map((page) => page.url),
    // );
    // eslint-disable-next-line max-len
    // log.info(`Aggregated page links from sitemaps for baseURL ${baseURL}: ${JSON.stringify(aggregatedPageLinks)}`);

    const auditPromises = topPages.map(async (page) => {
      const { url } = page;
      log.info(`Validating canonical tag for URL: ${url}`);
      const checks = [];

      const { canonicalUrl, checks: canonicalTagChecks } = await validateCanonicalTag(url, log);
      checks.push(...canonicalTagChecks);

      if (canonicalUrl) {
        log.info(`Found canonical URL: ${canonicalUrl}`);
        // if (canonicalUrl && !canonicalTagChecks.some((check) => check.error)) {
        // const allPages = [];
        // const setsOfPages = Object.values(aggregatedPageLinks);
        // const setsOfPages = topPages;
        // for (const pages of setsOfPages) {
        //   allPages.push(...pages);
        // }
        // for (const pages of setsOfPages) {
        //   if (Array.isArray(pages)) {
        //     allPages.push(...pages);
        //   } else if (pages && pages.url) {
        //     allPages.push(pages.url);
        //   }
        // }

        // const sitemapCheck = validateCanonicalInSitemap(allPages, canonicalUrl);
        // checks.push(sitemapCheck);

        const urlFormatChecks = validateCanonicalUrlFormat(canonicalUrl, baseURL, log);
        log.info(`validateCanonicalUrlFormat results for ${canonicalUrl}: ${JSON.stringify(urlFormatChecks)}`);
        checks.push(...urlFormatChecks);

        const urlContentCheck = await validateCanonicalUrlContentsRecursive(canonicalUrl, log);
        log.info(`validateCanonicalUrlContentsRecursive result for ${canonicalUrl}: ${JSON.stringify(urlContentCheck)}`);
        checks.push(...urlContentCheck);
      }
      log.info(`Checks for URL ${url}: ${JSON.stringify(checks)}`);
      return { [url]: checks };
    });

    const auditResultsArray = await Promise.all(auditPromises);
    const auditResults = auditResultsArray.reduce((acc, result) => {
      const [url, checks] = Object.entries(result)[0];
      acc[url] = checks;
      return acc;
    }, {});

    log.info(`Successfully completed canonical audit for site: ${baseURL}`);
    log.info(`Audit results: ${JSON.stringify(auditResults)}`);

    return {
      fullAuditRef: baseURL,
      auditResult: auditResults,
    };
  } catch (error) {
    // log.error(`canonical audit for site ${baseURL} failed with error: ${error.message}`, error);
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
