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

import axios from 'axios';
import * as cheerio from 'cheerio';
import http from 'http';
import https from 'https';

// Create custom HTTP agents with better settings for handling many concurrent requests
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10, // Limit concurrent connections to same host
  maxFreeSockets: 5,
  timeout: 30000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10, // Limit concurrent connections to same host
  maxFreeSockets: 5,
  timeout: 30000,
});

/**
 * Status codes tracked by the sitemap audit
 */
const TRACKED_STATUS_CODES = [301, 302, 404];

/**
 * Request timeout for checking individual URLs (matching src/sitemap/common.js)
 */
const REQUEST_TIMEOUT_MS = 50000;

/**
 * Longer timeout for fetching large sitemaps (100 seconds)
 * The main audit uses shorter timeouts because it processes URLs in batches,
 * but for checking we need to fetch the entire sitemap at once
 */
const SITEMAP_FETCH_TIMEOUT_MS = 100000;

/**
 * Maximum number of retry attempts for failed sitemap fetches
 */
const MAX_RETRIES = 2;

/**
 * Delay between retries (exponential backoff)
 */
const RETRY_DELAY_MS = 1000;

/**
 * In-memory cache for sitemap content to avoid duplicate fetches
 * Key: sitemap URL, Value: { urls: Array<string>, timestamp: number }
 */
const sitemapCache = new Map();

/**
 * Cache TTL - 5 minutes (in milliseconds)
 * Sitemaps are relatively stable, so we can cache them for a reasonable time
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Pending sitemap fetches to prevent duplicate concurrent requests
 * Key: sitemap URL, Value: Promise
 */
const pendingFetches = new Map();

/**
 * Helper function to try HEAD request first, then GET on 404
 * Based on fetchWithHeadFallback from src/sitemap/common.js
 */
async function fetchWithHeadFallback(url, options = {}) {
  // Try HEAD request first
  const headResponse = await axios.head(url, {
    ...options,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true, // Accept any status code
  });

  // If HEAD returns 404, try GET as fallback
  if (headResponse.status === 404) {
    try {
      const getResponse = await axios.get(url, {
        ...options,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      });
      return getResponse;
    } catch {
      // If GET also fails, return the original HEAD response
      return headResponse;
    }
  }

  return headResponse;
}

/**
 * Fetches URL with HEAD request and checks status code
 * Based on filterValidUrls logic from src/sitemap/common.js
 */
async function checkUrlStatus(url) {
  try {
    const response = await fetchWithHeadFallback(url, {
      maxRedirects: 0, // Don't follow redirects
    });

    const finalUrl = response.headers.location || null;
    return { statusCode: response.status, finalUrl: finalUrl ? new URL(finalUrl, url).href : null };
  } catch (error) {
    // Network error or timeout - treat as unreachable
    /* eslint-disable-next-line no-console */
    console.error(`Error checking URL status for ${url}:`, error.message);
    return { statusCode: 0, finalUrl: null };
  }
}

/**
 * Helper function for delays
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetches sitemap content with retry logic
 * Based on fetchContent from src/sitemap/common.js
 * Note: Uses longer timeout than main audit since we fetch entire sitemap at once
 * @param {string} sitemapUrl - Sitemap URL to fetch
 * @param {number} retryCount - Current retry attempt (internal use)
 * @returns {Promise<string|null>} Sitemap content or null if error
 */
