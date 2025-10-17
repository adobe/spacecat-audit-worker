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
import { AuditBuilder } from '../common/audit-builder.js';
import {
  aggregateAccessibilityData,
  getUrlsForAudit,
  generateReportOpportunities,
  sendRunImportMessage,
} from './utils/data-processing.js';
import {
  getExistingObjectKeysFromFailedAudits,
  getRemainingUrls,
  getExistingUrlsFromFailedAudits,
  updateStatusToIgnored,
} from './utils/scrape-utils.js';
import { createAccessibilityIndividualOpportunities } from './utils/generate-individual-opportunities.js';
import { URL_SOURCE_SEPARATOR, A11Y_METRICS_AGGREGATOR_IMPORT_TYPE, WCAG_CRITERIA_COUNTS } from './utils/constants.js';

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
export async function scrapeAccessibilityData(context, deviceType = 'desktop') {
  const {
    site, log, finalUrl, env, s3Client, dataAccess,
  } = context;
  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
    log.error(`[A11yProcessingError] ${errorMsg}`);
    return {
      status: 'PROCESSING_FAILED',
      error: errorMsg,
    };
  }
  log.debug(`[A11yAudit] Step 1: Preparing content scrape for ${deviceType} accessibility audit for ${site.getBaseURL()} with siteId ${siteId}`);

  let urlsToScrape = [];
  urlsToScrape = await getUrlsForAudit(s3Client, bucketName, siteId, log);

  if (urlsToScrape.length === 0) {
    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    log.debug(`[A11yAudit] Found ${topPages?.length || 0} top pages for site ${site.getBaseURL()}: ${JSON.stringify(topPages || [], null, 2)}`);
    if (!isNonEmptyArray(topPages)) {
      log.info(`[A11yAudit] No top pages found for site ${siteId} (${site.getBaseURL()}), skipping audit`);
      return {
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      };
    }

    urlsToScrape = topPages
      .map((page) => ({ url: page.getUrl(), traffic: page.getTraffic(), urlId: page.getId() }))
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 100);
    log.debug(`[A11yAudit] Top 100 pages for site ${siteId} (${site.getBaseURL()}): ${JSON.stringify(urlsToScrape, null, 2)}`);
  }

  const existingObjectKeys = await getExistingObjectKeysFromFailedAudits(
    s3Client,
    bucketName,
    siteId,
    log,
  );

  const existingUrls = await getExistingUrlsFromFailedAudits(
    s3Client,
    bucketName,
    log,
    existingObjectKeys,
  );

  const remainingUrls = getRemainingUrls(urlsToScrape, existingUrls);

  // The first step MUST return auditResult and fullAuditRef.
  // fullAuditRef could point to where the raw scraped data will be stored (e.g., S3 path).
  const storagePrefix = deviceType === 'mobile' ? 'accessibility-mobile' : 'accessibility';
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
    options: {
      storagePrefix,
      deviceType,
    },
  };
}

