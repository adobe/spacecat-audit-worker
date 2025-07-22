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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { aggregateAccessibilityData, getUrlsForAudit } from '../accessibility/utils/data-processing.js';
import {
  getExistingObjectKeysFromFailedAudits,
  getRemainingUrls,
  getExistingUrlsFromFailedAudits,
  updateStatusToIgnored,
} from '../accessibility/utils/scrape-utils.js';
import { aggregateAccessibilityIssues } from '../accessibility/utils/generate-individual-opportunities.js';
import { saveIntermediateResults } from './utils.js';

const AUDIT_TYPE_ACCESSIBILITY = Audit.AUDIT_TYPES.ACCESSIBILITY;
export const PREFLIGHT_ACCESSIBILITY = 'accessibility';

/**
 * Step 1: Send URLs to content scraper for accessibility-specific processing
 */
async function scrapeAccessibilityData(context, auditContext) {
  const {
    site, jobId, log, env, s3Client, dataAccess, sqs,
  } = context;
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

  // Get URLs to scrape (same as main accessibility handler)
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
        .map((page) => ({ url: page.getUrl(), traffic: page.getTraffic(), urlId: page.getId() }))
        .sort((a, b) => b.traffic - a.traffic)
        .slice(0, 100);
      log.info(`[preflight-audit] Top 100 pages: ${JSON.stringify(urlsToScrape, null, 2)}`);
    }
  }

  // Check for existing scraped data (same as main accessibility handler)
  const existingObjectKeys = await getExistingObjectKeysFromFailedAudits(
    s3Client,
    bucketName,
    siteId,
    log,
  );
  log.info(`[preflight-audit] Found existing files from failed audits: ${existingObjectKeys}`);

  const existingUrls = await getExistingUrlsFromFailedAudits(
    s3Client,
    bucketName,
    log,
    existingObjectKeys,
  );
  log.info(`[preflight-audit] Found existing URLs from failed audits: ${existingUrls}`);

  const remainingUrls = getRemainingUrls(urlsToScrape, existingUrls);
  log.info(`[preflight-audit] Remaining URLs to scrape: ${JSON.stringify(remainingUrls, null, 2)}`);

  // Send to content scraper with accessibility-specific processing
  if (remainingUrls.length > 0) {
    log.info(`[preflight-audit] Will send ${remainingUrls.length} URLs to content scraper`);
  } else {
    log.info('[preflight-audit] No remaining URLs to scrape, will process existing data');
  }

  if (remainingUrls.length > 0) {
    log.info(`[preflight-audit] Sending ${remainingUrls.length} URLs to content scraper for accessibility audit`);

    try {
      const scrapeMessage = {
        urls: remainingUrls,
        siteId,
        jobId: siteId,
        processingType: AUDIT_TYPE_ACCESSIBILITY,
        type: 'accessibility',
        ...(context.promiseToken ? { promiseToken: context.promiseToken } : {}),
      };

      // Send to content scraper queue
      await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, scrapeMessage);
      log.info(
        `[preflight-audit] Sent accessibility scraping request to content scraper for ${remainingUrls.length} URLs`,
      );
    } catch (error) {
      log.error(
        `[preflight-audit] Failed to send accessibility scraping request: ${error.message}`,
      );
    }
  }

  // Wait for scraping to complete by polling S3
  log.info('[preflight-audit] Waiting for accessibility scraping to complete...');
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 10 * 1000; // 10 seconds
  const startTime = Date.now();

  // eslint-disable-next-line no-await-in-loop
  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Check if accessibility data is available by trying to aggregate
      const version = new Date().toISOString().split('T')[0];
      const outputKey = `accessibility/${siteId}/${version}-final-result.json`;

      // eslint-disable-next-line no-await-in-loop
      const aggregationResult = await aggregateAccessibilityData(
        s3Client,
        bucketName,
        siteId,
        log,
        outputKey,
        version,
      );

      if (aggregationResult.success) {
        log.info('[preflight-audit] Accessibility scraping completed successfully');
        return;
      }

      log.info('[preflight-audit] Accessibility scraping still in progress, waiting...');
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, pollInterval);
      });
    } catch {
      log.info('[preflight-audit] Accessibility scraping still in progress, waiting...');
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, pollInterval);
      });
    }
  }

  log.warn('[preflight-audit] Accessibility scraping timed out after 5 minutes');
}

/**
 * Step 2: Process scraped accessibility data and create opportunities
 */
async function processAccessibilityOpportunities(context, auditContext) {
  const {
    site, jobId, log, env, s3Client, dataAccess,
  } = context;
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
    // Process scraped data (same as main accessibility handler)
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
        log.info(`[preflight-audit] No accessibility data available yet: ${aggregationResult.message}`);

        // Add a note to each page that accessibility data is being processed
        previewUrls.forEach((url) => {
          const pageResult = audits.get(url);
          const accessibilityAudit = pageResult.audits.find(
            (a) => a.name === PREFLIGHT_ACCESSIBILITY,
          );

          if (accessibilityAudit) {
            accessibilityAudit.opportunities.push({
              type: 'accessibility-processing',
              title: 'Accessibility Audit in Progress',
              description: 'Accessibility data is being collected. Please run the preflight audit again in a few minutes to see the results.',
              severity: 'info',
            });
          }
        });

        return;
      }
    } catch (error) {
      const errorMsg = `[preflight-audit] Error processing accessibility data: ${error.message}`;
      log.error(errorMsg, error);

      // Add error to audit results
      previewUrls.forEach((url) => {
        const pageResult = audits.get(url);
        // eslint-disable-next-line max-len
        const accessibilityAudit = pageResult.audits.find((a) => a.name === PREFLIGHT_ACCESSIBILITY);

        if (accessibilityAudit) {
          const prefix = 'Failed to process accessibility data: ';
          const errorDesc = prefix + error.message;
          accessibilityAudit.opportunities.push({
            type: 'accessibility-error',
            title: 'Accessibility Audit Error',
            description: errorDesc,
            severity: 'error',
          });
        }
      });

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
      const errorMsg = `[preflight-audit] Error mapping accessibility opportunities: ${error.message}`;
      log.error(errorMsg, error);
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
    const errorMsg = `[preflight-audit] site: ${site.getId()}, job: ${jobId}, step: ${step}. Accessibility audit failed: ${error.message}`;
    log.error(errorMsg, error);

    // Add error to audit results
    previewUrls.forEach((url) => {
      const pageResult = audits.get(url);
      // eslint-disable-next-line max-len
      const accessibilityAudit = pageResult.audits.find((a) => a.name === PREFLIGHT_ACCESSIBILITY);

      if (accessibilityAudit) {
        const prefix = 'Failed to complete accessibility audit: ';
        const errorDesc = prefix + error.message;
        accessibilityAudit.opportunities.push({
          type: 'accessibility-error',
          title: 'Accessibility Audit Error',
          description: errorDesc,
          severity: 'error',
        });
      }
    });
  }
}

/**
 * Accessibility handler for preflight that runs accessibility scraping and processing
 * Note: The main preflight process doesn't scrape accessibility data, so we need to do it here
 */
export default async function accessibility(context, auditContext) {
  const { checks } = auditContext;

  // eslint-disable-next-line max-len
  if (!checks || checks.includes(PREFLIGHT_ACCESSIBILITY)) {
    // Step 1: Send URLs to content scraper for accessibility-specific processing
    // and wait for completion
    await scrapeAccessibilityData(context, auditContext);
    // Step 2: Process scraped data and create opportunities
    await processAccessibilityOpportunities(context, auditContext);
  }
}
