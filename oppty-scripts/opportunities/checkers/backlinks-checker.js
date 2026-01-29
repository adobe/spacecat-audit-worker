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
      log.debug(`[Backlinks] Retry attempt ${attempt}/${maxRetries} for ${url} after 403 response`);
      // eslint-disable-next-line no-await-in-loop
      await delay(RETRY_DELAY_MS);
    }

    // eslint-disable-next-line no-await-in-loop
    result = await getFinalUrl(url, log);

    // If status is not 403, return the result (success or other error)
    if (result.statusCode !== 403) {
      if (attempt > 0) {
        log.info(`[Backlinks] Retry successful for ${url} - got status ${result.statusCode} after ${attempt} retries`);
      }
      return result;
    }

    // If we got 403, try again (unless we've exhausted retries)
    if (attempt < maxRetries) {
      log.debug(`[Backlinks] Got 403 for ${url}, will retry...`);
    }

    attempt += 1;
  }

  // All retries exhausted, still got 403
  log.info(`[Backlinks] Still got 403 for ${url} after ${maxRetries} retries`);
  return result;
}

/**
 * Normalize URL for comparison (remove trailing slashes, lowercase, normalize www)
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
function normalizeUrl(url) {
  if (!url) return '';
  let normalized = url.trim().toLowerCase();

  try {
    // Parse URL to normalize domain (remove www.)
    const urlObj = new URL(normalized.startsWith('http') ? normalized : `https://${normalized}`);
    let { hostname } = urlObj;

    // Remove www. prefix from hostname
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    // Reconstruct URL with normalized hostname
    normalized = `${urlObj.protocol}//${hostname}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
  } catch (e) {
    // If URL parsing fails, just use the normalized string as-is
  }

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Check if a backlinks suggestion has been fixed via AI
 *
 * Logic:
 * 1. Extract url_to (the broken URL) from the data
 * 2. Use browser to follow redirects for url_to and get the final URL
 * 3. Check if the final URL matches any URL in urlsSuggested or urls_suggested
 *    (or urlEdited if edited)
 * 4. If it matches, the AI suggestion has been implemented
 *
 * @param {object} suggestion - Suggestion object from data access
 * @param {string} siteId - Site UUID (unused, kept for API compatibility)
 * @param {object} log - Logger instance
 * @param {object} redirectResults - Optional pre-fetched redirect results
 *  (for batch processing)
 * @returns {Promise<object>} Check result
 */
