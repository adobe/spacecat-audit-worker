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
import { DATA_SOURCES } from '../common/constants.js';

// const ESTIMATED_CPC = 0.80;

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
  const result = scrapeResults[0];
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
  /*
      projectedTrafficLost,
      projectedTrafficValue,
      top3Pages: top3Pages.map((item) => item.path),
      averagePageViewsTop3,
      averageTrafficLostTop3,
      averageBounceRateMobileTop3,
      temporalCondition,
  */

  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: 'generic-opportunity',
    origin: 'AUTOMATION',
    title: 'Consent Banner covers essential page content',
    description: `The consent banner hides essential page content, resulting in a critical mobile bounce rate. Pages like the following recorded in average ${formatNumberWithK(stats.averagePageViewsTop3)} visits but lost ${formatNumberWithK(stats.averageTrafficLostTop3)} potential customers immediately.`,
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
      projectedTrafficLost: stats.projectedTrafficLost,
      projectedTrafficValue: stats.projectedTrafficValue,
      opportunityType: 'paid-cookie-consent',
      page: url,
      pageViews: stats.totalPageViews,
      ctr: 0,
      bounceRate: stats.totalAverageBounceRate,
      pageType: 'unknown',
      temporalCondition: stats.temporalCondition,
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
