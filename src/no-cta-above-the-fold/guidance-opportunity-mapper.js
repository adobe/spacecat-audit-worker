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
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';

export const ESTIMATED_CPC = 0.8;

function sanitizeMarkdown(markdown) {
  if (markdown === null || markdown === undefined) {
    return '';
  }
  if (typeof markdown !== 'string') {
    return String(markdown);
  }

  if (markdown.includes('\\n')) {
    return markdown.replace(/\\n/g, '\n');
  }
  return markdown;
}

export function mapToOpportunity(siteId, url, audit, pageGuidance) {
  if (!pageGuidance) {
    return null;
  }
  const stats = audit.getAuditResult();
  const urlPath = new URL(url).pathname;
  const pageData = stats.find((item) => item.path === urlPath) || {};
  const pageViews = Number(pageData.pageviews ?? 0);
  const bounceRate = Number(pageData.bounce_rate ?? 0);
  const projectedTrafficLost = Number(pageData.projected_traffic_lost ?? 0);
  const projectedTrafficValue = Number(
    pageData.projected_traffic_value ?? projectedTrafficLost * ESTIMATED_CPC,
  );

  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: 'generic-opportunity',
    origin: 'AUTOMATION',
    title: 'No engageable content above the fold on mobile',
    description: 'The page lacks clear call-to-action (CTA) buttons above the fold. Without a prominent CTA to catch paid visitors\' attention, they are much more likely to bounce.',
    guidance: {
      recommendations: [
        {
          insight: pageGuidance?.insight,
          rationale: pageGuidance?.rationale,
          recommendation: pageGuidance?.recommendation,
          type: 'guidance',
        },
      ],
    },
    data: {
      projectedTrafficLost,
      projectedTrafficValue,
      opportunityType: 'no-cta-above-the-fold',
      page: url,
      pageViews,
      ctr: 0,
      bounceRate,
      pageType: 'unknown',
    },
    status: 'NEW',
    tags: [],
  };
}

export async function mapToSuggestion(
  context,
  opportunityId,
  url,
  pageGuidance = [],
) {
  const markdown = pageGuidance?.body?.markdown;
  const requiresValidation = Boolean(context?.site?.requiresValidation);

  return {
    opportunityId,
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: requiresValidation
      ? SuggestionModel.STATUSES.PENDING_VALIDATION
      : SuggestionModel.STATUSES.NEW,
    data: {
      recommendations: [
        {
          id: randomUUID(),
          pageUrl: url,
        },
      ],
      suggestionValue: `${sanitizeMarkdown(markdown)}`,
    },
  };
}
