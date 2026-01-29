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

import {
  getFinalUrl, getFinalUrlBatch, closeSharedBrowser, BATCH_SIZE,
} from '../../common/browser-manager.js';

// Retry configuration for 403 responses
const MAX_403_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds between retries

/**
 * Delay execution for specified milliseconds
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
async function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Get final URL with retry logic for 403 responses
 * @param {string} url - URL to check
 * @param {object} log - Logger instance
 * @param {number} maxRetries - Maximum number of retries for 403
 * @returns {Promise<object>} Result with finalUrl, statusCode, and error if any
 */
async function getFinalUrlWithRetry(url, log, maxRetries = MAX_403_RETRIES) {
  let attempt = 0;
  let result;

  while (attempt <= maxRetries) {
    if (attempt > 0) {
      log.debug(`[Internal Links] Retry attempt ${attempt}/${maxRetries} for ${url} after 403 response`);
      // eslint-disable-next-line no-await-in-loop
      await delay(RETRY_DELAY_MS);
    }

    // eslint-disable-next-line no-await-in-loop
    result = await getFinalUrl(url, log);

    // If status is not 403, return the result (success or other error)
    if (result.statusCode !== 403) {
      if (attempt > 0) {
        log.info(`[Internal Links] Retry successful for ${url} - got status ${result.statusCode} after ${attempt} retries`);
      }
      return result;
    }

    // If we got 403, try again (unless we've exhausted retries)
    if (attempt < maxRetries) {
      log.debug(`[Internal Links] Got 403 for ${url}, will retry...`);
    }

    attempt += 1;
  }

  // All retries exhausted, still got 403
  log.info(`[Internal Links] Still got 403 for ${url} after ${maxRetries} retries`);
  return result;
}

/**
 * Normalize URL for comparison (remove trailing slashes, lowercase, remove protocol)
 * @param {string} url - URL to normalize
 * @returns {object} Normalized URL parts (domain, path)
 */
function normalizeUrl(url) {
  if (!url) return { domain: '', path: '', full: '' };

  let normalized = url.trim().toLowerCase();

  // Remove protocol
  normalized = normalized.replace(/^https?:\/\//, '');

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Split into domain and path
  const firstSlashIndex = normalized.indexOf('/');
  if (firstSlashIndex === -1) {
    // No path, just domain
    return {
      domain: normalized,
      path: '',
      full: normalized,
    };
  }

  const domain = normalized.substring(0, firstSlashIndex);
  const path = normalized.substring(firstSlashIndex);

  return {
    domain,
    path,
    full: normalized,
  };
}

/**
 * Resolve a relative URL to an absolute URL based on the base URL
 * @param {string} url - URL to resolve (can be relative or absolute)
 * @param {string} baseUrl - Base URL to resolve relative URLs against
 * @returns {string} Absolute URL
 */
function resolveUrl(url, baseUrl) {
  if (!url) return null;

  // If URL already has protocol, return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  try {
    // If URL starts with /, it's an absolute path
    if (url.startsWith('/')) {
      const baseUrlObj = new URL(baseUrl);
      return `${baseUrlObj.protocol}//${baseUrlObj.host}${url}`;
    }

    // Otherwise, resolve relative to base URL
    return new URL(url, baseUrl).href;
  } catch (error) {
    // If URL parsing fails, return null
    return null;
  }
}

/**
 * Check if urlTo redirects to any of the suggested URLs
 * @param {string} urlTo - The broken URL that might redirect
 * @param {string} urlFrom - The source page URL (for resolving relative URLs)
 * @param {Array<string>} urlsSuggested - Array of suggested URLs
 * @param {object} log - Logger instance
 * @param {object} redirectResults - Optional pre-fetched redirect results
 *  (for batch processing)
 * @returns {Promise<object>} Result with redirectsToSuggested flag,
 *  matchedUrl and statusCode
 */
