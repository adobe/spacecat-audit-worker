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

import { createHash } from 'crypto';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { load as cheerioLoad } from 'cheerio';

import { saveIntermediateResults } from './utils.js';
import { sleep } from '../support/utils.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import { generateAccessibilityFilename } from './accessibility.js';
import { getDomElementSelector } from './utils/dom-selector.js';

export const PREFLIGHT_FORM_ACCESSIBILITY = 'form-accessibility';

/**
 * Generates a stable, unique filename for a single form's result file.
 *
 * Distinct from `generateAccessibilityFilename` (shared with the plain
 * accessibility.js audit, one file per URL) — a page can have multiple forms,
 * so the filename must also depend on the form's selector, not just the URL.
 *
 * Preserves the exact filename `generateAccessibilityFilename` would produce
 * when formSource is the generic 'form' fallback (no selector was computed) —
 * only diverges (with a disambiguating hash suffix) once a page genuinely has
 * more than one form and each gets its own real selector.
 *
 * @param {string} url - The page URL.
 * @param {string} formSource - The CSS selector identifying the form.
 * @returns {string} A filename like "example_com_page1_a1b2c3d4e5f6.json".
 */
export function generateFormAccessibilityFilename(url, formSource) {
  const base = generateAccessibilityFilename(url);
  if (!formSource || formSource === 'form') {
    return base;
  }
  const hash = createHash('md5').update(formSource).digest('hex').slice(0, 12);
  return `${base.replace(/\.json$/, '')}_${hash}.json`;
}

/**
 * Finds every <form> element in a page's scraped HTML and computes a unique
 * CSS selector for each. Returns one entry per form found.
 *
 * Falls back to a single generic-selector entry (today's behavior) when the
 * scrape can't be fetched/parsed, or when no <form> elements are found — this
 * keeps detection working (rather than dropping it entirely) if scrape data
 * is temporarily unavailable.
 *
 * @param {string} url - The page URL.
 * @param {object} s3Client
 * @param {string} bucketName
 * @param {string} siteId
 * @param {object} log
 * @returns {Promise<Array<{form: string, formSource: string}>>}
 */
async function findFormsOnPage(url, s3Client, bucketName, siteId, log) {
  const fallback = [{ form: url, formSource: 'form' }];

  let scrapeKey;
  try {
    scrapeKey = `scrapes/${siteId}${new URL(url).pathname.replace(/\/$/, '')}/scrape.json`;
  } catch (error) {
    log.warn(`[preflight-audit] ${siteId} Could not build scrape key for ${url}: ${error.message}, falling back to generic form selector`);
    return fallback;
  }

  const scrapeData = await getObjectFromKey(s3Client, bucketName, scrapeKey, log);
  const rawBody = scrapeData?.scrapeResult?.rawBody;

  if (!rawBody) {
    log.warn(`[preflight-audit] ${siteId} No scrape data found for ${url} at key: ${scrapeKey}, falling back to generic form selector`);
    return fallback;
  }

  let forms;
  try {
    const $ = cheerioLoad(rawBody);
    forms = $('form').toArray();
  } catch (error) {
    log.warn(`[preflight-audit] ${siteId} Failed to parse scrape for ${url}: ${error.message}, falling back to generic form selector`);
    return fallback;
  }

  if (forms.length === 0) {
    log.info(`[preflight-audit] ${siteId} No <form> elements found on ${url}, skipping`);
    return [];
  }

  const entries = forms
    .map((form) => getDomElementSelector(form))
    .filter(Boolean)
    .map((formSource) => ({ form: url, formSource }));

  if (entries.length === 0) {
    log.warn(`[preflight-audit] ${siteId} Found ${forms.length} <form> element(s) on ${url} but could not generate selectors, falling back to generic form selector`);
    return fallback;
  }

  return entries;
}

/**
 * Step 1: Send URLs to mystique for form accessibility-specific processing
 */
