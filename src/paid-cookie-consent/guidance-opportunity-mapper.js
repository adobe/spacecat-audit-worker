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

import { randomUUID } from 'crypto';
import { ScrapeClient } from '@adobe/spacecat-shared-scrape-client';
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DATA_SOURCES } from '../common/constants.js';

const ESTIMATED_CPC = 0.80;

function formatNumberWithK(num) {
  if (num == null || num === undefined) {
    return '0';
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function sanitizeMarkdown(markdown) {
  if (typeof markdown === 'string' && markdown.includes('\\n')) {
    return markdown.replace(/\\n/g, '\n');
  }
  return markdown;
}

/**
 * Copy suggested screenshots from mystique bucket to scrapper bucket
 * @param {Object} context - The context object
 * @param {string} jobId - The scrape job ID
 * @param {string} resultPath - The scrape result path to determine destination
 */
async function copySuggestedScreenshots(context, jobId, resultPath) {
  const { log, s3Client } = context;

  const mystiqueBucket = context.env?.S3_MYSTIQUE_BUCKET_NAME;
  const scraperBucket = context.env?.S3_SCRAPER_BUCKET_NAME;

  if (!mystiqueBucket || !scraperBucket) {
    log.warn('[paid-cookie-consent] S3 bucket configuration missing, skipping screenshot copying');
    return;
  }

  const screenshots = ['mobile-suggested.png', 'desktop-suggested.png'];

  // Use Promise.all to copy both files in parallel
  await Promise.all(screenshots.map(async (screenshot) => {
    const sourceKey = `temp/consent-banner/${jobId}/${screenshot}`;
    // Use the same path structure as scrape results
    const destinationKey = resultPath.replace('scrape.json', screenshot);

    try {
      // Check if the file exists in mystique bucket
      await s3Client.send(new HeadObjectCommand({
        Bucket: mystiqueBucket,
        Key: sourceKey,
      }));

      // Copy the file to scrapper bucket
      await s3Client.send(new CopyObjectCommand({
        CopySource: `${mystiqueBucket}/${sourceKey}`,
        Bucket: scraperBucket,
        Key: destinationKey,
      }));

      log.debug(`[paid-cookie-consent] Successfully copied ${screenshot} from mystique to scrapper bucket`);
    } catch (error) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        log.warn(`[paid-cookie-consent] Suggested screenshot ${screenshot} not found in mystique bucket, skipping`);
      } else {
        log.error(`[paid-cookie-consent] Error copying suggested screenshot ${screenshot}: ${error.message}`);
      }
    }
  }));
}

async function addScreenshots(context, siteId, markdown, jobId) {
  const fileVariants = [
    { key: 'DESKTOP_BANNER_ON_URL', variant: 'screenshot-desktop-viewport-withBanner' },
    { key: 'DESKTOP_BANNER_OFF_URL', variant: 'screenshot-desktop-viewport-withoutBanner' },
    { key: 'MOBILE_BANNER_ON_URL', variant: 'screenshot-iphone-13-viewport-withBanner' },
    { key: 'MOBILE_BANNER_OFF_URL', variant: 'screenshot-iphone-13-viewport-withoutBanner' },
    { key: 'MOBILE_BANNER_SUGGESTION', variant: 'mobile-suggested' },
    { key: 'DESKTOP_BANNER_SUGGESTION', variant: 'desktop-suggested' },
  ];

  const scrapeClient = ScrapeClient.createFrom(context);
  const scrapeResults = await scrapeClient.getScrapeJobUrlResults(jobId);
  const result = scrapeResults?.[0];

  // Copy suggested screenshots from mystique to scrapper bucket before processing
  await copySuggestedScreenshots(context, jobId, result.path);

  let markdownWithScreenshots = markdown;

  const apiBase = context.env?.SPACECAT_API_URI || 'https://spacecat.experiencecloud.live/api/v1';
  fileVariants.forEach((fileVariant) => {
    const imageKey = result.path.replace('scrape.json', `${fileVariant.variant}.png`);
    const screenshotGenPreSignedUrlPath = `${apiBase}/sites/${siteId}/files?key=${imageKey}`;
    markdownWithScreenshots = markdownWithScreenshots
      .replace(fileVariant.key, screenshotGenPreSignedUrlPath);
  });

  return `${sanitizeMarkdown(markdownWithScreenshots)}`;
}