export async function checkBacklinksFixed(suggestion, siteId, log, redirectResults = null) {
  const data = suggestion.getData();
  const url = data?.url_from || data?.url || data?.pageUrl || data?.source || '';
  const urlTo = data?.url_to;
  const originalUrlsSuggested = [
    ...(data?.urlsSuggested || []),
    ...(data?.urls_suggested || []),
  ].filter(Boolean);

  // Check if suggestion has been edited by user
  // Schema: edited URL stored at data.urlEdited, flag at data.isEdited
  const isEdited = Boolean(data?.isEdited);
  const urlEdited = data?.urlEdited; // User's edited URL

  // If edited, use urlEdited (single URL), otherwise use original suggested URLs
  const suggestedUrls = isEdited && urlEdited ? [urlEdited] : originalUrlsSuggested;

  const suggestionId = suggestion.getId();

  log.info(`[Backlinks] Checking suggestion ${suggestionId}`);
  log.info(`[Backlinks]   url_to: ${urlTo}`);
  log.info(`[Backlinks]   isEdited: ${isEdited}`);
  if (isEdited && urlEdited) {
    log.info(`[Backlinks]   urlEdited: ${urlEdited}`);
  }
  const urlsLabel = isEdited ? 'edited' : 'original';
  const urlsList = suggestedUrls.length > 0 ? suggestedUrls.join(', ') : 'none';
  log.info(`[Backlinks]   ${urlsLabel} suggestedUrls: ${urlsList}`);

  // If no url_to or no suggested URLs, can't check
  if (!urlTo) {
    log.warn(`[Backlinks] Missing url_to for suggestion ${suggestionId}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      reason: 'No url_to found in suggestion data',
      fixDetails: {},
    };
  }

  if (suggestedUrls.length === 0) {
    log.warn(`[Backlinks] No suggested URLs found for suggestion ${suggestionId}`);

    // Still try to get the final URL even without suggested URLs, to populate CSV
    let finalUrlForCsv = '';
    let statusCodeForCsv = '';
    try {
      log.debug(`[Backlinks] Fetching final URL for CSV (no suggestions): ${urlTo}`);
      const urlResult = await getFinalUrlWithRetry(urlTo, log);
      if (urlResult.success && urlResult.finalUrl) {
        finalUrlForCsv = urlResult.finalUrl;
        statusCodeForCsv = urlResult.statusCode;
      }
    } catch (err) {
      log.debug(`[Backlinks] Could not fetch final URL: ${err.message}`);
    }

    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      reason: 'No AI-suggested URLs found',
      fixDetails: {
        urlTo,
        finalUrl: finalUrlForCsv,
        statusCode: statusCodeForCsv || undefined,
        isEdited,
        urlEdited: isEdited ? urlEdited : undefined,
      },
    };
  }

  // Make browser call to url_to to get the final URL
  // Get redirect result - either from pre-fetched batch or fetch individually
  let result;
  if (redirectResults && redirectResults[urlTo]) {
    log.debug(`[Backlinks] Using cached redirect result for ${urlTo}`);
    result = redirectResults[urlTo];
  } else {
    log.debug(`[Backlinks] Following redirects for ${urlTo}...`);
    result = await getFinalUrlWithRetry(urlTo, log);
  }

  log.debug(`[Backlinks] Fetch result: statusCode=${result.statusCode}, finalUrl=${result.finalUrl}`);

  // Capture status code regardless of success
  const { statusCode } = result;

  if (!result.finalUrl) {
    log.debug(`[Backlinks] Failed to follow redirects for ${urlTo}: ${result.error || 'Unknown error'} (Status: ${statusCode})`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      reason: `Failed to fetch url_to: ${result.error || 'Unknown error'}`,
      fixDetails: {
        urlTo,
        finalUrl: result.finalUrl || '',
        suggestedUrls,
        isEdited,
        urlEdited: isEdited ? urlEdited : undefined,
        error: result.error,
        statusCode: result.statusCode,
      },
    };
  }

  // Note: We don't check the status code here because redirects (301/302) are
  // valid ways to fix broken links. As long as we successfully got a final URL
  // (even via redirect), we check if it matches a suggestion.

  // Normalize URLs for comparison
  const normalizedFinalUrl = normalizeUrl(result.finalUrl);
  const normalizedSuggestedUrls = suggestedUrls.map(normalizeUrl);

  // Check if final URL exactly matches any suggested URL (after normalization)
  const matchedUrl = normalizedSuggestedUrls.find(
    (suggestedUrl) => normalizedFinalUrl === suggestedUrl,
  );

  const isFixedViaAI = Boolean(matchedUrl);
  const isFixedManually = false; // Backlinks only tracks AI fixes

  const fixDetails = {
    urlTo,
    finalUrl: result.finalUrl,
    statusCode: result.statusCode,
    originalUrlsSuggested,
    suggestedUrls,
    matchedUrl: matchedUrl || null,
    isEdited,
    urlEdited: isEdited ? urlEdited : undefined,
  };

  if (data?.aiRationale || data?.ai_rationale) {
    fixDetails.aiRationale = data.aiRationale || data.ai_rationale;
  }

  let reason;
  if (isFixedViaAI) {
    if (isEdited && urlEdited) {
      reason = `Edited URL implemented: url_to redirects to edited URL (${matchedUrl})`;
      log.info(`[Backlinks] ✓ FIXED VIA EDITED URL: url_to redirects to edited URL ${matchedUrl}`);
    } else {
      reason = `AI suggestion implemented: url_to redirects to suggested URL (${matchedUrl})`;
      log.info(`[Backlinks] ✓ FIXED VIA AI: url_to redirects to suggested URL ${matchedUrl}`);
    }
  } else {
    reason = 'url_to does not redirect to any suggested URL';
    log.info('[Backlinks] ✗ NOT FIXED: url_to does not redirect to any suggested URL');
    log.info(`[Backlinks]   broken url: ${urlTo}`);
    log.info(`[Backlinks]   main url: ${result.finalUrl}`);
    log.info(`[Backlinks]   suggested urls: ${normalizedSuggestedUrls.join(', ')}`);
  }

  return {
    suggestionId,
    opportunityId: suggestion.getOpportunityId(),
    url,
    status: suggestion.getStatus(),
    isFixedViaAI,
    isFixedManually,
    reason,
    fixDetails,
  };
}

/**
 * Batch process backlinks suggestions with retry logic for 403 responses
 * Fetches redirects for all URLs at once in batches, then checks each suggestion
 * If any URLs return 403, retries them with delays
 * @param {Array<object>} suggestions - Array of suggestion objects
 * @param {string} siteId - Site UUID
 * @param {object} log - Logger instance
 * @returns {Promise<Array<object>>} Array of check results
 */
export async function checkBacklinksFixedBatch(suggestions, siteId, log) {
  if (!suggestions || suggestions.length === 0) {
    return [];
  }

  log.info(`[Backlinks Batch] Processing ${suggestions.length} suggestions in batches of ${BATCH_SIZE}`);

  // Step 1: Collect all unique URLs to check
  const urlsToCheck = new Set();
  suggestions.forEach((suggestion) => {
    const data = suggestion.getData();
    const urlTo = data?.url_to;

    if (urlTo) {
      urlsToCheck.add(urlTo);
    }
  });

  const uniqueUrls = Array.from(urlsToCheck);
  log.info(`[Backlinks Batch] Found ${uniqueUrls.length} unique URLs to check`);

  // Step 2: Fetch redirects for all URLs in batches
  const redirectResults = {};

  for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
    const batch = uniqueUrls.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueUrls.length / BATCH_SIZE);

    log.info(`[Backlinks Batch] Processing batch ${batchNum}/${totalBatches} (${batch.length} URLs)`);

    // eslint-disable-next-line no-await-in-loop
    const results = await getFinalUrlBatch(batch, log);

    // Store results in map by URL
    results.forEach((result) => {
      redirectResults[result.url] = result;
    });

    log.info(`[Backlinks Batch] Completed batch ${batchNum}/${totalBatches}`);
  }

  // Step 3: Retry any URLs that returned 403
  const urlsToRetry = Object.entries(redirectResults)
    .filter(([, result]) => result.statusCode === 403)
    .map(([url]) => url);

  if (urlsToRetry.length > 0) {
    log.info(`[Backlinks Batch] Found ${urlsToRetry.length} URLs with 403 responses, retrying...`);

    // Retry each 403 URL individually with delays
    for (const url of urlsToRetry) {
      log.debug(`[Backlinks Batch] Retrying 403 URL: ${url}`);

      // eslint-disable-next-line no-await-in-loop
      const retryResult = await getFinalUrlWithRetry(url, log);

      // Update the result if we got a different status
      if (retryResult.statusCode !== 403) {
        redirectResults[url] = retryResult;
        log.info(`[Backlinks Batch] Retry successful for ${url}: ${retryResult.statusCode}`);
      } else {
        log.debug(`[Backlinks Batch] Still got 403 after retries for ${url}`);
      }
    }

    log.info('[Backlinks Batch] Completed retrying 403 URLs');
  }

  // Step 4: Process all suggestions using cached redirect results
  log.info(`[Backlinks Batch] Analyzing ${suggestions.length} suggestions with cached redirect data`);

  const checkResults = await Promise.all(
    suggestions.map((suggestion) => checkBacklinksFixed(suggestion, siteId, log, redirectResults)),
  );

  log.info('[Backlinks Batch] Completed processing all suggestions');

  return checkResults;
}

// Export cleanup function from browser-manager
export { closeSharedBrowser };

export default checkBacklinksFixed;
