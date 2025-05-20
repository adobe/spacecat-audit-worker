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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { dataNeededForA11yAudit } from './utils/constants.js';
import { aggregateAccessibilityData } from './utils/utils.js';
import { current, lastWeek } from './utils/dev-purposes-constants.js';
import { generateInDepthOverviewMarkdown } from './utils/generateMdReports.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_TYPE_ACCESSIBILITY = 'accessibility'; // Defined audit type

// First step: sends a message to the content scraper to generate accessibility audits
async function scrapeAccessibilityData(context) {
  const { site, log, finalUrl } = context;
  log.info(`[A11yAudit] Step 1: Preparing content scrape for accessibility audit for ${site.getBaseURL()}`);

  // TODO: Determine what specific data/URLs the content scraper needs for accessibility.
  // For now, using finalUrl as a placeholder.
  const urlsToScrape = dataNeededForA11yAudit.urls;

  // The first step MUST return auditResult and fullAuditRef.
  // fullAuditRef could point to where the raw scraped data will be stored (e.g., S3 path).
  return {
    auditResult: { status: 'SCRAPING_REQUESTED', message: 'Content scraping for accessibility audit initiated.' },
    fullAuditRef: finalUrl,
    // Data for the CONTENT_SCRAPER
    urls: urlsToScrape,
    siteId: site.getId(),
    jobId: site.getId(),
    processingType: AUDIT_TYPE_ACCESSIBILITY,
    // Potentially add other scraper-specific options if needed
    concurrency: 25,
  };
}

// Second step: gets data from the first step and processes it to create new opportunities
async function processAccessibilityOpportunities(context) {
  const {
    site, log, s3Client, env,
  } = context;
  const siteId = site.getId();
  log.info(`[A11yAudit] Step 2: Processing scraped data for ${site.getBaseURL()}`);

  // Get the S3 bucket name from config or environment
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
    log.error(errorMsg);
    return {
      status: 'PROCESSING_FAILED',
      error: errorMsg,
    };
  }

  try {
    // Use the accessibility aggregator to process data
    const version = new Date().toISOString().split('T')[0];
    const outputKey = `accessibility/${siteId}/${version}-final-result.json`;
    const aggregationResult = await aggregateAccessibilityData(
      s3Client,
      bucketName,
      siteId,
      log,
      outputKey,
    );

    if (!aggregationResult.success) {
      log.warn(`[A11yAudit] No data aggregated: ${aggregationResult.message}`);
      return {
        status: 'NO_OPPORTUNITIES',
        message: aggregationResult.message,
      };
    }

    const { finalResultFiles } = aggregationResult;
    // const { current, lastWeek } = finalResultFiles;

    const inDepthOverviewMarkdown = generateInDepthOverviewMarkdown(current, lastWeek);
    console.log('inDepthOverviewMarkdown', inDepthOverviewMarkdown);

    // 1. generate the markdown report for in-depth overview
    // 2. generate oppty and suggestions for the report
    // 3. update status to ignored
    // 4. construct url for the report

    // 1. generate the markdown report for in-depth top 10
    // 2. generate oppty and suggestions for the report
    // 3. update status to ignored
    // 4. construct url for the report

    // 1. generate the markdown report for fixed vs new issues if any
    // 2. generate oppty and suggestions for the report
    // 3. update status to ignored
    // 4. construct url for the report

    // 1. generate the markdown report for base report and
    //    add the urls from the above reports into the markdown report
    // 2. generate oppty and suggestions for the report

    // Extract some key metrics for the audit result
    const totalIssues = finalResultFiles.current.overall.violations.total;
    const urlsProcessed = Object.keys(finalResultFiles.current).length;
    const categoriesByCount = Object.entries(finalResultFiles.current.overall.violations)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count }));

    // Return the final result
    return {
      status: totalIssues > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
      opportunitiesFound: totalIssues,
      urlsProcessed,
      topIssueCategories: categoriesByCount.slice(0, 5), // Top 5 issue categories
      summary: `Found ${totalIssues} accessibility issues across ${urlsProcessed} URLs`,
      fullReportUrl: outputKey, // Reference to the full report in S3
    };
  } catch (error) {
    log.error(`[A11yAudit] Error processing accessibility data: ${error.message}`, error);
    return {
      status: 'PROCESSING_FAILED',
      error: error.message,
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver) // Keeps the existing URL resolver
  // First step: Prepare and send data to CONTENT_SCRAPER
  .addStep('scrapeAccessibilityData', scrapeAccessibilityData, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  // Second step: Process the scraped data to find opportunities
  .addStep('processAccessibilityOpportunities', processAccessibilityOpportunities)
  .build();