export function isLowSeverityGuidanceBody(body) {
  if (body.issueSeverity) {
    const sev = body.issueSeverity.toLowerCase();
    return sev.includes('none') || sev.includes('low');
  }

  return false;
}

export function mapToPaidOpportunity(siteId, url, audit, pageGuidance) {
  // Get the data from urlConsent segment and filter for 'show' consent
  const stats = audit.getAuditResult();
  const urlConsentSegment = stats.find((item) => item.key === 'urlConsent');
  const pagesWithConsent = urlConsentSegment?.value?.filter((item) => item.consent === 'show') || [];

  // Get individual page data for the specific URL
  const pageData = pagesWithConsent.find((item) => item.url === url) || {};
  const { pageViews } = pageData;
  const { bounceRate } = pageData;
  const { projectedTrafficLost } = pageData;

  // Aggregate data across all pages with consent='show'
  const pageViewsSum = pagesWithConsent.reduce((sum, page) => sum
  + page.pageViews, 0);
  const projectedTrafficLossSum = pagesWithConsent.reduce((sum, page) => {
    const pageTrafficLoss = page.projectedTrafficLost;
    return sum + pageTrafficLoss;
  }, 0);

  // Calculate total aggregate bounce rate
  const totalAggBounceRate = pageViewsSum > 0 ? projectedTrafficLossSum / pageViewsSum : 0;

  const projectedTrafficValue = projectedTrafficLossSum * ESTIMATED_CPC;

  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: 'generic-opportunity',
    origin: 'AUTOMATION',
    title: 'Consent Banner covers essential page content',
    description: `The consent banner hides essential page content. ${(totalAggBounceRate * 100).toFixed(1)}% of total paid traffic (${formatNumberWithK(projectedTrafficLossSum)}) bounces on consent banner without interaction. Most affected page: ${url} (${formatNumberWithK(projectedTrafficLost)})`,
    guidance: {
      recommendations: [
        {
          insight: pageGuidance.insight,
          rationale: pageGuidance.rationale,
          recommendation: pageGuidance.recommendation,
          type: 'guidance',
        },
      ],
    },
    data: {
      dataSources: [
        DATA_SOURCES.SITE,
        DATA_SOURCES.RUM,
        DATA_SOURCES.PAGE,
      ],
      projectedTrafficLost: projectedTrafficLossSum,
      projectedTrafficValue,
      opportunityType: 'paid-cookie-consent',
      page: url,
      pageViews,
      ctr: 0,
      bounceRate,
      pageType: 'unknown',
    },
    status: 'NEW',
    tags: [
      'Engagement',
    ],
  };
}

export async function mapToPaidSuggestion(context, siteId, opportunityId, url, pageGuidance = []) {
  return {
    opportunityId,
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: context.site?.requiresValidation ? SuggestionModel.STATUSES.PENDING_VALIDATION
      : SuggestionModel.STATUSES.NEW,
    data: {
      recommendations: [
        {
          id: randomUUID(),
          pageUrl: url,
        },
      ],
      mobile: await addScreenshots(
        context,
        siteId,
        pageGuidance.body.data?.mobile,
        pageGuidance.metadata.scrape_job_id,
      ),
      desktop: await addScreenshots(
        context,
        siteId,
        pageGuidance.body.data?.desktop,
        pageGuidance.metadata.scrape_job_id,
      ),
      impact: {
        business: pageGuidance.body.data?.impact?.business,
        user: pageGuidance.body.data?.impact?.user,
      },
    },
  };
}