export async function detectFormAccessibility(context, auditContext) {
  const {
    site, job, log, env, sqs, s3Client,
  } = context;
  const jobMetadata = job.getMetadata();
  const { enableAuthentication = true } = jobMetadata.payload;
  const jobId = job?.getId();
  const {
    previewUrls,
    step,
    audits,
  } = auditContext;

  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  if (!bucketName) {
    const errorMsg = `[preflight-audit] ${siteId}, Missing S3 bucket configuration for form accessibility audit`;
    log.error(errorMsg);
    return [];
  }

  // Check if we have URLs to scrape
  if (!isNonEmptyArray(previewUrls)) {
    log.warn(`[preflight-audit] ${siteId}, No URLs to scrape for accessibility audit`);
    return [];
  }

  log.debug(`[preflight-audit] ${siteId}, job: ${jobId}, step: ${step}. Step 1: Preparing form accessibility scrape`);

  // Create form accessibility audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    if (pageResult) {
      pageResult.audits.push({ name: PREFLIGHT_FORM_ACCESSIBILITY, type: 'form-a11y', opportunities: [] });
    } else {
      log.warn(`[preflight-audit] ${siteId}, No audit entry found for URL: ${url}`);
    }
  });

  // Find every <form> on each page and compute a real selector for each one,
  // instead of sending a single generic 'form' selector that always matches
  // just the first <form> in DOM order (e.g. a header search widget ahead of
  // the actual content form) — see SITES-48703.
  const entriesPerPage = await Promise.all(
    previewUrls.map((url) => findFormsOnPage(url, s3Client, bucketName, siteId, log)),
  );
  const urlsToDetect = entriesPerPage.flat();

  log.info(`[preflight-audit] ${siteId} Using preview URLs for form accessibility audit: ${JSON.stringify(urlsToDetect, null, 2)}`);

  if (urlsToDetect.length > 0) {
    log.info(`[preflight-audit] ${siteId} Sending ${urlsToDetect.length} URLs to mystique for form accessibility audit`);

    try {
      const mystiqueMessage = {
        type: 'detect:forms-a11y',
        siteId,
        auditId: siteId,
        jobId: siteId,
        deliveryType: site.getDeliveryType(),
        time: new Date().toISOString(),
        data: {
          url: previewUrls[0], // M expects url in the data object for forms opportunity
          opportunityId: siteId,
          a11y: urlsToDetect,
        },
        options: {
          enableAuthentication,
          a11yPreflight: true,
          bucketName,
        },
      };

      log.debug(`[preflight-audit] ${siteId} Mystique message being sent: ${JSON.stringify(mystiqueMessage, null, 2)}`);
      log.debug(`[preflight-audit] ${siteId} S3 bucket: ${mystiqueMessage.options.bucketName}`);

      // Send to mystique queue
      log.debug(`[preflight-audit] ${siteId} Sending to queue: ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`);
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
      log.info(
        `[preflight-audit] ${siteId} Sent form accessibility audit request to mystique for ${urlsToDetect.length} URLs`,
      );
    } catch (error) {
      log.error(
        `[preflight-audit] ${siteId} Failed to send form accessibility audit request: ${error.message}`,
      );
      throw error;
    }
  } else {
    log.info(`[preflight-audit] ${siteId}  No URLs to detect for form accessibility audit`);
  }

  return urlsToDetect;
}

/**
 * Step 2: Process detected form accessibility issues and create opportunities
 */
