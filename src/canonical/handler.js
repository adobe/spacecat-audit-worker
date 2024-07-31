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
import { getBaseUrlPagesFromSitemaps } from '../sitemap/handler.js';
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
  CANONICAL_URL_4XX: {
    check: 'canonical-url-4xx',
    error: 'canonical-url-4xx-error',
    explanation: 'The canonical URL returns a 4xx error, indicating it is inaccessible, which can harm SEO visibility.',
  },
  CANONICAL_URL_3XX: {
    check: 'canonical-url-3xx',
    error: 'canonical-url-3xx-redirect',
    explanation: 'The canonical URL returns a 3xx redirect, which may lead to confusion for search engines and dilute page authority.',
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
  TOPPAGES: {
    check: 'top-pages',
    error: 'no-top-pages-found',
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
async function getTop200Pages(url, context, log) {
  try {
    const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);

    const { result } = await ahrefsAPIClient.getTopPages(url, 200);

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
  if (!url) {
    log.error('URL is undefined or null');
    return {
      canonicalUrl: null,
      checks: [{
        check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
        error: 'URL is undefined or null',
      }],
    };
  }
  try {
    log.info(`Fetching URL: ${url}`);
    const response = await fetch(url);
    const html = await response.text();
    log.info(`Fetched HTML content for URL: ${url}`);
    log.debug(`HTML content: ${html}`); // Log the HTML content
    const dom = new JSDOM(html);
    log.info(`Parsed DOM for URL: ${url}`);
    const { head } = dom.window.document;
    const canonicalLinks = head.querySelectorAll('link[rel="canonical"]');
    log.info(`Found canonical links: ${JSON.stringify(canonicalLinks)}`);
    const checks = [];
    let canonicalUrl = null;

    if (canonicalLinks.length === 0) {
      checks.push({
        check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
        error: ChecksAndErrors.CANONICAL_TAG_EXISTS.error,
      });
      log.info(`No canonical tag found for URL: ${url}`);
    } else if (canonicalLinks.length > 1) {
      checks.push({
        check: ChecksAndErrors.CANONICAL_TAG_ONCE.check,
        error: ChecksAndErrors.CANONICAL_TAG_ONCE.error,
      });
      log.info(`Multiple canonical tags found for URL: ${url}`);
    } else {
      const canonicalLink = canonicalLinks[0];
      log.info(`Canonical link element: ${JSON.stringify(canonicalLink.outerHTML)}`);
      const href = canonicalLink.getAttribute('href');
      if (!href) {
        checks.push({
          check: ChecksAndErrors.CANONICAL_TAG_NONEMPTY.check,
          error: ChecksAndErrors.CANONICAL_TAG_NONEMPTY.error,
        });
        log.info(`Empty canonical tag found for URL: ${url}`);
      } else {
        try {
          canonicalUrl = new URL(href, url).toString();
          log.info(`Valid canonical URL resolved: ${canonicalUrl}`);
        } catch (error) {
          log.error(`Invalid canonical URL found: ${href} on page ${url}`);
          checks.push({
            check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
            error: 'invalid-canonical-url',
            explanation: `The canonical URL ${href} is invalid.`,
          });
        }
      }

      if (!canonicalLink.closest('head')) {
        checks.push({
          check: ChecksAndErrors.CANONICAL_TAG_IN_HEAD.check,
          error: ChecksAndErrors.CANONICAL_TAG_IN_HEAD.error,
        });
        log.info(`Canonical tag is not in the head section for URL: ${url}`);
      }
    }

    log.info(`Validation checks for URL: ${url}, Checks: ${JSON.stringify(checks)}`);
    return { canonicalUrl, checks };
  } catch (error) {
    log.error(`Error validating canonical tag for ${url}: ${error.message}`);
    return {
      canonicalUrl: null,
      checks: [{
        check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
        error: 'Error fetching or parsing HTML document',
        explanation: error.message,
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
 * Recursively validates the contents of a canonical URL.
 *
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @param {Object} log - The logging object to log information.
 * @param {Set<string>} [visitedUrls=new Set()] - A set of visited URLs to detect redirect loops.
 * @returns {Promise<Object>} An object with the check result and any error if the check failed.
 */
async function validateCanonicalUrlContentsRecursive(canonicalUrl, log, visitedUrls = new Set()) {
  if (visitedUrls.has(canonicalUrl)) {
    log.error(`Detected a redirect loop for canonical URL ${canonicalUrl}`);
    return {
      check: ChecksAndErrors.CANONICAL_URL_NO_REDIRECT.check,
      error: ChecksAndErrors.CANONICAL_URL_NO_REDIRECT.error,
    };
  }

  visitedUrls.add(canonicalUrl);

  try {
    const response = await fetch(canonicalUrl);
    const finalUrl = response.url;

    if (response.status === 200) {
      if (canonicalUrl !== finalUrl) {
        return await validateCanonicalUrlContentsRecursive(finalUrl, log, visitedUrls);
      }
      return { check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check, success: true };
    } else if (response.status >= 400 && response.status < 500) {
      return {
        check: ChecksAndErrors.CANONICAL_URL_4XX.check,
        error: ChecksAndErrors.CANONICAL_URL_4XX.error,
      };
    } else if (response.status >= 500) {
      return {
        check: ChecksAndErrors.CANONICAL_URL_5XX.check,
        error: ChecksAndErrors.CANONICAL_URL_5XX.error,
      };
    } else if (response.status >= 300 && response.status < 400) {
      return {
        check: ChecksAndErrors.CANONICAL_URL_3XX.check,
        error: ChecksAndErrors.CANONICAL_URL_3XX.error,
      };
    }
    return {
      check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
      error: ChecksAndErrors.CANONICAL_TAG_EXISTS.error,
    };
  } catch (error) {
    log.error(`Error fetching canonical URL ${canonicalUrl}: ${error.message}`);
    return {
      check: ChecksAndErrors.CANONICAL_TAG_EXISTS.check,
      error: ChecksAndErrors.CANONICAL_TAG_EXISTS.error,
    };
  }
}

/**
 * Validates the format of a canonical URL against a base URL.
 *
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @param {string} baseUrl - The base URL to compare against.
 * @returns {Array<Object>} Array of check results, each with a check and error if the check failed.
 */

function validateCanonicalUrlFormat(canonicalUrl, baseUrl) {
  const url = new URL(canonicalUrl);
  const base = new URL(baseUrl);
  const checks = [];

  // Check if the canonical URL is absolute
  if (!url.href.startsWith('http://') && !url.href.startsWith('https://')) {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_ABSOLUTE.check,
      error: ChecksAndErrors.CANONICAL_URL_ABSOLUTE.error,
    });
  }

  // Check if the canonical URL has the same protocol as the base URL
  if (!url.href.startsWith(base.protocol)) {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_SAME_PROTOCOL.check,
      error: ChecksAndErrors.CANONICAL_URL_SAME_PROTOCOL.error,
    });
  }

  // Check if the canonical URL has the same domain as the base URL
  if (url.hostname !== base.hostname) {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_SAME_DOMAIN.check,
      error: ChecksAndErrors.CANONICAL_URL_SAME_DOMAIN.error,
    });
  }

  // Check if the canonical URL is in lowercase
  if (url.href !== url.href.toLowerCase()) {
    checks.push({
      check: ChecksAndErrors.CANONICAL_URL_LOWERCASED.check,
      error: ChecksAndErrors.CANONICAL_URL_LOWERCASED.error,
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
    const topPages = await getTop200Pages(baseURL, context, log);
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

    const aggregatedPageLinks = await getBaseUrlPagesFromSitemaps(
      baseURL,
      topPages.map((page) => page.url),
    );
    log.info(`Aggregated page links from sitemaps for baseURL ${baseURL}: ${JSON.stringify(aggregatedPageLinks)}`);

    const auditPromises = topPages.map(async (page) => {
      const { url } = page;
      log.info(`Validating canonical tag for URL: ${url}`);
      const checks = [];

      const { canonicalUrl, checks: canonicalTagChecks } = await validateCanonicalTag(url, log);
      checks.push(...canonicalTagChecks);

      if (canonicalUrl && !canonicalTagChecks.some((check) => check.error)) {
        const allPages = [];
        const setsOfPages = Object.values(aggregatedPageLinks);
        for (const pages of setsOfPages) {
          allPages.push(...pages);
        }

        const sitemapCheck = validateCanonicalInSitemap(allPages, canonicalUrl);
        checks.push(sitemapCheck);

        const urlContentCheck = await validateCanonicalUrlContentsRecursive(canonicalUrl, log);
        checks.push(urlContentCheck);

        const urlFormatChecks = validateCanonicalUrlFormat(canonicalUrl, baseURL);
        checks.push(...urlFormatChecks);
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
