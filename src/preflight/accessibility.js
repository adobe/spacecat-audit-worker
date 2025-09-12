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

import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';

import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import { saveIntermediateResults } from './utils.js';
import { sleep } from '../support/utils.js';
import { accessibilityOpportunitiesMap } from '../accessibility/utils/constants.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { formatWcagRule } from '../accessibility/utils/generate-individual-opportunities.js';

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
export async function scrapeAccessibilityData(context, auditContext, scrapeClient) {
  const {
    site, job, log,
  } = context;
  const jobMetadata = job.getMetadata();
  const { enableAuthentication = true } = jobMetadata.payload;
  const jobId = job?.getId();
  const {
    previewUrls,
    step,
    audits,
  } = auditContext;

  // Check if we have URLs to scrape
  if (!isNonEmptyArray(previewUrls)) {
    log.warn('[preflight-audit] No URLs to scrape for accessibility audit');
    return null;
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

  log.info(`[preflight-audit] Sending ${previewUrls.length} URLs to content scraper for accessibility audit`);
  let scrapeJob = null;
  const scrapeJobData = {
    previewUrls,
    options: {
      enableAuthentication,
      a11yPreflight: true,
      ...(context.promiseToken ? { promiseToken: context.promiseToken } : {}),
    },
    customHeaders: {},
    processingType: 'accessibility-preflight',
    maxScrapeAge: 0, // Force fresh scrape
  };

  try {
    log.debug(`[preflight-audit] Creating ScrapeJob for accessibility audit: ${JSON.stringify(scrapeJobData, null, 2)}`);
    scrapeJob = scrapeClient.createScrapeJob(scrapeJobData);

    log.debug(`[preflight-audit] Created ScrapeJob: ${JSON.stringify(scrapeJob, null, 2)}`);
    log.debug(`[preflight-audit] Processing type: ${scrapeJob.processingType}`);
    log.debug(`[preflight-audit] ScrapeJobId: ${scrapeJob.id}`);

    return scrapeJob.id;
  } catch (error) {
    log.error(
      `[preflight-audit] Failed to create accessibility ScrapeJob: ${error.message}`,
    );
    throw error;
  }
}

/**
 * Step 2: Process scraped accessibility data and create opportunities
 */
export async function processAccessibilityOpportunities(context, auditContext, scrapeResultPaths) {
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
        // Get the corresponding seKey from scrapeResultPaths
        const fileKey = scrapeResultPaths.get(url);

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
                      wcagRule: formatWcagRule(violationData.successCriteriaTags?.[0] || ''),
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
      name: 'accessibility-processing',
      duration: `${accessibilityElapsed} seconds`,
      startTime: accessibilityStartTimestamp,
      endTime: accessibilityEndTimestamp,
    });

    await saveIntermediateResults(context, auditsResult, 'accessibility audit');

    // Clean up individual accessibility files after processing
    try {
      const filesToDelete = [...scrapeResultPaths.values()];

      log.info(`[preflight-audit] Cleaning up ${filesToDelete.length} individual accessibility files`);

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
  const { checks, previewUrls, timeExecutionBreakdown } = auditContext;
  const { log, site, job } = context;

  if (!checks || checks.includes(PREFLIGHT_ACCESSIBILITY)) {
    // Check if we have URLs to process
    if (!isNonEmptyArray(previewUrls)) {
      log.warn('[preflight-audit] No URLs to process for accessibility audit, skipping');
      return;
    }

    const scrapeClient = ScrapeClient.createFrom(context);

    // Start timing for the entire accessibility scraping process (sending to scraper + polling)
    const scrapeStartTime = Date.now();
    const scrapeStartTimestamp = new Date().toISOString();

    // Step 1: Send URLs to content scraper for accessibility-specific processing
    const scrapeJobId = await scrapeAccessibilityData(context, auditContext, scrapeClient);

    // Poll for content scraper to process the URLs
    const siteId = context.site.getId();
    const jobId = context.job?.getId();

    log.debug('[preflight-audit] Starting to poll for accessibility data');
    log.debug(`[preflight-audit] Site ID: ${siteId}`);
    log.debug(`[preflight-audit] Job ID: ${jobId}`);
    log.debug(`[preflight-audit] Scrape Job ID: ${scrapeJobId}`);

    const maxWaitTime = 10 * 60 * 1000;
    // 1 second poll interval
    const pollInterval = 1 * 1000;

    // Generate expected filenames based on preview URLs
    const expectedFiles = previewUrls.map((url) => generateAccessibilityFilename(url));

    log.info(`[preflight-audit] Expected files: ${JSON.stringify(expectedFiles)}`);

    // Recursive polling function to check for accessibility files
    const pollForAccessibilityFiles = async () => {
      if (Date.now() - scrapeStartTime >= maxWaitTime) {
        log.info('[preflight-audit] Maximum wait time reached, stopping polling');
        return;
      }

      try {
        log.info(`[preflight-audit] Polling attempt - checking ScrapeJob Status for jobId: ${scrapeJobId}`);

        const scrapeJob = await scrapeClient.getScrapeJobStatus(scrapeJobId);

        log.info(`[preflight-audit] ScrapeJob Status: ${scrapeJob.status}`);

        if (scrapeJob.status === 'COMPLETED') {
          log.info('[preflight-audit] ScrapeJob completed, proceeding to process accessibility data');
          return;
        }
        log.info('[preflight-audit] ScrapeJob not completed yet, waiting...');
        await sleep(pollInterval);

        // Recursively call to continue polling
        await pollForAccessibilityFiles();
      } catch (error) {
        log.error(`[preflight-audit] Error polling for accessibility data: ${error.message}`);
        await sleep(pollInterval);

        // Recursively call to continue polling after error
        await pollForAccessibilityFiles();
      }
    };

    // Start the polling process
    await pollForAccessibilityFiles();

    // End timing for the entire scraping process (sending to scraper + polling)
    const scrapeEndTime = Date.now();
    const scrapeEndTimestamp = new Date().toISOString();
    const scrapeElapsed = ((scrapeEndTime - scrapeStartTime) / 1000).toFixed(2);

    log.info(`[preflight-audit] site: ${site.getId()}, job: ${job?.getId()}, step: ${auditContext.step}. Accessibility scraping process completed in ${scrapeElapsed} seconds`);

    timeExecutionBreakdown.push({
      name: 'accessibility-scraping',
      duration: `${scrapeElapsed} seconds`,
      startTime: scrapeStartTimestamp,
      endTime: scrapeEndTimestamp,
    });

    const scrapeResultPaths = scrapeClient.getScrapeResultPaths(scrapeJobId);

    log.info('[preflight-audit] Polling completed, proceeding to process accessibility data');

    // Step 2: Process scraped data and create opportunities
    await processAccessibilityOpportunities(context, auditContext, scrapeResultPaths);
  }
}
