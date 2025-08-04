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

import { aggregateAccessibilityData } from '../accessibility/utils/data-processing.js';
import {
  updateStatusToIgnored,
} from '../accessibility/utils/scrape-utils.js';
import { aggregateAccessibilityIssues } from '../accessibility/utils/generate-individual-opportunities.js';
import { saveIntermediateResults } from './utils.js';
import { sleep } from '../support/utils.js';

export const PREFLIGHT_ACCESSIBILITY = 'accessibility';

/**
 * Step 1: Send URLs to content scraper for accessibility-specific processing
 */
async function scrapeAccessibilityData(context, auditContext) {
  const {
    site, job, log, env, sqs,
  } = context;
  const jobId = job?.getId();
  const {
    previewUrls,
    step,
    audits,
  } = auditContext;

  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
    log.error(errorMsg);
    return;
  }

  // Check if we have URLs to scrape
  if (!previewUrls || !Array.isArray(previewUrls) || previewUrls.length === 0) {
    log.warn('[preflight-audit] No URLs to scrape for accessibility audit');
    return;
  }

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Step 1: Preparing accessibility scrape`);

  // Create accessibility audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    if (pageResult) {
      pageResult.audits.push({ name: PREFLIGHT_ACCESSIBILITY, type: 'a11y', opportunities: [] });
    } else {
      log.warn(`[preflight-audit] No audit entry found for URL: ${url}`);
    }
  });

  // Use the URLs from the preflight job request directly
  const urlsToScrape = previewUrls.map((url) => ({ url }));
  log.info(`[preflight-audit] Using preview URLs for accessibility audit: ${JSON.stringify(urlsToScrape, null, 2)}`);

  // Force re-scrape all URLs regardless of existing data
  log.info(`[preflight-audit] Force re-scraping all ${urlsToScrape.length} URLs for accessibility audit`);

  if (urlsToScrape.length > 0) {
    log.info(`[preflight-audit] Sending ${urlsToScrape.length} URLs to content scraper for accessibility audit`);

    try {
      const scrapeMessage = {
        urls: urlsToScrape,
        siteId,
        jobId: siteId, // Override jobId with siteId for correct storage path
        processingType: 'accessibility',
        s3BucketName: bucketName,
        completionQueueUrl: env.AUDIT_JOBS_QUEUE_URL,
        skipMessage: true,
        skipStorage: false,
        allowCache: false,
        forceRescrape: true,
        options: {
          storagePath: `accessibility/${siteId}`,
        },
        ...(context.promiseToken ? { promiseToken: context.promiseToken } : {}),
      };

      log.info(`[preflight-audit] Scrape message being sent: ${JSON.stringify(scrapeMessage, null, 2)}`);
      log.info(`[preflight-audit] Processing type: ${scrapeMessage.processingType}`);
      log.info(`[preflight-audit] S3 bucket: ${scrapeMessage.s3BucketName}`);
      log.info(`[preflight-audit] Completion queue: ${scrapeMessage.completionQueueUrl}`);

      // Send to content scraper queue
      log.info(`[preflight-audit] Sending to queue: ${env.CONTENT_SCRAPER_QUEUE_URL}`);
      await sqs.sendMessage(env.CONTENT_SCRAPER_QUEUE_URL, scrapeMessage);
      log.info(
        `[preflight-audit] Sent accessibility scraping request to content scraper for ${urlsToScrape.length} URLs`,
      );
    } catch (error) {
      log.error(
        `[preflight-audit] Failed to send accessibility scraping request: ${error.message}`,
      );
      throw error;
    }
  } else {
    log.info('[preflight-audit] No URLs to scrape');
  }
}

/**
 * Step 2: Process scraped accessibility data and create opportunities
 */
async function processAccessibilityOpportunities(context, auditContext) {
  const {
    site, job, log, env, s3Client, dataAccess,
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
    const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
    log.error(errorMsg);
    return;
  }

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Step 2: Processing accessibility data`);

  try {
    // Process scraped data
    const version = new Date().toISOString().split('T')[0];
    const outputKey = `accessibility/${siteId}/${version}-final-result.json`;

    log.info(`[preflight-audit] Processing scraped accessibility data for ${site.getBaseURL()}`);

    // Use the accessibility aggregator to process data
    let aggregationResult;
    try {
      log.info(`[preflight-audit] Calling aggregateAccessibilityData for siteId: ${siteId}, bucket: ${bucketName}, version: ${version}`);
      aggregationResult = await aggregateAccessibilityData(
        s3Client,
        bucketName,
        siteId,
        log,
        outputKey,
        version,
      );

      log.info(`[preflight-audit] aggregateAccessibilityData result: success=${aggregationResult.success}, message=${aggregationResult.message || 'N/A'}`);

      if (!aggregationResult.success) {
        log.error(`[preflight-audit] No data aggregated: ${aggregationResult.message}`);
        return;
      }
    } catch (error) {
      log.error(`[preflight-audit] Error processing accessibility data: ${error.message}`, error);
      return;
    }

    // Update existing opportunities status
    await updateStatusToIgnored(dataAccess, siteId, log);

    // Map individual accessibility opportunities to preflight structure
    try {
      const accessibilityData = aggregationResult.finalResultFiles.current;
      const totalIssues = accessibilityData.overall.violations.total;
      const urlsProcessed = Object.keys(accessibilityData).length - 1;

      log.info(
        `[preflight-audit] Found ${totalIssues} accessibility issues across \n${urlsProcessed} URLs`,
      );

      log.info(`[preflight-audit] Accessibility data keys: ${JSON.stringify(Object.keys(accessibilityData))}`);
      log.info(`[preflight-audit] Overall violations: ${JSON.stringify(accessibilityData.overall.violations)}`);

      // Use the existing accessibility audit function to group issues by opportunity type
      log.info('[preflight-audit] Calling aggregateAccessibilityIssues');
      const aggregatedData = aggregateAccessibilityIssues(accessibilityData);
      log.info(`[preflight-audit] aggregateAccessibilityIssues result: ${JSON.stringify(aggregatedData)}`);

      const opportunityTypes = aggregatedData.data.map((item) => Object.keys(item)[0]).join(', ');
      log.info(
        `[preflight-audit] Grouped accessibility opportunities by type: \n${opportunityTypes}`,
      );

      // Add grouped opportunities to each page's audit
      previewUrls.forEach((url) => {
        const pageResult = audits.get(url);
        const accessibilityAudit = pageResult.audits.find(
          (a) => a.name === PREFLIGHT_ACCESSIBILITY,
        );

        if (accessibilityAudit) {
          // Add opportunities for each check type that has issues on this page
          aggregatedData.data.forEach((opportunityTypeData) => {
            const [, urlsWithIssues] = Object.entries(opportunityTypeData)[0];
            const pageData = urlsWithIssues.find((urlData) => urlData.url === url);

            if (pageData && pageData.issues.length > 0) {
              // Add individual opportunities for this check type
              pageData.issues.forEach((issue) => {
                const opportunityType = Object.keys(opportunityTypeData)[0];
                accessibilityAudit.opportunities.push({
                  // eslint-disable-next-line max-len
                  check: opportunityType, // Use opportunity type as check (e.g., 'a11y-assistive')
                  type: issue.type, // Use the issue type as the type
                  description: issue.description,
                  wcagRule: issue.wcagRule,
                  wcagLevel: issue.wcagLevel,
                  severity: issue.severity,
                  occurrences: issue.occurrences,
                  htmlWithIssues: issue.htmlWithIssues,
                  failureSummary: issue.failureSummary,
                });
              });
            }
          });
        }
      });
    } catch (error) {
      log.error(`[preflight-audit] Error mapping accessibility opportunities: ${error.message}`, error);
      return;
    }

    const accessibilityEndTime = Date.now();
    const accessibilityEndTimestamp = new Date().toISOString();
    const accessibilityElapsed = ((accessibilityEndTime - accessibilityStartTime) / 1000)
      .toFixed(2);

    log.info(
      `[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}.
Accessibility audit completed in ${accessibilityElapsed} seconds`,
    );

    timeExecutionBreakdown.push({
      name: 'accessibility',
      duration: `${accessibilityElapsed} seconds`,
      startTime: accessibilityStartTimestamp,
      endTime: accessibilityEndTimestamp,
    });

    await saveIntermediateResults(context, auditsResult, 'accessibility audit');
  } catch (error) {
    log.error(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Accessibility audit failed: ${error.message}`, error);

    // Add error to audit results
    previewUrls.forEach((url) => {
      const pageResult = audits.get(url);
      // eslint-disable-next-line max-len
      const accessibilityAudit = pageResult.audits.find((a) => a.name === PREFLIGHT_ACCESSIBILITY);

      if (accessibilityAudit) {
        accessibilityAudit.opportunities.push({
          type: 'accessibility-error',
          title: 'Accessibility Audit Error',
          description: `Failed to complete accessibility audit: ${error.message}`,
          severity: 'error',
        });
      }
    });
  }
}

/**
 * Accessibility preflight handler
 */
export default async function accessibility(context, auditContext) {
  const { checks } = auditContext;
  const { log } = context;

  if (!checks || checks.includes(PREFLIGHT_ACCESSIBILITY)) {
    // Check if we have URLs to process
    // eslint-disable-next-line max-len
    if (!auditContext.previewUrls || !Array.isArray(auditContext.previewUrls) || auditContext.previewUrls.length === 0) {
      log.warn('[preflight-audit] No URLs to process for accessibility audit, skipping');
      return;
    }

    // Step 1: Send URLs to content scraper for accessibility-specific processing
    await scrapeAccessibilityData(context, auditContext);

    // Poll for content scraper to process the URLs
    const { s3Client, env } = context;
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const siteId = context.site.getId();
    const jobId = context.job?.getId();

    log.info('[preflight-audit] Starting to poll for accessibility data');
    log.info(`[preflight-audit] S3 Bucket: ${bucketName}`);
    log.info(`[preflight-audit] Site ID: ${siteId}`);
    log.info(`[preflight-audit] Job ID: ${jobId}`);
    log.info(`[preflight-audit] Looking for data in path: accessibility/${siteId}/`);

    const maxWaitTime = 10 * 60 * 1000;
    const pollInterval = 30 * 1000;
    const startTime = Date.now();
    const jobStartTime = Date.now();

    // Import ListObjectsV2Command outside the loop
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');

    // eslint-disable-next-line no-await-in-loop
    while (Date.now() - startTime < maxWaitTime) {
      try {
        log.info(`[preflight-audit] Polling attempt - checking S3 bucket: ${bucketName}`);

        // Check if accessibility data files exist in S3
        const listCommand = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: `accessibility/${siteId}/`,
          MaxKeys: 10,
        });

        // eslint-disable-next-line no-await-in-loop
        const response = await s3Client.send(listCommand);

        // Check if we have a final result file in the accessibility/siteid folder
        // that was created after the job started
        const hasFinalResultFile = response.Contents && response.Contents.some((obj) => {
          if (!obj.Key || !obj.Key.includes('-final-result.json') || !obj.Key.startsWith(`accessibility/${siteId}/`)) {
            return false;
          }

          // Check if the file was created after this job started
          const fileCreatedTime = obj.LastModified ? obj.LastModified.getTime() : 0;
          return fileCreatedTime > jobStartTime;
        });

        if (hasFinalResultFile) {
          log.info('[preflight-audit] Final result file found in accessibility/siteid folder (created after job start), accessibility processing complete');

          // Log the final result file for debugging
          const finalResultFile = response.Contents.find((obj) => {
            if (!obj.Key || !obj.Key.includes('-final-result.json') || !obj.Key.startsWith(`accessibility/${siteId}/`)) {
              return false;
            }
            const fileCreatedTime = obj.LastModified ? obj.LastModified.getTime() : 0;
            return fileCreatedTime > jobStartTime;
          });
          log.info(`[preflight-audit] Final result file: ${finalResultFile.Key} (created: ${finalResultFile.LastModified})`);
          break;
        } else {
          log.info('[preflight-audit] No final result file found yet, continuing to wait...');
        }

        log.info('[preflight-audit] No accessibility data yet, waiting...');
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollInterval);
      } catch (error) {
        log.error(`[preflight-audit] Error polling for accessibility data: ${error.message}`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollInterval);
      }
    }

    log.info('[preflight-audit] Polling completed, proceeding to process accessibility data');

    // Step 2: Process scraped data and create opportunities
    await processAccessibilityOpportunities(context, auditContext);
  }
}
