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
import { AuditBuilder } from '../../common/audit-builder.js';
import { convertToOpportunity } from '../../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../../utils/data-access.js';
import { analyzePageReadability, sendReadabilityToMystique } from '../shared/analysis-utils.js';
import {
  READABILITY_OPPORTUNITY_TYPE,
  TOP_PAGES_LIMIT,
} from '../shared/constants.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
// Use existing audit type or create new one if needed
const AUDIT_TYPE_READABILITY = Audit.AUDIT_TYPES.READABILITY || 'readability';

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

// First step: sends a message to the content scraper to get page content for readability analysis
export async function scrapeReadabilityData(context) {
  const {
    site, log, finalUrl, env, dataAccess,
  } = context;
  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for readability audit';
    log.error(`[ReadabilityProcessingError] ${errorMsg}`);
    return {
      status: 'PROCESSING_FAILED',
      error: errorMsg,
    };
  }

  log.info(`[ReadabilityAudit] Step 1: Preparing content scrape for readability audit for ${site.getBaseURL()} with siteId ${siteId}`);

  // Get top pages for readability analysis
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  log.info(`[ReadabilityAudit] Found ${topPages?.length || 0} top pages for site ${site.getBaseURL()}`);

  if (!isNonEmptyArray(topPages)) {
    log.info(`[ReadabilityAudit] No top pages found for site ${siteId} (${site.getBaseURL()}), skipping audit`);
    return {
      status: 'NO_OPPORTUNITIES',
      message: 'No top pages found, skipping audit',
    };
  }

  // Take top pages by traffic, sorted descending
  const urlsToScrape = topPages
    .map((page) => ({ url: page.getUrl(), traffic: page.getTraffic(), urlId: page.getId() }))
    .sort((a, b) => b.traffic - a.traffic)
    .slice(0, TOP_PAGES_LIMIT);

  log.info(`[ReadabilityAudit] Top ${TOP_PAGES_LIMIT} pages for site ${siteId} (${site.getBaseURL()}): ${JSON.stringify(urlsToScrape, null, 2)}`);

  return {
    auditResult: {
      status: 'SCRAPING_REQUESTED',
      message: 'Content scraping for readability audit initiated.',
      scrapedUrls: urlsToScrape,
    },
    fullAuditRef: finalUrl,
    // Data for the CONTENT_SCRAPER
    urls: urlsToScrape,
    siteId,
    jobId: siteId,
    processingType: 'default',
  };
}

// Second step: processes scraped data to create readability opportunities
export async function processReadabilityOpportunities(context) {
  const {
    site, log, s3Client, env, audit,
  } = context;
  const siteId = site.getId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for readability audit';
    log.error(`[ReadabilityProcessingError] ${errorMsg}`);
    return {
      status: 'PROCESSING_FAILED',
      error: errorMsg,
    };
  }

  log.info(`[ReadabilityAudit] Step 2: Processing scraped data for readability analysis for site ${siteId} (${site.getBaseURL()})`);

  try {
    // Analyze readability for all scraped pages
    const readabilityAnalysisResult = await analyzePageReadability(
      s3Client,
      bucketName,
      siteId,
      log,
    );

    if (!readabilityAnalysisResult.success) {
      log.error(`[ReadabilityAudit][ReadabilityProcessingError] No readability issues found for site ${siteId} (${site.getBaseURL()}): ${readabilityAnalysisResult.message}`);
      return {
        status: 'NO_OPPORTUNITIES',
        message: readabilityAnalysisResult.message,
      };
    }

    const { readabilityIssues, urlsProcessed } = readabilityAnalysisResult;

    // Create opportunity and suggestions
    const opportunity = await convertToOpportunity(
      site.getBaseURL(),
      { siteId, id: audit.getId() },
      context,
      createOpportunityData,
      AUDIT_TYPE_READABILITY,
      {
        totalIssues: readabilityIssues.length,
        urlsProcessed,
      },
    );

    // Prepare suggestions data for database
    const suggestions = readabilityIssues.map((issue, index) => ({
      opportunityId: opportunity.getId(),
      type: READABILITY_OPPORTUNITY_TYPE,
      rank: issue.rank, // Use the rank already calculated in analysis
      data: {
        id: `readability-${siteId}-${index}`,
        pageUrl: issue.pageUrl,
        textPreview: issue.textContent?.substring(0, 500),
        fleschReadingEase: issue.fleschReadingEase,
        language: issue.language,
        category: issue.category,
        seoImpact: issue.seoImpact,
        seoRecommendation: issue.seoRecommendation,
        traffic: issue.traffic,
      },
    }));

    // Sync suggestions with existing ones (preserve ignored/fixed suggestions)
    const buildKey = (data) => `${data.pageUrl}|${data.textPreview?.substring(0, 500)}`;

    await syncSuggestions({
      opportunity,
      newData: suggestions,
      context,
      buildKey,
      mapNewSuggestion: (suggestion) => suggestion,
    });

    // Send to Mystique for AI-powered readability improvements
    if (readabilityIssues.length > 0) {
      try {
        await sendReadabilityToMystique(
          site.getBaseURL(),
          readabilityIssues,
          siteId,
          audit.getId(),
          context,
          'opportunity',
        );
        log.info(`[ReadabilityAudit] Successfully sent ${readabilityIssues.length} readability issues to Mystique for AI processing`);
      } catch (error) {
        log.error(`[ReadabilityAudit][ReadabilityProcessingError] Error sending readability issues to Mystique: ${error.message}`, error);
        // Continue without failing - the opportunity is still valid without AI suggestions
      }
    }

    log.info(`[ReadabilityAudit] Found ${readabilityIssues.length} readability issues across ${urlsProcessed} URLs for site ${siteId} (${site.getBaseURL()})`);

    return {
      status: readabilityIssues.length > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
      opportunitiesFound: readabilityIssues.length,
      urlsProcessed,
      summary: `Found ${readabilityIssues.length} readability issues across ${urlsProcessed} URLs`,
    };
  } catch (error) {
    log.error(`[ReadabilityAudit][ReadabilityProcessingError] Error processing readability data for site ${siteId} (${site.getBaseURL()}): ${error.message}`, error);
    return {
      status: 'PROCESSING_FAILED',
      error: error.message,
    };
  }
}

export default new AuditBuilder()
  .addStep(
    'processImport',
    processImportStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'scrapeReadabilityData',
    scrapeReadabilityData,
    AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER,
  )
  .addStep('processReadabilityOpportunities', processReadabilityOpportunities)
  .build();
