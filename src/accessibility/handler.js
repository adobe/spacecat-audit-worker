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
import { aggregateAccessibilityData, getUrlsForAudit, generateReportOpportunities } from './utils/data-processing.js';
import {
  getExistingObjectKeysFromFailedAudits,
  getRemainingUrls,
  getExistingUrlsFromFailedAudits,
  updateStatusToIgnored,
} from './utils/scrape-utils.js';
import { createAccessibilityIndividualOpportunities } from './utils/generate-individual-opportunities.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_TYPE_ACCESSIBILITY = Audit.AUDIT_TYPES.ACCESSIBILITY; // Defined audit type

export async function processImportStep(context) {
  const { site, finalUrl } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;

  return {
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    type: 'top-pages',
    siteId: site.getId(),
    allowCache: true,
  };
}

// First step: sends a message to the content scraper to generate accessibility audits
export async function scrapeAccessibilityData(context) {
  const {
    site, log, finalUrl, env, s3Client, dataAccess,
  } = context;
  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
    log.error(errorMsg);
    return {
      status: 'PROCESSING_FAILED',
      error: errorMsg,
    };
  }
  log.info(`[A11yAudit] Step 1: Preparing content scrape for accessibility audit for ${site.getBaseURL()} with siteId ${siteId}`);

  let urlsToScrape = [];
  urlsToScrape = await getUrlsForAudit(s3Client, bucketName, siteId, log);

  if (urlsToScrape.length === 0) {
    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    log.info(`[A11yAudit] Found ${topPages?.length || 0} top pages for site ${site.getBaseURL()}: ${JSON.stringify(topPages || [], null, 2)}`);
    if (!topPages || topPages.length === 0) {
      log.info('[A11yAudit] No top pages found, skipping audit');
      return {
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      };
    }

    urlsToScrape = topPages
      .map((page) => ({ url: page.getUrl(), traffic: page.getTraffic(), urlId: page.getId() }))
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 100);
    log.info(`[A11yAudit] Top 100 pages: ${JSON.stringify(urlsToScrape, null, 2)}`);
  }

  const existingObjectKeys = await getExistingObjectKeysFromFailedAudits(
    s3Client,
    bucketName,
    siteId,
    log,
  );
  log.info(`[A11yAudit] Found existing files from failed audits: ${existingObjectKeys}`);
  const existingUrls = await getExistingUrlsFromFailedAudits(
    s3Client,
    bucketName,
    log,
    existingObjectKeys,
  );
  log.info(`[A11yAudit] Found existing URLs from failed audits: ${existingUrls}`);
  const remainingUrls = getRemainingUrls(urlsToScrape, existingUrls);
  log.info(`[A11yAudit] Remaining URLs to scrape: ${JSON.stringify(remainingUrls, null, 2)}`);

  // The first step MUST return auditResult and fullAuditRef.
  // fullAuditRef could point to where the raw scraped data will be stored (e.g., S3 path).
  return {
    auditResult: {
      status: 'SCRAPING_REQUESTED',
      message: 'Content scraping for accessibility audit initiated.',
      scrapedUrls: remainingUrls,
    },
    fullAuditRef: finalUrl,
    // Data for the CONTENT_SCRAPER
    urls: remainingUrls,
    siteId,
    jobId: siteId,
    processingType: AUDIT_TYPE_ACCESSIBILITY,
  };
}

// Second step: gets data from the first step and processes it to create new opportunities
export async function processAccessibilityOpportunities(context) {
  const {
    site, log, s3Client, env, dataAccess,
  } = context;
  const siteId = site.getId();
  const version = new Date().toISOString().split('T')[0];
  const outputKey = `accessibility/${siteId}/${version}-final-result.json`;

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

  log.info(`[A11yAudit] Step 2: Processing scraped data for ${site.getBaseURL()}`);

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
      log.error(`[A11yAudit] No data aggregated: ${aggregationResult.message}`);
      return {
        status: 'NO_OPPORTUNITIES',
        message: aggregationResult.message,
      };
    }
  } catch (error) {
    log.error(`[A11yAudit] Error processing accessibility data: ${error.message}`, error);
    return {
      status: 'PROCESSING_FAILED',
      error: error.message,
    };
  }

  // change status to IGNORED for older opportunities
  await updateStatusToIgnored(dataAccess, siteId, log);

  try {
    await generateReportOpportunities(
      site,
      aggregationResult,
      context,
      AUDIT_TYPE_ACCESSIBILITY,
    );
  } catch (error) {
    log.error(`[A11yAudit] Error generating report opportunities: ${error.message}`, error);
    return {
      status: 'PROCESSING_FAILED',
      error: error.message,
    };
  }

  // Step 2c: Create individual opportunities (URL-specific accessibility issues)
  try {
    await createAccessibilityIndividualOpportunities(
      aggregationResult.finalResultFiles.current,
      context,
    );
    log.debug('[A11yAudit] Individual opportunities created successfully');
  } catch (error) {
    log.error(`[A11yAudit] Error creating individual opportunities: ${error.message}`, error);
    return {
      status: 'PROCESSING_FAILED',
      error: error.message,
    };
  }

  // Extract key metrics for the audit result summary
  const totalIssues = aggregationResult.finalResultFiles.current.overall.violations.total;
  // Subtract 1 for the 'overall' key to get actual URL count
  const urlsProcessed = Object.keys(aggregationResult.finalResultFiles.current).length - 1;

  log.info(`[A11yAudit] Found ${totalIssues} issues across ${urlsProcessed} URLs`);

  // Return the final audit result with metrics and status
  return {
    status: totalIssues > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
    opportunitiesFound: totalIssues,
    urlsProcessed,
    summary: `Found ${totalIssues} accessibility issues across ${urlsProcessed} URLs`,
    fullReportUrl: outputKey, // Reference to the full report in S3
  };
}

export default new AuditBuilder()
  .addStep('processImport', processImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  // First step: Prepare and send data to CONTENT_SCRAPER
  .addStep('scrapeAccessibilityData', scrapeAccessibilityData, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  // Second step: Process the scraped data to find opportunities
  .addStep('processAccessibilityOpportunities', processAccessibilityOpportunities)
  .build();
