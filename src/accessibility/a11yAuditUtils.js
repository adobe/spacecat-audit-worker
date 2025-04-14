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
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import {
  getViolationsObject,
  isHeadless,
  complianceLevels,
  criticalLevel,
  seriousLevel,
  impactLevels,
  levelsMappedToLetter,
  successCriteriaLinks,
} from './constants.js';

function extractWCAGThreeDigitTags(tags) {
  // Return empty array if tags is not an array or is empty
  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  // Find all tags that match the pattern "wcag" followed by exactly 3 digits
  return tags.filter((tag) => tag.startsWith('wcag')
        && /^wcag\d{3,4}$/.test(tag));
}

/* eslint-disable no-param-reassign */
function updateFinalJson(finalJson, urlItem, results) {
  finalJson[urlItem.url] = getViolationsObject();
  finalJson[urlItem.url].traffic = urlItem.traffic;

  const totalViolations = {
    [criticalLevel]: 0,
    [seriousLevel]: 0,
  };

  results.violations.forEach((violation) => {
    const { impact } = violation;
    if (impactLevels.includes(impact)) {
      const violationCount = violation.nodes.length;
      const complianceLevel = violation.tags && violation.tags.length > 1 ? violation.tags[1] : '';
      const successCriteriaTags = extractWCAGThreeDigitTags(violation.tags);
      const successCriteriaNumber = successCriteriaTags.length > 0 ? successCriteriaTags[0].replace('wcag', '') : '';
      const complianceLevelLetter = complianceLevel.length > 0 ? levelsMappedToLetter[complianceLevel] : '';
      if (!finalJson[urlItem.url].violations[impact].items[violation.id]) {
        finalJson[urlItem.url].violations[impact].items[violation.id] = {
          count: violationCount,
          description: violation.help,
          level: complianceLevelLetter,
          htmlWithIssues: violation.nodes.map((node) => node.html),
          failureSummary: violation.nodes[0].failureSummary,
          helpUrl: violation.helpUrl,
          successCriteriaTags,
        };
        totalViolations[impact] += violationCount;
      }

      const understandingUrl = successCriteriaNumber.length > 0 ? successCriteriaLinks[successCriteriaNumber]?.understandingUrl : '';
      if (!finalJson.overall.violations[impact].items[violation.id]) {
        finalJson.overall.violations[impact].items[violation.id] = {
          count: violationCount,
          description: violation.help,
          level: complianceLevelLetter,
          understandingUrl,
          successCriteriaNumber,
        };
      } else {
        finalJson.overall.violations[impact].items[violation.id].count += violationCount;
      }
      finalJson.overall.violations[impact].count += violationCount;
    }
  });

  // update totals
  finalJson[urlItem.url].violations[criticalLevel].count = totalViolations[criticalLevel];
  finalJson[urlItem.url].violations[seriousLevel].count = totalViolations[seriousLevel];
  finalJson[urlItem.url].violations.total += totalViolations[criticalLevel];
  finalJson[urlItem.url].violations.total += totalViolations[seriousLevel];
  finalJson.overall.violations.total += finalJson[urlItem.url].violations.total;

  return finalJson;
}
/* eslint-enable no-param-reassign */

async function waitForPageLoad(page, log) {
  try {
    // Wait for navigation to complete
    await page.waitForLoadState('networkidle');

    // Check if we're on a blocked/error page
    const pageTitle = await page.title();
    if (pageTitle.toLowerCase().includes('blocked')
            || pageTitle.toLowerCase().includes('error')
            || pageTitle.toLowerCase().includes('access denied')) {
      throw new Error('Page appears to be blocked or showing an error');
    }

    // Wait for body to be present
    await page.waitForSelector('body', { timeout: 60000 });

    // Additional check for page state
    // eslint-disable-next-line no-undef
    const readyState = await page.evaluate(() => document.readyState);
    if (readyState !== 'complete') {
      throw new Error('Page did not load completely');
    }

    // Wait a bit more for any dynamic content
    await page.waitForTimeout(5000);
  } catch (error) {
    log.error('Page load error:', error.message);
    throw error;
  }
}