// Second step: gets data from the first step and processes it to create new opportunities
export async function processAccessibilityOpportunities(context) {
  const {
    site, log, s3Client, env, dataAccess, sqs,
  } = context;
  const siteId = site.getId();
  const version = new Date().toISOString().split('T')[0];
  const outputKey = `accessibility/${siteId}/${version}-final-result.json`;

  // Get the S3 bucket name from config or environment
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
    log.error(`[A11yProcessingError] ${errorMsg}`);
    return {
      status: 'PROCESSING_FAILED',
      error: errorMsg,
    };
  }

  log.debug(`[A11yAudit] Step 2: Processing scraped data for site ${siteId} (${site.getBaseURL()})`);

  // Use the accessibility aggregator to process data
  let aggregationResult;
  try {
    aggregationResult = await aggregateAccessibilityData(
      s3Client,
      bucketName,
      siteId,
      log,
      outputKey,
      AUDIT_TYPE_ACCESSIBILITY,
      version,
    );

    if (!aggregationResult.success) {
      log.error(`[A11yAudit][A11yProcessingError] No data aggregated for site ${siteId} (${site.getBaseURL()}): ${aggregationResult.message}`);
      return {
        status: 'NO_OPPORTUNITIES',
        message: aggregationResult.message,
      };
    }
  } catch (error) {
    log.error(`[A11yAudit][A11yProcessingError] Error processing accessibility data for site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
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
    log.error(`[A11yAudit][A11yProcessingError] Error generating report opportunities for site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
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
    log.debug(`[A11yAudit] Individual opportunities created successfully for site ${siteId} (${site.getBaseURL()})`);
  } catch (error) {
    log.error(`[A11yAudit][A11yProcessingError] Error creating individual opportunities for site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
    return {
      status: 'PROCESSING_FAILED',
      error: error.message,
    };
  }

  // step 3 save a11y metrics to s3
  try {
    // Send message to importer-worker to save a11y metrics
    await sendRunImportMessage(
      sqs,
      env.IMPORT_WORKER_QUEUE_URL,
      A11Y_METRICS_AGGREGATOR_IMPORT_TYPE,
      siteId,
      {
        scraperBucketName: env.S3_SCRAPER_BUCKET_NAME,
        importerBucketName: env.S3_IMPORTER_BUCKET_NAME,
        version,
        urlSourceSeparator: URL_SOURCE_SEPARATOR,
        totalChecks: WCAG_CRITERIA_COUNTS.TOTAL,
        options: {},
      },
    );
    log.debug(`[A11yAudit] Sent message to importer-worker to save a11y metrics for site ${siteId}`);
  } catch (error) {
    log.error(`[A11yAudit][A11yProcessingError] Error sending message to importer-worker to save a11y metrics for site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
    return {
      status: 'PROCESSING_FAILED',
      error: error.message,
    };
  }

  // Extract key metrics for the audit result summary
  const totalIssues = aggregationResult.finalResultFiles.current.overall.violations.total;
  // Subtract 1 for the 'overall' key to get actual URL count
  const urlsProcessed = Object.keys(aggregationResult.finalResultFiles.current).length - 1;

  log.info(`[A11yAudit] Found ${totalIssues} issues across ${urlsProcessed} unique URLs for site ${siteId} (${site.getBaseURL()})`);

  // Return the final audit result with metrics and status
  return {
    status: totalIssues > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
    opportunitiesFound: totalIssues,
    urlsProcessed,
    summary: `Found ${totalIssues} accessibility issues across ${urlsProcessed} URLs`,
    fullReportUrl: outputKey, // Reference to the full report in S3
  };
}

// Factory function to create device-specific processing function
export function createProcessAccessibilityOpportunitiesWithDevice(deviceType) {
  return async function processAccessibilityOpportunitiesWithDevice(context) {
    const {
      site, log, s3Client, env, dataAccess, sqs,
    } = context;
    const siteId = site.getId();
    const version = new Date().toISOString().split('T')[0];
    const outputKey = deviceType === 'mobile' ? `accessibility-mobile/${siteId}/${version}-final-result.json` : `accessibility/${siteId}/${version}-final-result.json`;

    // Get the S3 bucket name from config or environment
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    if (!bucketName) {
      const errorMsg = 'Missing S3 bucket configuration for accessibility audit';
      log.error(`[A11yProcessingError] ${errorMsg}`);
      return {
        status: 'PROCESSING_FAILED',
        error: errorMsg,
      };
    }

    log.info(`[A11yAudit] Step 2: Processing scraped data for ${deviceType} on site ${siteId} (${site.getBaseURL()})`);

    // Use the accessibility aggregator to process data
    let aggregationResult;
    try {
      aggregationResult = await aggregateAccessibilityData(
        s3Client,
        bucketName,
        siteId,
        log,
        outputKey,
        `${AUDIT_TYPE_ACCESSIBILITY}-${deviceType}`,
        version,
      );

      if (!aggregationResult.success) {
        log.error(`[A11yAudit][A11yProcessingError] No data aggregated for ${deviceType} on site ${siteId} (${site.getBaseURL()}): ${aggregationResult.message}`);
        return {
          status: 'NO_OPPORTUNITIES',
          message: aggregationResult.message,
        };
      }
    } catch (error) {
      log.error(`[A11yAudit][A11yProcessingError] Error processing accessibility data for ${deviceType} on site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
      return {
        status: 'PROCESSING_FAILED',
        error: error.message,
      };
    }

    // change status to IGNORED for older opportunities for this device type
    await updateStatusToIgnored(dataAccess, siteId, log, deviceType);

    try {
      await generateReportOpportunities(
        site,
        aggregationResult,
        context,
        `${AUDIT_TYPE_ACCESSIBILITY}-${deviceType}`,
        deviceType,
      );
    } catch (error) {
      log.error(`[A11yAudit][A11yProcessingError] Error generating report opportunities for ${deviceType} on site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
      return {
        status: 'PROCESSING_FAILED',
        error: error.message,
      };
    }

    // Step 2c and Step 3: Skip for mobile audits as requested
    if (deviceType !== 'mobile') {
      // Step 2c: Create individual opportunities for the specific device
      try {
        await createAccessibilityIndividualOpportunities(
          aggregationResult.finalResultFiles.current,
          context,
        );
        log.debug(`[A11yAudit] Individual opportunities created successfully for ${deviceType} on site ${siteId} (${site.getBaseURL()})`);
      } catch (error) {
        log.error(`[A11yAudit][A11yProcessingError] Error creating individual opportunities for ${deviceType} on site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
        return {
          status: 'PROCESSING_FAILED',
          error: error.message,
        };
      }

      // step 3 save a11y metrics to s3 for this device type
      try {
        // Send message to importer-worker to save a11y metrics
        await sendRunImportMessage(
          sqs,
          env.IMPORT_WORKER_QUEUE_URL,
          `${A11Y_METRICS_AGGREGATOR_IMPORT_TYPE}_${deviceType}`,
          siteId,
          {
            scraperBucketName: env.S3_SCRAPER_BUCKET_NAME,
            importerBucketName: env.S3_IMPORTER_BUCKET_NAME,
            version,
            urlSourceSeparator: URL_SOURCE_SEPARATOR,
            totalChecks: WCAG_CRITERIA_COUNTS.TOTAL,
            deviceType,
            options: {},
          },
        );
        log.debug(`[A11yAudit] Sent message to importer-worker to save a11y metrics for ${deviceType} on site ${siteId}`);
      } catch (error) {
        log.error(`[A11yAudit][A11yProcessingError] Error sending message to importer-worker to save a11y metrics for ${deviceType} on site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
        return {
          status: 'PROCESSING_FAILED',
          error: error.message,
        };
      }
    } else {
      log.info(`[A11yAudit] Skipping individual opportunities (Step 2c) and metrics import (Step 3) for mobile audit on site ${siteId}`);
    }

    // Extract key metrics for the audit result summary, filtered by device type
    // Subtract 1 for the 'overall' key to get actual URL count
    const urlsProcessed = Object.keys(aggregationResult.finalResultFiles.current).length - 1;

    // Calculate device-specific metrics from the aggregated data
    let deviceSpecificIssues = 0;

    Object.entries(aggregationResult.finalResultFiles.current).forEach(([key, urlData]) => {
      if (key === 'overall' || !urlData.violations) return;

      ['critical', 'serious'].forEach((severity) => {
        if (urlData.violations[severity]?.items) {
          Object.values(urlData.violations[severity].items).forEach((rule) => {
            if (rule.htmlData) {
              rule.htmlData.forEach((htmlItem) => {
                if (htmlItem.deviceTypes?.includes(deviceType)) {
                  deviceSpecificIssues += 1;
                }
              });
            }
          });
        }
      });
    });

    log.info(`[A11yAudit] Found ${deviceSpecificIssues} ${deviceType} accessibility issues across ${urlsProcessed} unique URLs for site ${siteId} (${site.getBaseURL()})`);

    // Return the final audit result with device-specific metrics and status
    return {
      status: deviceSpecificIssues > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
      opportunitiesFound: deviceSpecificIssues,
      urlsProcessed,
      deviceType,
      summary: `Found ${deviceSpecificIssues} ${deviceType} accessibility issues across ${urlsProcessed} URLs`,
      fullReportUrl: outputKey, // Reference to the full report in S3
    };
  };
}

export default new AuditBuilder()
  .addStep(
    'processImport',
    processImportStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'scrapeAccessibilityData',
    scrapeAccessibilityData,
    AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER,
  )
  .addStep('processAccessibilityOpportunities', processAccessibilityOpportunities)
  .build();