async function fetchSitemapContent(sitemapUrl, retryCount = 0) {
  try {
    const response = await axios.get(sitemapUrl, {
      timeout: SITEMAP_FETCH_TIMEOUT_MS,
      validateStatus: (status) => status === 200,
      maxContentLength: 50 * 1024 * 1024, // 50MB max for response
      maxBodyLength: 50 * 1024 * 1024, // 50MB max (though not used for GET)
      // Use custom agents to handle connection pooling
      httpAgent,
      httpsAgent,
      // Decompress response automatically
      decompress: true,
      // Add response type to handle large responses better
      responseType: 'text',
    });

    if (response.status !== 200) {
      /* eslint-disable-next-line no-console */
      console.error(`Fetch error for ${sitemapUrl} Status: ${response.status}`);
      return null;
    }

    return response.data;
  } catch (error) {
    const isAborted = error.code === 'ECONNABORTED'
      || error.message?.includes('aborted')
      || error.message?.includes('stream has been aborted');
    const isTimeout = error.code === 'ETIMEDOUT' || error.message?.includes('timeout');

    // Retry on aborted or timeout errors
    if ((isAborted || isTimeout) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_MS * (2 ** retryCount); // Exponential backoff
      /* eslint-disable-next-line no-console */
      console.warn(
        `Retrying sitemap fetch for ${sitemapUrl} (attempt ${retryCount + 1}/${MAX_RETRIES}) after ${delayMs}ms...`,
      );
      await delay(delayMs);
      return fetchSitemapContent(sitemapUrl, retryCount + 1);
    }

    // Provide more detailed error information
    if (isAborted) {
      /* eslint-disable-next-line no-console */
      console.error(`Error fetching sitemap ${sitemapUrl}: Connection aborted after ${retryCount + 1} attempts`);
    } else if (isTimeout) {
      /* eslint-disable-next-line no-console */
      console.error(`Error fetching sitemap ${sitemapUrl}: Request timeout after ${retryCount + 1} attempts`);
    } else if (error.code === 'ERR_BAD_RESPONSE') {
      /* eslint-disable-next-line no-console */
      console.error(`Error fetching sitemap ${sitemapUrl}: Bad response from server`);
    } else {
      /* eslint-disable-next-line no-console */
      console.error(`Error fetching sitemap ${sitemapUrl}:`, error.message);
    }
    return null;
  }
}

/**
 * Extracts URLs from sitemap XML
 * @param {string} xmlContent - XML content of sitemap
 * @returns {Array<string>} Array of URLs
 */
function extractUrlsFromSitemap(xmlContent) {
  try {
    if (!xmlContent || xmlContent.length === 0) {
      /* eslint-disable-next-line no-console */
      console.error('Sitemap content is empty');
      return [];
    }

    const $ = cheerio.load(xmlContent, { xmlMode: true });
    const urls = [];

    $('url > loc').each((i, elem) => {
      const url = $(elem).text().trim();
      if (url) {
        urls.push(url);
      }
    });

    /* eslint-disable-next-line no-console */
    console.log(`Extracted ${urls.length} URLs from sitemap`);
    return urls;
  } catch (error) {
    /* eslint-disable-next-line no-console */
    console.error('Error extracting URLs from sitemap:', error.message);
    return [];
  }
}

/**
 * Fetches and caches sitemap URLs with deduplication
 * Prevents multiple concurrent fetches of the same sitemap
 * @param {string} sitemapUrl - Sitemap URL to fetch
 * @returns {Promise<Array<string>>} Array of URLs from sitemap
 */
async function getSitemapUrls(sitemapUrl) {
  // Check cache first
  const cached = sitemapCache.get(sitemapUrl);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      const ageInSeconds = Math.round(age / 1000);
      /* eslint-disable-next-line no-console */
      console.log(
        `Using cached sitemap for ${sitemapUrl} (${cached.urls.length} URLs, age: ${ageInSeconds}s)`,
      );
      return cached.urls;
    }
    // Cache expired, remove it
    sitemapCache.delete(sitemapUrl);
  }

  // Check if there's already a pending fetch for this sitemap
  const pending = pendingFetches.get(sitemapUrl);
  if (pending) {
    /* eslint-disable-next-line no-console */
    console.log(`Waiting for in-flight request for ${sitemapUrl}...`);
    return pending;
  }

  // Create a new fetch promise
  const fetchPromise = (async () => {
    try {
      const content = await fetchSitemapContent(sitemapUrl);
      if (!content) {
        return [];
      }

      const urls = extractUrlsFromSitemap(content);

      // Cache the results
      sitemapCache.set(sitemapUrl, {
        urls,
        timestamp: Date.now(),
      });

      return urls;
    } finally {
      // Remove from pending fetches when done
      pendingFetches.delete(sitemapUrl);
    }
  })();

  // Store the promise to prevent duplicate fetches
  pendingFetches.set(sitemapUrl, fetchPromise);

  return fetchPromise;
}

