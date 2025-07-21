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

  if (urlsToScrape.length === 0) {
    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    log.info(`[preflight-audit] Found ${topPages?.length || 0} top pages for site ${site.getBaseURL()}`);

    if (!isNonEmptyArray(topPages)) {
      log.info('[preflight-audit] No top pages found, skipping accessibility audit');
      return;
    }

    urlsToScrape = topPages
      .map((page) => ({ url: page.getUrl(), traffic: page.getTraffic(), urlId: page.getId() }))
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 100);
    log.info(`[preflight-audit] Top 100 pages: ${JSON.stringify(urlsToScrape, null, 2)}`);
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
    log.info(`[preflight-audit] Sending ${remainingUrls.length} URLs to content scraper for accessibility audit`);

    try {
      const scrapeMessage = {
        urls: remainingUrls,
        siteId,
        jobId: siteId,
        processingType: AUDIT_TYPE_ACCESSIBILITY,
        type: 'accessibility',
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
  // No return statement needed
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
      aggregationResult = await aggregateAccessibilityData(
        s3Client,
        bucketName,
        siteId,
        log,
        outputKey,
        version,
      );

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

      // Use the existing accessibility audit function to group issues by opportunity type
      const aggregatedData = aggregateAccessibilityIssues(accessibilityData);

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
 * Accessibility handler for preflight that uses the same two-step pattern as main accessibility
 * handler
 */
export default async function accessibility(context, auditContext) {
  const { checks } = auditContext;

  if (!checks || checks.includes(PREFLIGHT_ACCESSIBILITY)) {
    // Step 1: Send URLs to content scraper for accessibility-specific processing
    await scrapeAccessibilityData(context, auditContext);
    // Step 2: Process scraped data and create opportunities
    await processAccessibilityOpportunities(context, auditContext);
  }
}