async function checkRedirectsToSuggested(
  urlTo,
  urlFrom,
  urlsSuggested,
  log,
  redirectResults = null,
) {
  if (!urlTo || !urlsSuggested || urlsSuggested.length === 0) {
    return { redirectsToSuggested: false, matchedUrl: null, statusCode: null };
  }

  // Resolve urlTo to absolute URL if needed
  const absoluteUrlTo = resolveUrl(urlTo, urlFrom);
  if (!absoluteUrlTo) {
    log.debug(`[Internal Links] Could not resolve urlTo to absolute URL: ${urlTo}`);
    return { redirectsToSuggested: false, matchedUrl: null, statusCode: null };
  }

  // Get redirect result - either from pre-fetched batch or fetch individually
  let redirectResult;
  if (redirectResults && redirectResults[absoluteUrlTo]) {
    log.debug(`[Internal Links] Using cached redirect result for ${absoluteUrlTo}`);
    redirectResult = redirectResults[absoluteUrlTo];
  } else {
    log.debug(`[Internal Links] Following redirects for ${absoluteUrlTo}...`);
    redirectResult = await getFinalUrlWithRetry(absoluteUrlTo, log);
  }

  // Capture status code regardless of success
  const { statusCode } = redirectResult;

  if (!redirectResult.finalUrl) {
    const errorMsg = redirectResult.error || 'Unknown error';
    log.debug(
      `[Internal Links] Failed to follow redirects for ${absoluteUrlTo}: ${errorMsg} (Status: ${statusCode})`,
    );
    return {
      redirectsToSuggested: false, matchedUrl: null, statusCode, finalUrl: redirectResult.finalUrl,
    };
  }

  // Note: We don't check the status code here because redirects (301/302) are
  // valid ways to fix broken links. As long as we successfully got a final URL
  // (even via redirect), we check if it matches a suggestion.

  // Normalize URLs for comparison
  const normalizedFinalUrl = normalizeUrl(redirectResult.finalUrl);

  // Check if final URL matches any suggested URL (exact match only)
  for (const suggestedUrl of urlsSuggested) {
    const normalizedSuggested = normalizeUrl(suggestedUrl);

    // Check for exact match only
    if (normalizedFinalUrl.full === normalizedSuggested.full) {
      log.debug(
        `[Internal Links] urlTo redirects to suggested URL: ${suggestedUrl} -> ${redirectResult.finalUrl}`,
      );
      return {
        redirectsToSuggested: true,
        matchedUrl: suggestedUrl,
        finalUrl: redirectResult.finalUrl,
        statusCode: redirectResult.statusCode,
      };
    }
  }

  return {
    redirectsToSuggested: false, matchedUrl: null, statusCode, finalUrl: redirectResult.finalUrl,
  };
}

/**
 * Check if an internal links suggestion has been fixed
 * Based on src/internal-links/handler.js
 *
 * A suggestion is fixed ONLY in these cases:
 * 1. AI Suggestion Implemented via Redirect: The broken internal link (urlTo)
 *    redirects to one of the AI-suggested URLs (urlsSuggested). The script follows
 *    redirects (up to 5 hops) to verify.
 * 2. Edited URL Implemented via Redirect: If the suggestion was edited by the user
 *    (isEdited: true), checks if urlTo redirects to the user's edited URL
 *    (stored in data.urlEdited)
 *
 * @param {object} suggestion - Suggestion object from data access
 * @param {string} siteId - Site UUID
 * @param {object} log - Logger instance
 * @param {object} redirectResults - Optional pre-fetched redirect results
 *  (for batch processing)
 * @returns {Promise<object>} Check result
 */
