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
import {
  isAuthUrl,
  toggleWWW,
  getBaseUrlPagesFromSitemapContents,
  getSitemapUrlsFromSitemapIndex,
  extractDomainAndProtocol,
  getUrlWithoutPath,
} from '../support/utils.js';

// Performance tuning constants:
// GET timeout for robots.txt and each sitemap.xml file
export const SITEMAP_GET_TIMEOUT_MS = 15000; // 15 seconds
// Batching when fetching sitemap.xml files
export const SITEMAP_XML_BATCH_SIZE = 10; // number to fetch in parallel
export const SITEMAP_XML_BATCH_DELAY_MS = 500; // half of a second delay between batches
// Timeout for HEAD (and GET fallback) when validating page URLs
export const PAGE_URL_TIMEOUT_MS = 10000; // 10 seconds
// Batching when fetching/validating page URLs
export const PAGE_URL_BATCH_SIZE = 750; // must stay under 1000
export const PAGE_URL_BATCH_DELAY_MS = 0; // none

export const ERROR_CODES = Object.freeze({
  INVALID_URL: 'INVALID URL',
  NO_SITEMAP_IN_ROBOTS: 'NO SITEMAP FOUND IN ROBOTS',
  NO_VALID_PATHS_EXTRACTED: 'NO VALID URLs FOUND IN SITEMAP',
  SITEMAP_NOT_FOUND: 'NO SITEMAP FOUND',
  SITEMAP_EMPTY: 'EMPTY SITEMAP',
  SITEMAP_FORMAT: 'INVALID SITEMAP FORMAT',
  FETCH_ERROR: 'ERROR FETCHING DATA',
  MISSING_PRODUCT_URL_TEMPLATE: 'MISSING PRODUCT URL TEMPLATE IN THE SITE CONFIGURATION',
  COLLECTING_PRODUCTS_BACKEND_FAILED: 'COLLECTING PRODUCTS FROM BACKEND FAILED',
  UNSUPPORTED_DELIVERY_TYPE: 'UNSUPPORTED DELIVERY TYPE',
});

const VALID_MIME_TYPES = Object.freeze([
  'application/xml',
  'text/xml',
  'text/html',
  'text/plain',
]);

/**
 * Utility function to add delay between batch processing
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Validates if a suggested URL returns a 200 status code
 * @param {string} url - The URL to validate
 * @param {number} [timeoutMs=PAGE_URL_TIMEOUT_MS] - Timeout in ms for HEAD/GET
 * @returns {Promise<boolean>} - True if URL returns 200, false otherwise
 */