export async function runAccessibilityTests({ urls, batchSize, log }) {
  let finalJson = {
    overall: getViolationsObject(),
  };

  const logs = {
    done: 0,
    error: 0,
  };

  const runTest = async (urlItem) => {
    let browser = null;
    let page = null;

    async function loadPageWithRetries(retries) {
      try {
        log.info(`Attempting to load ${urlItem.url} (attempts left: ${retries})`);

        const context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
        });
        page = await context.newPage();

        await page.goto(urlItem.url, { waitUntil: 'networkidle' });
        await waitForPageLoad(page);

        return page;
      } catch (e) {
        if (retries <= 1) throw e;

        log.info(`Retrying ${urlItem.url}, attempts left: ${retries - 1}`);
        log.warn('Error:', e.message);

        // Wait before retry
        await new Promise((resolve) => {
          setTimeout(resolve, 10000);
        });

        // Recursively retry
        return loadPageWithRetries(retries - 1);
      }
    }

    try {
      // Launch browser with specific options
      browser = await chromium.launch({
        headless: isHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-software-rasterizer',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--disable-notifications',
          '--disable-popup-blocking',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=MemoryPressureBasedSourcePruning',
          '--disable-features=MemoryCoordinator',
          '--dns-prefetch-disable',
          '--window-size=1920,1080',
        ],
      });

      // Create a new context and page
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 SpaceCat/1.0',
      });

      page = await context.newPage();

      // Set default timeout
      page.setDefaultTimeout(120000);

      // Add headers if needed
      if (urlItem.url.includes('wilson')) {
        await context.setExtraHTTPHeaders({
          eds_process: 'h9E9Fvp#kvbpq93m',
        });
      }

      // Navigate to URL with retry logic
      const retries = 2;

      //   while (retries > 0) {
      //     try {
      //       log.info(`Attempting to load ${urlItem.url} (attempts left: ${retries})`);
      //       await page.goto(urlItem.url, { waitUntil: 'networkidle' });
      //       await waitForPageLoad(page);
      //       break;
      //     } catch (e) {
      //       retries -= 1;
      //       if (retries === 0) throw e;

      //       log.info(`Retrying ${urlItem.url}, attempts left: ${retries}`);
      //       log.warn('Error:', e.message);

      //       // Wait longer between retries
      //       await page.waitForTimeout(10000);

      //       // Close and create new context/page for retry
      //       if (page) await page.close();
      //       if (context) await context.close();

      //       const newContext = await browser.newContext({
      //         viewport: { width: 1920, height: 1080 },
      //       });
      //       page = await newContext.newPage();
      //     }
      //   }

      // Use the recursive retry function
      page = await loadPageWithRetries(retries);

      // Run axe-core analysis
      const results = await new AxeBuilder({ page })
        .withTags(complianceLevels)
        .analyze();

      finalJson = updateFinalJson(finalJson, urlItem, results);

      // save report per url
      // await writeFileToDir(urlItem.filename, directory, results);

      logs.done += 1;
      log.info(`Successfully processed ${urlItem.url}`);
    } catch (e) {
      logs.error += 1;
      log.error(`Error for ${urlItem.url}`, e);
    } finally {
      if (page) await page.close();
      if (browser) await browser.close();
    }
  };

  async function processBatch(startIndex) {
    if (startIndex >= urls.length) {
      return finalJson;
    }

    const batch = urls.slice(startIndex, startIndex + batchSize);
    log.info(`Processing batch ${Math.floor(startIndex / batchSize) + 1} of ${Math.ceil(urls.length / batchSize)}`);
    log.info(`URLs ${startIndex + 1} to ${Math.min(startIndex + batchSize, urls.length)} of ${urls.length}`);

    // Process all URLs in the batch in parallel
    await Promise.allSettled(
      batch.map((urlItem) => runTest(urlItem)),
    );

    // Wait between batches
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    // Process next batch recursively
    return processBatch(startIndex + batchSize);
  }

  // Process URLs in batches
  await processBatch(0);

  log.info(`Done: ${logs.done}, Error: ${logs.error}`);
  log.info(`Final JSON: ${JSON.stringify(finalJson)}`);

  return finalJson;
}
