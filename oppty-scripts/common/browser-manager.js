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

import puppeteer from 'puppeteer';

// Shared browser instance
let sharedBrowser = null;

// Mutex to ensure only one browser operation at a time
let browserLock = Promise.resolve();

// Track last batch call time for rate limiting
let lastBatchCallTime = 0;
const BATCH_CALL_DELAY_MS = 10000; // 10 seconds
const BATCH_SIZE = 10; // Number of URLs to process in parallel

/**
 * Wait for the required delay between batch calls
 * @returns {Promise<void>}
 */
async function waitForBatchDelay() {
  const now = Date.now();
  const timeSinceLastCall = now - lastBatchCallTime;

  if (timeSinceLastCall < BATCH_CALL_DELAY_MS) {
    const waitTime = BATCH_CALL_DELAY_MS - timeSinceLastCall;
    await new Promise((resolve) => {
      setTimeout(resolve, waitTime);
    });
  }

  lastBatchCallTime = Date.now();
}

/**
 * Acquire browser lock to ensure sequential browser operations
 * @returns {Promise<Function>} Release function
 */
async function acquireBrowserLock() {
  const currentLock = browserLock;

  // Create a promise and extract its resolver
  let resolveFunction;
  const lockPromise = new Promise((resolve) => {
    resolveFunction = resolve;
  });

  browserLock = lockPromise;

  // Wait for previous operation to complete
  await currentLock;

  return resolveFunction;
}

/**
 * Get or create the shared browser instance
 * @param {object} log - Logger instance
 * @returns {Promise<Browser>} Browser instance
 */
async function getSharedBrowser(log) {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }

  log.debug('[Browser] Launching new shared browser instance...');

  sharedBrowser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--start-maximized',
    ],
    defaultViewport: null,
  });

  log.debug('[Browser] Shared browser instance launched');

  return sharedBrowser;
}

/**
 * Close the shared browser instance
 * @param {object} log - Logger instance
 */
async function closeSharedBrowser(log) {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
      log.debug('[Browser] Shared browser instance closed');
    } catch (error) {
      log.debug(`[Browser] Error closing shared browser: ${error.message}`);
    }
    sharedBrowser = null;
  }
}

/**
 * Process a single URL in a page
 * @param {object} browser - Browser instance
 * @param {string} url - URL to check
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Object with finalUrl, statusCode, and error if any
 */
async function processSingleUrl(browser, url, log) {
  let page = null;

  try {
    // Ensure URL has protocol
    const urlToCheck = url.startsWith('http') ? url : `https://${url}`;

    log.debug(`[Browser] Opening new tab for ${urlToCheck}...`);

    // Create new page (tab) in the existing browser
    page = await browser.newPage();

    // Set a realistic user agent to avoid bot detection
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );

    // Set extra headers to mimic a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    });

    let statusCode = null;

    // Capture response to get status code
    page.on('response', (response) => {
      if (response.request().isNavigationRequest() && !statusCode) {
        statusCode = response.status();
      }
    });

    // Navigate to the URL with timeout
    const response = await page.goto(urlToCheck, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Get final URL after redirects
    const finalUrl = page.url();

    // Use the captured status code, or fall back to response status
    const finalStatusCode = statusCode || response?.status() || null;

    log.debug(`[Browser] Successfully loaded ${urlToCheck} -> ${finalUrl} (Status: ${finalStatusCode})`);

    return {
      url,
      finalUrl,
      statusCode: finalStatusCode,
      success: finalStatusCode >= 200 && finalStatusCode < 300,
    };
  } catch (error) {
    log.debug(`Failed to follow redirects for ${url}: ${error.message}`);
    return {
      url,
      finalUrl: null,
      statusCode: null,
      error: error.message,
      success: false,
    };
  } finally {
    // Close the page (tab) but keep browser open
    try {
      if (page) {
        await page.close();
        log.debug(`[Browser] Closed tab for ${url}`);
      }
    } catch (cleanupError) {
      log.debug(`Error closing page: ${cleanupError.message}`);
    }
  }
}

/**
 * Get the final URLs for a batch of URLs after following redirects
 * Opens up to BATCH_SIZE URLs concurrently, then waits BATCH_CALL_DELAY_MS before next batch
 * @param {Array<string>} urls - Array of URLs to check
 * @param {object} log - Logger instance
 * @returns {Promise<Array<object>>} Array of results with finalUrl, statusCode, and error if any
 */
async function getFinalUrlBatch(urls, log) {
  if (!urls || urls.length === 0) {
    return [];
  }

  // Acquire lock to ensure only one batch runs at a time
  const releaseLock = await acquireBrowserLock();

  try {
    // Wait for required delay between batch calls
    await waitForBatchDelay();

    log.debug(`[Browser] Processing batch of ${urls.length} URLs...`);

    // Get or create shared browser instance
    const browser = await getSharedBrowser(log);

    // Process all URLs in parallel
    const results = await Promise.all(
      urls.map((url) => processSingleUrl(browser, url, log)),
    );

    log.debug(`[Browser] Completed batch of ${urls.length} URLs`);

    return results;
  } finally {
    // Always release the lock
    releaseLock();
  }
}

/**
 * Get the final URL after following redirects using visible browser
 * @param {string} url - URL to check
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Object with finalUrl, statusCode, and error if any
 */
async function getFinalUrl(url, log) {
  // Use batch processing with a single URL
  const results = await getFinalUrlBatch([url], log);
  return results[0];
}

export {
  getSharedBrowser,
  closeSharedBrowser,
  getFinalUrl,
  getFinalUrlBatch,
  acquireBrowserLock,
  waitForBatchDelay,
  BATCH_SIZE,
};