/**
 * Checks if a URL is present in the sitemap (with caching)
 * @param {string} sitemapUrl - Sitemap URL
 * @param {string} pageUrl - Page URL to check
 * @returns {Promise<{inSitemap: boolean, allUrls: Array<string>}>}
 */
async function isUrlInSitemap(sitemapUrl, pageUrl) {
  const urls = await getSitemapUrls(sitemapUrl);

  if (!urls || urls.length === 0) {
    return { inSitemap: false, allUrls: [] };
  }

  // Normalize URLs for comparison (remove trailing slashes)
  const normalizeForComparison = (url) => url.replace(/\/$/, '').toLowerCase();
  const normalizedPageUrl = normalizeForComparison(pageUrl);

  const inSitemap = urls.some((url) => normalizeForComparison(url) === normalizedPageUrl);

  return { inSitemap, allUrls: urls };
}

/**
 * Check if a sitemap suggestion has been fixed
 * Based on src/sitemap/handler.js
 *
 * The sitemap audit detects:
 * - URLs returning 301 (permanent redirect)
 * - URLs returning 302 (temporary redirect)
 * - URLs returning 404 (not found)
 *
 * Only 3 cases are considered FIXED:
 * 1. URL_FIXED - The broken URL now returns 200 (OK) directly (no redirect)
 * 2. REMOVED_FROM_SITEMAP - URL was removed from the sitemap XML
 * 3. REPLACED_IN_SITEMAP - The broken URL was removed AND the AI-suggested URL
 *    now appears in sitemap
 *
 * All other cases are NOT considered fixed:
 * - NOT_FIXED - Issue persists (still returns tracked status codes and
 *   still in sitemap)
 * - UNABLE_TO_VERIFY - Cannot check (network error/timeout)
 * - OTHER_STATUS - Returns a different status code
 *
 * @param {object} suggestion - Suggestion object from data access
 * @returns {Promise<object>} Check result
 */
