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
  isLoginPage,
  toggleWWW,
  getBaseUrlPagesFromSitemapContents,
  getSitemapUrlsFromSitemapIndex, extractDomainAndProtocol,
} from '../support/utils.js';

// Performance tuning constants - Optimized for 20K-30K URLs in 15min Lambda
export const BATCH_SIZE = 50; // Aggressive batching for high volume
export const BATCH_DELAY_MS = 50; // Minimal delay to prevent server overload
export const REQUEST_TIMEOUT_MS = 2000; // 2 second timeout for speed

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
 * Fetches content with timeout control
 */
export async function fetchContent(targetUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Fetch error for ${targetUrl} Status: ${response.status}`);
    }

    return {
      payload: await response.text(),
      type: response.headers.get('content-type'),
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Simplified URL validation with better performance and rate limiting
 */
export async function filterValidUrls(urls) {
  if (!urls.length) {
    return {
      ok: [], notOk: [], networkErrors: [], otherStatusCodes: [],
    };
  }

  const controller = new AbortController();
  const results = {
    ok: [], notOk: [], networkErrors: [], otherStatusCodes: [],
  };

  const checkUrl = async (url) => {
    try {
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle successful responses
      if (response.status === 200) {
        return { type: 'ok', url };
      }

      // Handle redirects
      if (response.status === 301 || response.status === 302) {
        const redirectUrl = response.headers.get('location');
        const finalUrl = redirectUrl ? new URL(redirectUrl, url).href : null;

        // Check if redirect leads to login page (treat as valid)
        if (finalUrl && isLoginPage(finalUrl)) {
          return { type: 'ok', url };
        }

        // Try to check the final destination
        if (finalUrl) {
          let is404 = false;
          try {
            const redirectTimeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            const redirectResponse = await fetch(finalUrl, {
              method: 'HEAD',
              redirect: 'follow',
              signal: controller.signal,
            });
            clearTimeout(redirectTimeoutId);
            is404 = redirectResponse.status === 404;
          } catch {
            // the fetch for the redirect URL can fail for various reasons (e.g. network error).
            // intentionally ignore the error and proceed to check for 404 patterns in the URL
          }

          // Also check for 404 patterns in the URL itself, as a fallback or additional signal
          if (!is404) {
            is404 = finalUrl.includes('/404/')
              || finalUrl.includes('404.html')
              || finalUrl.includes('/errors/404/');
          }

          const originalUrl = new URL(url);
          const homepageUrl = `${originalUrl.protocol}//${originalUrl.hostname}`;

          return {
            type: 'notOk',
            url,
            statusCode: response.status,
            urlsSuggested: is404 ? homepageUrl : finalUrl,
          };
        }

        // If no redirect URL, suggest homepage
        const originalUrl = new URL(url);
        const homepageUrl = `${originalUrl.protocol}//${originalUrl.hostname}`;

        return {
          type: 'notOk',
          url,
          statusCode: response.status,
          urlsSuggested: homepageUrl,
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

  // Process URLs in batches with rate limiting
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
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
    if (i + BATCH_SIZE < urls.length) {
      // eslint-disable-next-line no-await-in-loop
      await delay(BATCH_DELAY_MS);
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
export async function checkSitemap(sitemapUrl) {
  try {
    const sitemapContent = await fetchContent(sitemapUrl);
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
export async function getBaseUrlPagesFromSitemaps(baseUrl, initialUrls) {
  const baseUrlVariant = toggleWWW(baseUrl);
  const pagesBySitemap = {};
  let sitemapsToProcess = [...initialUrls];
  const processedSitemaps = new Set();

  while (sitemapsToProcess.length > 0) {
    const sitemapsFromIndexes = [];

    const processingPromises = sitemapsToProcess.map(async (sitemapUrl) => {
      if (processedSitemaps.has(sitemapUrl)) {
        return;
      }
      processedSitemaps.add(sitemapUrl);

      const sitemapData = await checkSitemap(sitemapUrl);

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
          const pages = getBaseUrlPagesFromSitemapContents(
            baseUrl,
            sitemapData.details,
          );
          if (pages.length > 0) {
            pagesBySitemap[sitemapUrl] = pages;
          }
        }
      }
    });

    // eslint-disable-next-line no-await-in-loop
    await Promise.all(processingPromises);

    sitemapsToProcess = sitemapsFromIndexes;
  }

  return pagesBySitemap;
}

export async function getSitemapUrls(inputUrl) {
  const parsedUrl = extractDomainAndProtocol(inputUrl);
  if (!parsedUrl) {
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
    }
  } catch (error) {
    // If robots.txt fails, return error immediately (to match test expectations)
    return {
      success: false,
      reasons: [{ value: `${error.message}`, error: ERROR_CODES.FETCH_ERROR }],
    };
  }

  // If no sitemaps found in robots.txt, try common locations
  if (!sitemapUrls.ok.length) {
    const commonSitemapUrls = [
      `${protocol}://${domain}/sitemap.xml`,
      `${protocol}://${domain}/sitemap_index.xml`,
    ];
    sitemapUrls = await filterValidUrls(commonSitemapUrls);

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

  // Filter sitemaps that match the input URL domain
  const inputUrlToggledWww = toggleWWW(inputUrl);
  const filteredSitemapUrls = sitemapUrls.ok.filter(
    (path) => path.startsWith(inputUrl) || path.startsWith(inputUrlToggledWww),
  );

  // Extract and validate pages from sitemaps
  const extractedPaths = await getBaseUrlPagesFromSitemaps(inputUrl, filteredSitemapUrls);

  return {
    success: true,
    reasons: [{ value: 'Urls are extracted from sitemap.' }],
    details: {
      extractedPaths,
      filteredSitemapUrls,
    },
  };
}