export async function processFormAccessibilityOpportunities(context, auditContext, formEntries) {
  const {
    site, job, log, env, s3Client,
  } = context;
  const jobId = job?.getId();
  const {
    previewUrls,
    step,
    audits,
    auditsResult,
    timeExecutionBreakdown,
  } = auditContext;

  const accessibilityStartTime = Date.now();
  const accessibilityStartTimestamp = new Date().toISOString();
  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  if (!bucketName) {
    const errorMsg = `[preflight-audit] ${siteId}  Missing S3 bucket configuration for form accessibility audit`;
    log.error(errorMsg);
    return;
  }

  log.debug(`[preflight-audit] ${siteId}  Processing individual form accessibility result files for ${site.getBaseURL()}`);

  // Falls back to one generic entry per URL when the caller didn't pass the
  // detected entries (e.g. this function called standalone) — preserves the
  // original one-file-per-URL behavior in that case.
  const resolvedFormEntries = formEntries
    || previewUrls.map((url) => ({ form: url, formSource: 'form' }));

  try {
    // Process each detected form's accessibility result file (a page can have
    // more than one entry when it has multiple forms)
    for (const { form: url, formSource } of resolvedFormEntries) {
      try {
        // Generate the expected filename for this specific form
        const filename = generateFormAccessibilityFilename(url, formSource);

        const fileKey = `form-accessibility-preflight/${siteId}/${filename}`;
        log.info(`[preflight-audit] ${siteId}  Processing form accessibility file: ${fileKey}`);

        // Get the accessibility result file from S3 using existing utility
        // eslint-disable-next-line no-await-in-loop
        const accessibilityData = await getObjectFromKey(s3Client, bucketName, fileKey, log);

        if (!accessibilityData) {
          log.warn(`[preflight-audit] ${siteId} No form accessibility data found for ${url} at key: ${fileKey}`);
          // Skip to next URL if no data found
        } else {
          log.info(`[preflight-audit] ${siteId} Successfully loaded form accessibility data for ${url}`);

          // Get the page result for this URL
          const pageResult = audits.get(url);
          const accessibilityAudit = pageResult.audits.find(
            (a) => a.name === PREFLIGHT_FORM_ACCESSIBILITY,
          );

          if (accessibilityAudit && accessibilityData && accessibilityData.a11yIssues) {
            const issues = accessibilityData.a11yIssues.map((issue) => ({
              wcagLevel: issue.wcagLevel,
              severity: issue.severity,
              occurrences: issue.htmlWithIssues ? issue.htmlWithIssues.length : 0,
              htmlWithIssues: issue.htmlWithIssues,
              failureSummary: issue.failureSummary,
              description: issue.description,
              wcagRule: issue.type,
              type: issue.type,
              check: '',
              understandingUrl: '',
            }));
            accessibilityAudit.opportunities.push(...issues);

            log.debug(`[preflight-audit] ${siteId} Form accessibility audit details for ${url}:`, JSON.stringify(accessibilityAudit, null, 2));
          } else {
            log.warn(`[preflight-audit] ${siteId} No accessibility audit found for URL: ${url}`);
          }
        }
      } catch (error) {
        log.error(`[preflight-audit] Error processing accessibility file for ${url}: ${error.message}`, error);

        // Add error opportunity to the audit
        const pageResult = audits.get(url);
        const accessibilityAudit = pageResult.audits.find(
          (a) => a.name === PREFLIGHT_FORM_ACCESSIBILITY,
        );

        if (accessibilityAudit) {
          accessibilityAudit.opportunities.push({
            type: 'form-accessibility-error',
            title: 'Form Accessibility File Processing Error',
            description: `Failed to process form accessibility data for ${url}: ${error.message}`,
            severity: 'error',
          });
        }
      }
    }

    const accessibilityEndTime = Date.now();
    const accessibilityEndTimestamp = new Date().toISOString();
    const accessibilityElapsed = ((accessibilityEndTime - accessibilityStartTime) / 1000)
      .toFixed(2);

    log.info(
      `[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}.
Form Accessibility audit completed in ${accessibilityElapsed} seconds`,
    );

    timeExecutionBreakdown.push({
      name: 'form-accessibility-processing',
      duration: `${accessibilityElapsed} seconds`,
      startTime: accessibilityStartTimestamp,
      endTime: accessibilityEndTimestamp,
    });

    await saveIntermediateResults(context, auditsResult, 'form accessibility audit');

    // Clean up individual form accessibility files after processing
    try {
      const filesToDelete = resolvedFormEntries.map(({ form: url, formSource }) => {
        const filename = generateFormAccessibilityFilename(url, formSource);
        return `form-accessibility-preflight/${siteId}/${filename}`;
      });

      log.info(`[preflight-audit] Cleaning up ${filesToDelete.length} individual form accessibility files`);

      const deleteCommand = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: filesToDelete.map((Key) => ({ Key })),
          Quiet: true,
        },
      });

      await s3Client.send(deleteCommand);
      log.info(`[preflight-audit] ${siteId} Successfully cleaned up ${filesToDelete.length} form accessibility files`);
    } catch (cleanupError) {
      log.warn(`[preflight-audit] ${siteId} Failed to clean up form accessibility files: ${cleanupError.message}`);
      // Don't fail the entire audit if cleanup fails
    }
  } catch (error) {
    log.error(`[preflight-audit] ${siteId} not able to delete prefight files, site: ${site.getId()}, job: ${jobId}, step: ${step}. error ${error.message}`, error);
  }
}

/**
 * Form Accessibility preflight handler
 */