export async function checkSitemapFixed(suggestion) {
  const data = suggestion.getData();
  const pageUrl = data?.pageUrl || data?.url || '';
  const sitemapUrl = data?.sitemapUrl || '';
  const statusCode = data?.statusCode || 0;
  const urlsSuggested = data?.urlsSuggested;

  let issueType;
  if (statusCode === 404) {
    issueType = '404 Not Found';
  } else if (statusCode === 301) {
    issueType = '301 Permanent Redirect';
  } else if (statusCode === 302) {
    issueType = '302 Temporary Redirect';
  } else {
    issueType = `Status ${statusCode}`;
  }

  // Check 1: Is the URL still in the sitemap?
  const sitemapCheck = sitemapUrl
    ? await isUrlInSitemap(sitemapUrl, pageUrl)
    : { inSitemap: true, allUrls: [] };
  const stillInSitemap = sitemapCheck.inSitemap;

  if (!stillInSitemap) {
    // Check if the suggested URL is now in the sitemap instead (REPLACED)
    if (urlsSuggested) {
      const normalizeForCheck = (url) => url.replace(/\/$/, '').toLowerCase();
      const normalizedSuggested = normalizeForCheck(urlsSuggested);
      const suggestedInSitemap = sitemapCheck.allUrls.some(
        (url) => normalizeForCheck(url) === normalizedSuggested,
      );

      if (suggestedInSitemap) {
        return {
          suggestionId: suggestion.getId(),
          opportunityId: suggestion.getOpportunityId(),
          pageUrl,
          sitemapUrl,
          originalStatusCode: statusCode,
          currentStatusCode: null,
          suggestedUrl: urlsSuggested,
          status: suggestion.getStatus(),
          isFixedViaAI: true,
          fixMethod: 'REPLACED_IN_SITEMAP',
          reason: `URL removed from sitemap and replaced with suggested URL: ${urlsSuggested}`,
          issueType,
          stillInSitemap: false,
        };
      }
    }

    // URL was just removed from sitemap (not replaced)
    return {
      suggestionId: suggestion.getId(),
      opportunityId: suggestion.getOpportunityId(),
      pageUrl,
      sitemapUrl,
      originalStatusCode: statusCode,
      currentStatusCode: null,
      suggestedUrl: urlsSuggested || null,
      status: suggestion.getStatus(),
      isFixedViaAI: true,
      fixMethod: 'REMOVED_FROM_SITEMAP',
      reason: 'URL was removed from sitemap',
      issueType,
      stillInSitemap: false,
    };
  }

  // Check 2: Check if the original page URL is now working (returns 200, no redirect)
  const currentStatus = await checkUrlStatus(pageUrl);
  const originalUrlFixed = currentStatus.statusCode === 200;

  // Determine fix status
  let isFixedViaAI = false;
  let reason = '';
  let fixMethod = '';

  if (originalUrlFixed) {
    // FIXED: Original URL now returns 200 OK directly
    isFixedViaAI = true;
    reason = `Original URL now returns 200 OK directly (was ${issueType})`;
    fixMethod = 'URL_FIXED';
  } else if (currentStatus.statusCode === 0) {
    // NOT FIXED: Unable to verify
    isFixedViaAI = false;
    reason = 'Unable to check URL (network error or timeout)';
    fixMethod = 'UNABLE_TO_VERIFY';
  } else if (TRACKED_STATUS_CODES.includes(currentStatus.statusCode)) {
    // NOT FIXED: Issue persists - URL still returns tracked status codes (301/302/404)
    isFixedViaAI = false;
    reason = `Issue persists - URL still returns ${currentStatus.statusCode}. Should be removed from sitemap or fixed to return 200.`;
    fixMethod = 'NOT_FIXED';
  } else {
    // NOT FIXED: Returns a different status code
    isFixedViaAI = false;
    reason = `URL now returns ${currentStatus.statusCode} (not a tracked status)`;
    fixMethod = 'OTHER_STATUS';
  }

  return {
    suggestionId: suggestion.getId(),
    opportunityId: suggestion.getOpportunityId(),
    pageUrl,
    sitemapUrl,
    originalStatusCode: statusCode,
    currentStatusCode: currentStatus.statusCode,
    suggestedUrl: urlsSuggested || null,
    status: suggestion.getStatus(),
    isFixedViaAI,
    fixMethod,
    reason,
    issueType,
    stillInSitemap,
  };
}

/**
 * Clears the sitemap cache
 * Useful for testing or when you want to force fresh fetches
 */
export function clearSitemapCache() {
  const { size } = sitemapCache;
  sitemapCache.clear();
  pendingFetches.clear();
  /* eslint-disable-next-line no-console */
  console.log(`Cleared sitemap cache (${size} entries removed)`);
}

/**
 * Gets cache statistics for monitoring
 * @returns {object} Cache stats
 */
export function getSitemapCacheStats() {
  const entries = Array.from(sitemapCache.entries()).map(([url, data]) => ({
    url,
    urlCount: data.urls.length,
    age: Math.round((Date.now() - data.timestamp) / 1000),
  }));

  return {
    cacheSize: sitemapCache.size,
    pendingFetches: pendingFetches.size,
    entries,
  };
}

export default checkSitemapFixed;