export async function checkInternalLinksFixed(suggestion, siteId, log, redirectResults = null) {
  const data = suggestion.getData();
  const urlFrom = data?.urlFrom;
  const urlTo = data?.urlTo;
  const originalUrlsSuggested = data?.urlsSuggested || [];

  // Check if suggestion has been edited by user
  const isEdited = Boolean(data?.isEdited);
  const urlEdited = data?.urlEdited; // User's edited URL

  // If edited, use urlEdited (single URL), otherwise use original urlsSuggested (array)
  // This allows checking redirects to edited URL (case 2) or AI-suggested URLs (case 1)
  const urlsSuggested = isEdited && urlEdited ? [urlEdited] : originalUrlsSuggested;

  const suggestionId = suggestion.getId();

  log.info(`[Internal Links] Checking suggestion ${suggestionId}`);
  log.info(`[Internal Links]   urlFrom: ${urlFrom}`);
  log.info(`[Internal Links]   urlTo: ${urlTo}`);
  log.info(`[Internal Links]   isEdited: ${isEdited}`);
  if (isEdited && urlEdited) {
    log.info(`[Internal Links]   urlEdited: ${urlEdited}`);
  }
  const urlsLabel = isEdited ? 'edited' : 'original';
  const urlsList = urlsSuggested.length > 0 ? urlsSuggested.join(', ') : 'none';
  log.info(`[Internal Links]   ${urlsLabel} urlsSuggested: ${urlsList}`);

  if (!urlFrom || !urlTo) {
    log.warn(`[Internal Links] Missing urlFrom or urlTo for suggestion ${suggestionId}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url: urlFrom,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: 'Missing urlFrom or urlTo in suggestion data',
      fixDetails: {},
    };
  }

  // Check redirects directly - we only care about redirects, not scrape content
  // Case 1: AI Suggestion Implemented via Redirect
  // Case 2: Edited URL Implemented via Redirect (when isEdited is true)
  if (urlsSuggested.length > 0) {
    log.debug(
      `[Internal Links] Checking if urlTo redirects to any of ${urlsSuggested.length} suggested URLs...`,
    );
    const redirectResult = await checkRedirectsToSuggested(
      urlTo,
      urlFrom,
      urlsSuggested,
      log,
      redirectResults,
    );

    if (redirectResult.redirectsToSuggested) {
      // urlTo redirects to suggested/edited URL - FIXED
      if (isEdited && urlEdited) {
        log.info(
          `[Internal Links] ✓ FIXED: Edited URL implemented via redirect - urlTo redirects to edited URL ${redirectResult.matchedUrl}`,
        );
        return {
          suggestionId,
          opportunityId: suggestion.getOpportunityId(),
          url: urlFrom,
          status: suggestion.getStatus(),
          isFixedViaAI: true,
          isFixedManually: false,
          scrapeFailed: false,
          reason: `Edited URL implemented via redirect: urlTo redirects to ${redirectResult.matchedUrl}`,
          fixDetails: {
            urlFrom,
            urlTo,
            urlsSuggested,
            isEdited,
            urlEdited,
            matchedUrl: redirectResult.matchedUrl,
            finalUrl: redirectResult.finalUrl,
            statusCode: redirectResult.statusCode,
          },
        };
      }
      log.info(
        `[Internal Links] ✓ FIXED: AI suggestion implemented via redirect - urlTo redirects to suggested URL ${redirectResult.matchedUrl}`,
      );
      return {
        suggestionId,
        opportunityId: suggestion.getOpportunityId(),
        url: urlFrom,
        status: suggestion.getStatus(),
        isFixedViaAI: true,
        isFixedManually: false,
        scrapeFailed: false,
        reason: `AI suggestion implemented via redirect: urlTo redirects to ${redirectResult.matchedUrl}`,
        fixDetails: {
          urlFrom,
          urlTo,
          urlsSuggested,
          isEdited,
          urlEdited: isEdited ? urlEdited : undefined,
          matchedUrl: redirectResult.matchedUrl,
          finalUrl: redirectResult.finalUrl,
          statusCode: redirectResult.statusCode,
        },
      };
    }
    log.debug('[Internal Links] urlTo does not redirect to any suggested URL');

    // Not fixed - include status code from redirect check
    const statusInfo = redirectResult.statusCode || 'N/A';
    log.info(
      `[Internal Links] ✗ NOT FIXED: urlTo does not redirect to suggested URL (${urlFrom} → ${urlTo}) - Status: ${statusInfo}`,
    );
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url: urlFrom,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: 'urlTo does not redirect to a suggested URL',
      fixDetails: {
        urlFrom,
        urlTo,
        urlsSuggested,
        isEdited,
        urlEdited: isEdited ? urlEdited : undefined,
        finalUrl: redirectResult.finalUrl,
        statusCode: redirectResult.statusCode,
      },
    };
  }

  // No suggested URLs - not fixed
  log.info(`[Internal Links] ✗ NOT FIXED: No suggested URLs to check (${urlFrom} → ${urlTo})`);
  return {
    suggestionId,
    opportunityId: suggestion.getOpportunityId(),
    url: urlFrom,
    status: suggestion.getStatus(),
    isFixedViaAI: false,
    isFixedManually: false,
    scrapeFailed: false,
    reason: 'No suggested URLs provided',
    fixDetails: {
      urlFrom,
      urlTo,
      urlsSuggested,
      isEdited,
      urlEdited: isEdited ? urlEdited : undefined,
    },
  };
}

/**
 * Batch process internal links suggestions with retry logic for 403 responses
 * Fetches redirects for all URLs at once in batches, then checks each suggestion
 * If any URLs return 403, retries them with delays
 * @param {Array<object>} suggestions - Array of suggestion objects
 * @param {string} siteId - Site UUID
 * @param {object} log - Logger instance
 * @returns {Promise<Array<object>>} Array of check results
 */
export async function checkInternalLinksFixedBatch(suggestions, siteId, log) {
  if (!suggestions || suggestions.length === 0) {
    return [];
  }

  log.info(`[Internal Links Batch] Processing ${suggestions.length} suggestions in batches of ${BATCH_SIZE}`);

  // Step 1: Collect all unique URLs to check
  const urlsToCheck = new Set();
  suggestions.forEach((suggestion) => {
    const data = suggestion.getData();
    const urlFrom = data?.urlFrom;
    const urlTo = data?.urlTo;

    if (urlTo && urlFrom) {
      const absoluteUrlTo = resolveUrl(urlTo, urlFrom);
      if (absoluteUrlTo) {
        urlsToCheck.add(absoluteUrlTo);
      }
    }
  });

  const uniqueUrls = Array.from(urlsToCheck);
  log.info(`[Internal Links Batch] Found ${uniqueUrls.length} unique URLs to check`);

  // Step 2: Fetch redirects for all URLs in batches
  const redirectResults = {};

  for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
    const batch = uniqueUrls.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueUrls.length / BATCH_SIZE);

    log.info(`[Internal Links Batch] Processing batch ${batchNum}/${totalBatches} (${batch.length} URLs)`);

    // eslint-disable-next-line no-await-in-loop
    const results = await getFinalUrlBatch(batch, log);

    // Store results in map by URL
    results.forEach((result) => {
      redirectResults[result.url] = result;
    });

    log.info(`[Internal Links Batch] Completed batch ${batchNum}/${totalBatches}`);
  }

  // Step 3: Retry any URLs that returned 403
  const urlsToRetry = Object.entries(redirectResults)
    .filter(([, result]) => result.statusCode === 403)
    .map(([url]) => url);

  if (urlsToRetry.length > 0) {
    log.info(`[Internal Links Batch] Found ${urlsToRetry.length} URLs with 403 responses, retrying...`);

    // Retry each 403 URL individually with delays
    for (const url of urlsToRetry) {
      log.debug(`[Internal Links Batch] Retrying 403 URL: ${url}`);

      // eslint-disable-next-line no-await-in-loop
      const retryResult = await getFinalUrlWithRetry(url, log);

      // Update the result if we got a different status
      if (retryResult.statusCode !== 403) {
        redirectResults[url] = retryResult;
        log.info(`[Internal Links Batch] Retry successful for ${url}: ${retryResult.statusCode}`);
      } else {
        log.debug(`[Internal Links Batch] Still got 403 after retries for ${url}`);
      }
    }

    log.info('[Internal Links Batch] Completed retrying 403 URLs');
  }

  // Step 4: Process all suggestions using cached redirect results
  const message = `[Internal Links Batch] Analyzing ${suggestions.length} suggestions `
    + 'with cached redirect data';
  log.info(message);

  const checkResults = await Promise.all(
    suggestions.map(
      (suggestion) => checkInternalLinksFixed(suggestion, siteId, log, redirectResults),
    ),
  );

  log.info('[Internal Links Batch] Completed processing all suggestions');

  return checkResults;
}

// Export cleanup function from browser-manager
export { closeSharedBrowser };

export default checkInternalLinksFixed;
