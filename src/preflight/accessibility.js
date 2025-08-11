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

import { saveIntermediateResults } from './utils.js';
import { sleep } from '../support/utils.js';
import { accessibilityOpportunitiesMap } from '../accessibility/utils/constants.js';
import { getObjectFromKey } from '../utils/s3-utils.js';

export const PREFLIGHT_ACCESSIBILITY = 'accessibility';

/**
 * Generate normalized filename from URL
 */
export function generateAccessibilityFilename(url) {
  try {
    const parsedUrl = new URL(url);
    let filename = parsedUrl.hostname + parsedUrl.pathname;
    filename = filename.replace(/\/$/, ''); // Remove trailing slash
    filename = filename.replace(/[^a-zA-Z0-9\-_]/g, '_'); // Replace invalid chars
    filename = filename.substring(0, 200); // Limit length
    return `${filename}.json`;
  } catch {
    return `invalid_url_${Date.now()}.json`;
  }
}

/**
 * Step 1: Send URLs to content scraper for accessibility-specific processing
 */
export async function scrapeAccessibilityData(context, auditContext) {
  const {
    site, job, log, env, sqs,
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
          enableAuthentication,
          a11yPreflight: true,
          ...(context.promiseToken ? { promiseToken: context.promiseToken } : {}),
        },
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
export async function processAccessibilityOpportunities(context, auditContext) {
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
    const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
    log.error(errorMsg);
    return;
  }

  log.info(`[preflight-audit] Processing individual accessibility result files for ${site.getBaseURL()}`);

  try {
    // Process each preview URL's accessibility result file
    for (const url of previewUrls) {
      try {
        // Generate the expected filename for this URL
        const filename = generateAccessibilityFilename(url);

        const fileKey = `accessibility-preflight/${siteId}/${filename}`;
        log.info(`[preflight-audit] Processing accessibility file: ${fileKey}`);

        // Get the accessibility result file from S3 using existing utility
        // eslint-disable-next-line no-await-in-loop
        const accessibilityData = await getObjectFromKey(s3Client, bucketName, fileKey, log);

        if (!accessibilityData) {
          log.warn(`[preflight-audit] No accessibility data found for ${url} at key: ${fileKey}`);
          // Skip to next URL if no data found
        } else {
          log.info(`[preflight-audit] Successfully loaded accessibility data for ${url}`);

          // Get the page result for this URL
          const pageResult = audits.get(url);
          const accessibilityAudit = pageResult.audits.find(
            (a) => a.name === PREFLIGHT_ACCESSIBILITY,
          );

          if (accessibilityAudit) {
            // Process violations and map them to opportunity types
            if (accessibilityData.violations) {
              Object.entries(accessibilityData.violations).forEach(([impact, impactData]) => {
                if (impact === 'total') return; // Skip the total count

                if (impactData.items) {
                  Object.entries(impactData.items).forEach(([violationId, violationData]) => {
                    // Map violation to opportunity type based on accessibilityOpportunitiesMap
                    let opportunityType = null;
                    let checkType = violationId;

                    // Check if this violation belongs to any defined opportunity type
                    for (const [type, checks] of Object.entries(accessibilityOpportunitiesMap)) {
                      if (checks.includes(violationId)) {
                        opportunityType = type;
                        checkType = violationId;
                        break;
                      }
                    }

                    // Skip violations that don't belong to any defined opportunity type
                    if (!opportunityType) {
                      return;
                    }

                    // Create opportunity object matching the accessibility audit format
                    const opportunity = {
                      wcagLevel: violationData.level || '',
                      severity: impact,
                      occurrences: violationData.count || '',
                      htmlWithIssues: violationData.htmlWithIssues?.map((html, index) => ({
                        target_selector: violationData.target?.[index] || '',
                        update_from: html || '',
                      })) || [],
                      failureSummary: violationData.failureSummary || '',
                      wcagRule: violationData.successCriteriaNumber || '',
                      description: violationData.description || '',
                      check: opportunityType,
                      type: checkType,
                      understandingUrl: violationData.understandingUrl || '',
                    };

                    accessibilityAudit.opportunities.push(opportunity);
                  });
                }
              });
            }

            log.info(`[preflight-audit] Accessibility audit details for ${url}:`, JSON.stringify(accessibilityAudit, null, 2));
          } else {
            log.warn(`[preflight-audit] No accessibility audit found for URL: ${url}`);
          }
        }
      } catch (error) {
        log.error(`[preflight-audit] Error processing accessibility file for ${url}: ${error.message}`, error);

        // Add error opportunity to the audit
        const pageResult = audits.get(url);
        const accessibilityAudit = pageResult.audits.find(
          (a) => a.name === PREFLIGHT_ACCESSIBILITY,
        );

        if (accessibilityAudit) {
          accessibilityAudit.opportunities.push({
            type: 'accessibility-error',
            title: 'Accessibility File Processing Error',
            description: `Failed to process accessibility data for ${url}: ${error.message}`,
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
Accessibility audit completed in ${accessibilityElapsed} seconds`,
    );

    timeExecutionBreakdown.push({
      name: 'accessibility',
      duration: `${accessibilityElapsed} seconds`,
      startTime: accessibilityStartTimestamp,
      endTime: accessibilityEndTimestamp,
    });

    await saveIntermediateResults(context, auditsResult, 'accessibility audit');

    // Clean up individual accessibility files after processing
    try {
      const filesToDelete = auditContext.previewUrls.map((url) => {
        const filename = generateAccessibilityFilename(url);
        return `accessibility-preflight/${siteId}/${filename}`;
      });

      log.info(`[preflight-audit] Cleaning up ${filesToDelete.length} individual accessibility files`);

      const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: filesToDelete.map((Key) => ({ Key })),
          Quiet: true,
        },
      });

      await s3Client.send(deleteCommand);
      log.info(`[preflight-audit] Successfully cleaned up ${filesToDelete.length} accessibility files`);
    } catch (cleanupError) {
      log.warn(`[preflight-audit] Failed to clean up accessibility files: ${cleanupError.message}`);
      // Don't fail the entire audit if cleanup fails
    }
  } catch (error) {
    log.error(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Accessibility audit failed: ${error.message}`, error);

    // Add error to audit results
    previewUrls.forEach((url) => {
      const pageResult = audits.get(url);
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
    if (
      !auditContext.previewUrls
      || !Array.isArray(auditContext.previewUrls)
      || auditContext.previewUrls.length === 0
    ) {
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
    log.info(`[preflight-audit] Looking for data in path: accessibility-preflight/${siteId}/`);

    const maxWaitTime = 10 * 60 * 1000;
    const pollInterval = 30 * 1000;
    const startTime = Date.now();

    // Import ListObjectsV2Command outside the loop
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');

    // Generate expected filenames based on preview URLs
    const expectedFiles = auditContext.previewUrls.map((url) => generateAccessibilityFilename(url));

    log.info(`[preflight-audit] Expected files: ${JSON.stringify(expectedFiles)}`);

    // eslint-disable-next-line no-await-in-loop
    while (Date.now() - startTime < maxWaitTime) {
      try {
        log.info(`[preflight-audit] Polling attempt - checking S3 bucket: ${bucketName}`);

        // Check if accessibility data files exist in S3
        const listCommand = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: `accessibility-preflight/${siteId}/`,
          MaxKeys: 100,
        });

        // eslint-disable-next-line no-await-in-loop
        const response = await s3Client.send(listCommand);

        // Check if we have the expected accessibility files
        const foundFiles = response.Contents && response.Contents.filter((obj) => {
          if (!obj.Key || !obj.Key.startsWith(`accessibility-preflight/${siteId}/`)) {
            return false;
          }

          // Extract filename from the S3 key
          const pathParts = obj.Key.split('/');
          const filename = pathParts[pathParts.length - 1];

          // Check if this is one of our expected files
          return expectedFiles.includes(filename);
        });

        if (foundFiles && foundFiles.length >= expectedFiles.length) {
          log.info(`[preflight-audit] Found ${foundFiles.length} accessibility files out of ${expectedFiles.length} expected, accessibility processing complete`);

          // Log the found files for debugging
          foundFiles.forEach((file) => {
            log.info(`[preflight-audit] Accessibility file: ${file.Key} (created: ${file.LastModified})`);
          });
          break;
        } else {
          const foundCount = foundFiles ? foundFiles.length : 0;
          log.info(`[preflight-audit] Found ${foundCount} out of ${expectedFiles.length} expected accessibility files, continuing to wait...`);
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