async function isValidSuggestedUrl(url, timeoutMs = PAGE_URL_TIMEOUT_MS) {
  try {
    // eslint-disable-next-line no-use-before-define
    const response = await fetchWithHeadFallback(url, {
      redirect: 'follow',
      timeout: timeoutMs,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Helper function to try HEAD request first, then GET on 404
 * This handles cases where servers return 404 for HEAD but 200 for GET.
 * Uses `options.timeout` for both HEAD and GET fallback (default PAGE_URL_TIMEOUT_MS).
 */
export async function fetchWithHeadFallback(url, options = {}) {
  const timeout = options.timeout ?? PAGE_URL_TIMEOUT_MS;
  const fetchOptions = { ...options, timeout };

  // note: this could throw an exception for network errors
  const headResponse = await fetch(url, {
    ...fetchOptions,
    method: 'HEAD',
  });

  // If HEAD returns 404, try GET as fallback
  if (headResponse.status === 404) {
    try {
      return await fetch(url, {
        ...fetchOptions,
        method: 'GET',
      });
    } catch {
      // If GET also fails, return the original HEAD response (which is a 404)
      return headResponse;
    }
  }

  return headResponse;
}

/**
 * Fetches content with timeout control.
 * Used only for robots.txt and sitemap.xml GET requests (SITEMAP_GET_TIMEOUT_MS).
 */
export async function fetchContent(targetUrl) {
  // note: this could throw an exception for network errors
  const response = await fetch(targetUrl, {
    method: 'GET',
    timeout: SITEMAP_GET_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Fetch error for ${targetUrl} Status: ${response.status}`);
  }

  return {
    payload: await response.text(),
    type: response.headers.get('content-type'),
  };
}

/**
 * Simplified URL validation with better performance and rate limiting.
 * @param {string[]} urls - URLs to validate (page URLs or sitemap URLs)
 * @param {Object} [log] - Logger
 * @param {number} [timeoutMs=PAGE_URL_TIMEOUT_MS] -
 *         Timeout for HEAD/GET (use SITEMAP_GET_TIMEOUT_MS for sitemap URL validation)
 */
export async function filterValidUrls(urls, log, timeoutMs = PAGE_URL_TIMEOUT_MS) {
  if (!urls.length) {
    return {
      ok: [], notOk: [], networkErrors: [], otherStatusCodes: [],
    };
  }

  const results = {
    ok: [], notOk: [], networkErrors: [], otherStatusCodes: [],
  };

  const checkUrl = async (url) => {
    try {
      const response = await fetchWithHeadFallback(url, {
        redirect: 'manual',
        timeout: timeoutMs,
      });

      // Handle successful responses
      if (response.status === 200) {
        log?.debug(`Sitemap: Valid URL found: ${url}`);
        return { type: 'ok', url };
      }

      /* c8 ignore next */
      log?.debug(`Sitemap: URL check for ${url} returned status: ${response.status}`);

      // Handle redirects
      if (response.status === 301 || response.status === 302) {
        const redirectUrl = response.headers.get('location');
        const finalUrl = redirectUrl ? new URL(redirectUrl, url).href : null;

        // Check if redirect leads to login page (treat as valid)
        if (finalUrl && isAuthUrl(finalUrl)) {
          return { type: 'ok', url };
        }

        // Try to check the final destination and validate it properly
        if (finalUrl) {
          let isValidSuggestion = false;
          let is404 = false;

          try {
            const redirectResponse = await fetchWithHeadFallback(finalUrl, {
              redirect: 'follow',
              timeout: timeoutMs,
            });

            // Check if the suggested URL actually returns 200
            isValidSuggestion = redirectResponse.status === 200;
            is404 = redirectResponse.status === 404;
          } catch {
            // the fetch for the redirect URL can fail for various reasons (e.g. network error).
            // intentionally ignore the error and proceed to check for 404 patterns in the URL
            isValidSuggestion = false;
          }

          // Also check for 404 patterns in the URL itself, as a fallback or additional signal
          if (!is404) {
            is404 = finalUrl.includes('/404/')
              || finalUrl.includes('404.html')
              || finalUrl.includes('/errors/404/');
          }

          const originalUrl = new URL(url);
          const homepageUrl = `${originalUrl.protocol}//${originalUrl.hostname}`;

          // Only suggest the redirect URL if it's valid (returns 200), otherwise suggest homepage
          const suggestedUrl = (isValidSuggestion && !is404) ? finalUrl : homepageUrl;

          return {
            type: 'notOk',
            url,
            statusCode: response.status,
            urlsSuggested: suggestedUrl,
          };
        }

        // If no redirect URL, validate homepage before suggesting it
        const originalUrl = new URL(url);
        const homepageUrl = `${originalUrl.protocol}//${originalUrl.hostname}`;

        // Validate the homepage suggestion
        const isHomepageValid = await isValidSuggestedUrl(homepageUrl, timeoutMs);

        return {
          type: 'notOk',
          url,
          statusCode: response.status,
          // Only suggest homepage if it's valid, otherwise provide no suggestion
          ...(isHomepageValid && { urlsSuggested: homepageUrl }),
        };
      }

      // Handle 404s and other status codes
      if (response.status === 404) {
        return { type: 'notOk', url, statusCode: response.status };
      }

      return { type: 'otherStatus', url, statusCode: response.status };
    } catch {
      // exception during the fetch (network error, timeout, etc.) is considered a network error
      return { type: 'networkError', url, error: 'NETWORK_ERROR' };
    }
  };

  // Process URLs in batches with rate limiting (page URL batch size and delay)
  for (let i = 0; i < urls.length; i += PAGE_URL_BATCH_SIZE) {
    const batch = urls.slice(i, i + PAGE_URL_BATCH_SIZE);
    const batchPromises = batch.map(checkUrl);

    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        const {
          type, url, statusCode, urlsSuggested, error,
        } = result.value;

        // eslint-disable-next-line default-case
        switch (type) {
          case 'ok':
            results.ok.push(url);
            break;
          case 'notOk':
            results.notOk.push({ url, statusCode, ...(urlsSuggested && { urlsSuggested }) });
            break;
          case 'networkError':
            results.networkErrors.push({ url, error });
            break;
          case 'otherStatus':
            results.otherStatusCodes.push({ url, statusCode });
            break;
        }
      }
    }

    // Add delay between batches to avoid overwhelming servers
    if (i + PAGE_URL_BATCH_SIZE < urls.length) {
      // eslint-disable-next-line no-await-in-loop
      await delay(PAGE_URL_BATCH_DELAY_MS);
    }
  }

  return results;
}

