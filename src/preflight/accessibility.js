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
import { aggregateAccessibilityData, getUrlsForAudit } from '../accessibility/utils/data-processing.js';
import {
  updateStatusToIgnored,
} from '../accessibility/utils/scrape-utils.js';
import { aggregateAccessibilityIssues } from '../accessibility/utils/generate-individual-opportunities.js';
import { saveIntermediateResults } from './utils.js';

export const PREFLIGHT_ACCESSIBILITY = 'accessibility';

/**
 * Step 1: Send URLs to content scraper for accessibility-specific processing
 */
async function scrapeAccessibilityData(context, auditContext) {
  const {
    site, job, log, env, s3Client, dataAccess, sqs,
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

  log.info(`[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Step 1: Preparing accessibility scrape`);

  // Create accessibility audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ name: PREFLIGHT_ACCESSIBILITY, type: 'accessibility', opportunities: [] });
  });

  // Get URLs to scrape
  let urlsToScrape = [];
  urlsToScrape = await getUrlsForAudit(s3Client, bucketName, siteId, log);
  log.info(`[preflight-audit] getUrlsForAudit returned ${urlsToScrape.length} URLs`);

  if (urlsToScrape.length === 0) {
    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    log.info(`[preflight-audit] Found ${topPages?.length || 0} top pages for site ${site.getBaseURL()}`);

    if (!isNonEmptyArray(topPages)) {
      log.info('[preflight-audit] No top pages found, using preview URLs for accessibility audit');
      // Use preview URLs instead of skipping
      urlsToScrape = previewUrls.map((url) => ({ url }));
      log.info(`[preflight-audit] Using preview URLs: ${JSON.stringify(urlsToScrape, null, 2)}`);
    } else {
      urlsToScrape = topPages
        .map((page) => ({ url: page.getUrl(), traffic: page.getTraffic() }))
        .sort((a, b) => b.traffic - a.traffic)
        .slice(0, 100);
      log.info(`[preflight-audit] Top 100 pages: ${JSON.stringify(urlsToScrape, null, 2)}`);
    }
  }

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
        skipMessage: false,
        skipStorage: false,
        allowCache: false, // Force re-scraping even if files already exist
        options: {
          storagePath: `accessibility/${siteId}`, // Custom storage path
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

    // Add jobId to context for saveIntermediateResults
    const contextWithJobId = { ...context, jobId };
    await saveIntermediateResults(contextWithJobId, auditsResult, 'accessibility audit');
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
 * Accessibility handler for preflight that uses the same two-step pattern as main accessibility
 * handler
 */
export default async function accessibility(context, auditContext) {
  const { checks } = auditContext;

  if (!checks || checks.includes(PREFLIGHT_ACCESSIBILITY)) {
    // Step 1: Send URLs to content scraper for accessibility-specific processing
    await scrapeAccessibilityData(context, auditContext);

    // Poll for content scraper to process the URLs
    const { log, s3Client, env } = context;
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const siteId = context.site.getId();

    log.info('[preflight-audit] Starting to poll for accessibility data');
    log.info(`[preflight-audit] S3 Bucket: ${bucketName}`);
    log.info(`[preflight-audit] Site ID: ${siteId}`);
    log.info(`[preflight-audit] Looking for data in path: accessibility/${siteId}/`);

    const maxWaitTime = 10 * 60 * 1000; // 10 minutes
    const pollInterval = 30 * 1000; // 30 seconds
    const startTime = Date.now();

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
          Delimiter: '/', // Use delimiter to get subfolders
        });

        log.info(
          `[preflight-audit] S3 ListObjectsV2Command parameters: Bucket=${bucketName}, `
          + `Prefix=accessibility/${siteId}/, MaxKeys=10, Delimiter=/`,
        );

        // eslint-disable-next-line no-await-in-loop
        const response = await s3Client.send(listCommand);

        log.info(`[preflight-audit] S3 response received: CommonPrefixes=${response.CommonPrefixes?.length || 0}, Contents=${response.Contents?.length || 0}`);

        // Log all found subfolders for debugging
        if (response.CommonPrefixes && response.CommonPrefixes.length > 0) {
          log.info(`[preflight-audit] Found ${response.CommonPrefixes.length} subfolders in S3 bucket ${bucketName}:`);
          response.CommonPrefixes.forEach((prefix, index) => {
            log.info(`[preflight-audit]   Subfolder ${index + 1}: ${prefix.Prefix}`);
          });
        } else {
          log.info(`[preflight-audit] No subfolders found in S3 bucket ${bucketName}`);
        }

        // Log all found files for debugging
        if (response.Contents && response.Contents.length > 0) {
          log.info(`[preflight-audit] Found ${response.Contents.length} files in S3 bucket ${bucketName}:`);
          response.Contents.forEach((content, index) => {
            log.info(`[preflight-audit]   File ${index + 1}: ${content.Key}`);
          });
        } else {
          log.info(`[preflight-audit] No files found in S3 bucket ${bucketName}`);
        }

        // Check if we have files directly in the site folder
        const hasFilesInSiteFolder = response.Contents && response.Contents.length > 0;

        if (hasFilesInSiteFolder) {
          log.info(`[preflight-audit] Files found in site folder: ${response.Contents.length} files`);
          break;
        }

        log.info('[preflight-audit] No accessibility data yet, waiting...');
        // eslint-disable-next-line no-promise-executor-return, no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, pollInterval);
        });
      } catch (error) {
        log.error(`[preflight-audit] Error polling for accessibility data: ${error.message}`);
        // eslint-disable-next-line no-promise-executor-return, no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, pollInterval);
        });
      }
    }

    log.info('[preflight-audit] Polling completed, proceeding to process accessibility data');

    // Step 2: Process scraped data and create opportunities
    await processAccessibilityOpportunities(context, auditContext);
  }
}