export default async function formAccessibility(context, auditContext) {
  const { previewUrls, timeExecutionBreakdown } = auditContext;
  const { log, site, job } = context;

  const siteId = site.getId();

  // Check if we have URLs to process
  if (!isNonEmptyArray(previewUrls)) {
    log.warn(`[preflight-audit] ${siteId} No URLs to process for form accessibility audit, skipping`);
    return;
  }

  // Start timing for the entire form accessibility scraping process
  // (sending to mystique + polling)
  const scrapeStartTime = Date.now();
  const scrapeStartTimestamp = new Date().toISOString();

  // Step 1: Send URLs to mystique to detect form accessibility issues
  const formEntries = await detectFormAccessibility(context, auditContext);

  // Poll for mystique to process the URLs
  const { s3Client, env } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const jobId = context.job?.getId();

  log.debug('[preflight-audit] Starting to poll for form accessibility data');
  log.debug(`[preflight-audit] S3 Bucket: ${bucketName}`);
  log.debug(`[preflight-audit] Site ID: ${siteId}`);
  log.debug(`[preflight-audit] Job ID: ${jobId}`);
  log.debug(`[preflight-audit] Looking for data in path: form-accessibility-preflight/${siteId}/`);

  const maxWaitTime = 10 * 60 * 1000;
  // 1 second poll interval
  const pollInterval = 1 * 1000;

  // Generate expected filenames based on the forms actually detected on each
  // page (a page can have more than one).
  const expectedFiles = formEntries.map(
    ({ form: url, formSource }) => generateFormAccessibilityFilename(url, formSource),
  );

  log.info(`[preflight-audit] ${siteId}  Expected files: ${JSON.stringify(expectedFiles)}`);

  // Recursive polling function to check for accessibility files
  const pollForFormAccessibilityFiles = async () => {
    if (Date.now() - scrapeStartTime >= maxWaitTime) {
      log.info('[preflight-audit] Maximum wait time reached, stopping polling');
      return;
    }

    try {
      log.info(`[preflight-audit] Polling attempt - checking S3 bucket: ${bucketName}`);

      // Check if form accessibility data files exist in S3 using helper function
      const objectKeys = await getObjectKeysUsingPrefix(
        s3Client,
        bucketName,
        `form-accessibility-preflight/${siteId}/`,
        log,
        100,
        '.json',
      );

      // Check if we have the expected accessibility files
      const foundFiles = objectKeys.filter((key) => {
        // Extract filename from the S3 key
        const pathParts = key.split('/');
        const filename = pathParts[pathParts.length - 1];

        // Check if this is one of our expected files
        return expectedFiles.includes(filename);
      });

      if (foundFiles && foundFiles.length >= expectedFiles.length) {
        log.info(`[preflight-audit] Found ${foundFiles.length} accessibility files out of ${expectedFiles.length} expected, form accessibility processing complete`);

        // Log the found files for debugging
        foundFiles.forEach((key) => {
          log.debug(`[preflight-audit] Form accessibility file: ${key}`);
        });
        return;
      }

      log.info(`[preflight-audit] Found ${foundFiles.length} out of ${expectedFiles.length} expected form accessibility files, continuing to wait...`);
      log.info('[preflight-audit] No form accessibility data yet, waiting...');
      await sleep(pollInterval);

      // Recursively call to continue polling
      await pollForFormAccessibilityFiles();
    } catch (error) {
      log.error(`[preflight-audit] Error polling for form accessibility data: ${error.message}`);
      await sleep(pollInterval);

      // Recursively call to continue polling after error
      await pollForFormAccessibilityFiles();
    }
  };

  // Start the polling process
  await pollForFormAccessibilityFiles();

  // End timing for the entire scraping process (sending to scraper + polling)
  const scrapeEndTime = Date.now();
  const scrapeEndTimestamp = new Date().toISOString();
  const scrapeElapsed = ((scrapeEndTime - scrapeStartTime) / 1000).toFixed(2);

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${job?.getId()}, step: ${auditContext.step}. `
    + `Form accessibility scraping process completed in ${scrapeElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'form-accessibility-scraping',
    duration: `${scrapeElapsed} seconds`,
    startTime: scrapeStartTimestamp,
    endTime: scrapeEndTimestamp,
  });

  log.info(`[preflight-audit] ${siteId} Polling completed, proceeding to process form accessibility data`);

  // Step 2: Process scraped data and create opportunities
  await processFormAccessibilityOpportunities(context, auditContext, formEntries);
}