/**
 * Checks robots.txt for sitemap URLs
 */
export async function checkRobotsForSitemap(protocol, domain) {
  const robotsUrl = `${protocol}://${domain}/robots.txt`;
  const sitemapPaths = [];

  const robotsContent = await fetchContent(robotsUrl);
  const sitemapMatches = robotsContent.payload.matchAll(/Sitemap:\s*(.*)/gi);

  for (const match of sitemapMatches) {
    const answer = match[1].trim();
    if (answer?.length) {
      sitemapPaths.push(answer);
    }
  }

  return {
    paths: sitemapPaths,
    reasons: sitemapPaths.length ? [] : [ERROR_CODES.NO_SITEMAP_IN_ROBOTS],
  };
}

/**
 * Validates sitemap content format
 */
export function isSitemapContentValid(sitemapContent) {
  const validStarts = ['<?xml', '<urlset', '<sitemapindex'];
  return validStarts.some((start) => sitemapContent.payload.trim().startsWith(start))
    || VALID_MIME_TYPES.some((type) => sitemapContent.type.includes(type));
}

/**
 * Checks sitemap validity and existence
 */
export async function checkSitemap(sitemapUrl, log) {
  try {
    log?.debug(`Sitemap: Fetching sitemap URL: ${sitemapUrl}`);
    const sitemapContent = await fetchContent(sitemapUrl);
    log?.info(`Sitemap: Successfully fetched sitemap URL: ${sitemapUrl} with content type: ${sitemapContent.type}`);
    const isValidFormat = isSitemapContentValid(sitemapContent);
    const isSitemapIndex = isValidFormat && sitemapContent.payload.includes('</sitemapindex>');
    const isText = isValidFormat && sitemapContent.type === 'text/plain';

    if (!isValidFormat) {
      return {
        existsAndIsValid: false,
        reasons: [ERROR_CODES.SITEMAP_FORMAT],
      };
    }

    return {
      existsAndIsValid: true,
      reasons: [],
      details: { sitemapContent, isText, isSitemapIndex },
    };
  } catch (error) {
    /* c8 ignore next */
    log?.error(`Sitemap: Error fetching sitemap URL ${sitemapUrl}: ${error.message}`);
    const isNotFound = error.message.includes('404');
    return {
      existsAndIsValid: false,
      reasons: [isNotFound ? ERROR_CODES.SITEMAP_NOT_FOUND : ERROR_CODES.FETCH_ERROR],
    };
  }
}

/**
 * Retrieves base URL pages from sitemaps with improved error handling
 */
export async function getBaseUrlPagesFromSitemaps(inputUrl, initialUrls, log) {
  // Strip subpath to get domain-only URL for sitemap.xml matching
  const baseUrl = getUrlWithoutPath(inputUrl);
  const baseUrlVariant = toggleWWW(baseUrl);
  const pagesBySitemap = {};
  let sitemapsToProcess = [...initialUrls];
  const processedSitemaps = new Set();

  /* c8 ignore next */
  log?.info(`Sitemap: Starting to process ${sitemapsToProcess.length} initial sitemap URLs for ${inputUrl}`);
  while (sitemapsToProcess.length > 0) {
    const sitemapsFromIndexes = [];

    const processOne = async (sitemapUrl) => {
      if (processedSitemaps.has(sitemapUrl)) {
        return;
      }
      processedSitemaps.add(sitemapUrl);
      /* c8 ignore next */
      log?.debug(`Sitemap: Processing sitemap URL: ${sitemapUrl} for ${inputUrl}`);

      const sitemapData = await checkSitemap(sitemapUrl, log);
      /* c8 ignore next */
      log?.debug(`Sitemap: .. Sitemap URL ${sitemapUrl} ... exists and is valid: ${sitemapData.existsAndIsValid} ... with reason ${sitemapData.reasons} for ${inputUrl}`);

      if (sitemapData.existsAndIsValid) {
        if (sitemapData.details?.isSitemapIndex) {
          const extractedSitemaps = getSitemapUrlsFromSitemapIndex(
            sitemapData.details.sitemapContent,
          );
          sitemapsFromIndexes.push(...extractedSitemaps);
        } else if (
          sitemapUrl.startsWith(baseUrl)
          || sitemapUrl.startsWith(baseUrlVariant)
        ) {
          // Process sitemaps under the same domain; page URL filtering uses inputUrl
          const pages = getBaseUrlPagesFromSitemapContents(
            inputUrl,
            sitemapData.details,
          );
          if (pages.length > 0) {
            pagesBySitemap[sitemapUrl] = pages;
          }
        }
      }
    };

    // Process sitemap.xml files in batches with delay between batches
    for (let i = 0; i < sitemapsToProcess.length; i += SITEMAP_XML_BATCH_SIZE) {
      const chunk = sitemapsToProcess.slice(i, i + SITEMAP_XML_BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(chunk.map(processOne));
      if (i + SITEMAP_XML_BATCH_SIZE < sitemapsToProcess.length) {
        // eslint-disable-next-line no-await-in-loop
        await delay(SITEMAP_XML_BATCH_DELAY_MS);
      }
    }

    sitemapsToProcess = sitemapsFromIndexes;
  }

  return pagesBySitemap;
}

export async function getSitemapUrls(inputUrl, log) {
  const parsedUrl = extractDomainAndProtocol(inputUrl);
  if (!parsedUrl) {
    /* c8 ignore next */
    log?.error(`Sitemap: Invalid URL provided: ${inputUrl}`);
    return {
      success: false,
      reasons: [{ value: inputUrl, error: ERROR_CODES.INVALID_URL }],
    };
  }

  const { protocol, domain } = parsedUrl;

  let sitemapUrls = { ok: [], notOk: [] };

  // Try to find sitemaps in robots.txt
  try {
    const robotsResult = await checkRobotsForSitemap(protocol, domain);
    if (robotsResult?.paths?.length) {
      sitemapUrls.ok = robotsResult.paths;
      log?.info(`Sitemap: Found ${robotsResult.paths.length} sitemap URL(s) in robots.txt for ${inputUrl}`);
    }
  } catch (error) {
    /* c8 ignore next */
    log?.error(`Sitemap: Error checking robots.txt for ${inputUrl}: ${error.message}`);
    // If robots.txt fails, return error immediately (to match test expectations)
    return {
      success: false,
      reasons: [{ value: `${error.message}`, error: ERROR_CODES.FETCH_ERROR }],
    };
  }

  // If no sitemaps found in robots.txt, try common locations
  if (!sitemapUrls.ok.length) {
    log?.debug(`Sitemap: No sitemap URLs found in robots.txt for ${inputUrl}, trying common locations.`);
    const commonSitemapUrls = [
      `${protocol}://${domain}/sitemap.xml`,
      `${protocol}://${domain}/sitemap_index.xml`,
    ];
    sitemapUrls = await filterValidUrls(commonSitemapUrls, log, SITEMAP_GET_TIMEOUT_MS);

    if (!sitemapUrls.ok?.length) {
      return {
        success: false,
        reasons: [{
          value: `${protocol}://${domain}/robots.txt`,
          error: ERROR_CODES.NO_SITEMAP_IN_ROBOTS,
        }],
        details: { issues: sitemapUrls.notOk },
      };
    }
  }

  // Extract and validate page URLs from our validated sitemap URLs:
  //   getBaseUrlPagesFromSitemaps filters sitemaps by domain, then filters page URLs by full path
  const extractedPaths = await getBaseUrlPagesFromSitemaps(inputUrl, sitemapUrls.ok, log);
  log?.info(`Sitemap: Extracted ${Object.keys(extractedPaths).length} sitemap URLs for ${inputUrl}`);
  log?.info(`Sitemap: Extracted ${Object.values(extractedPaths).reduce((sum, pages) => sum + pages.length, 0)} page URLs from sitemaps for ${inputUrl}`);

  return {
    success: true,
    reasons: [{ value: 'Urls are extracted from sitemap.' }],
    details: {
      extractedPaths,
      filteredSitemapUrls: sitemapUrls.ok, // Validated sitemap URLs
    },
  };
}
