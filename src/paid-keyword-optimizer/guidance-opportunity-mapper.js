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
import { DATA_SOURCES } from '../common/constants.js';

/**
 * Formats a number with K suffix for thousands
 * @param {number} num - The number to format
 * @returns {string} Formatted number string
 */
function formatNumberWithK(num) {
  if (num == null || num === undefined) {
    return '0';
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Checks if the guidance body indicates a low severity issue
 * @param {Object} guidanceBody - The guidance body object (guidance[0].body)
 * @returns {boolean} True if severity is low or none
 */
export function isLowSeverityGuidanceBody(guidanceBody) {
  if (guidanceBody && guidanceBody.issueSeverity) {
    const sev = guidanceBody.issueSeverity.toLowerCase();
    return sev.includes('none') || sev.includes('low');
  }

  return false;
}

/**
 * Maps audit data to an ad-intent-mismatch opportunity entity.
 *
 * Reads guidance data from message.data.guidance[0] (GuidanceWithBody pattern).
 * The guidance entry contains insight/rationale/recommendation at top level,
 * and cpc/sumTraffic/url/issueSeverity in its body dict.
 *
 * @param {string} siteId - The site ID
 * @param {Object} audit - The audit object
 * @param {Object} message - The SQS message from mystique
 * @returns {Object} Opportunity entity
 */
export function mapToKeywordOptimizerOpportunity(siteId, audit, message) {
  const stats = audit.getAuditResult();
  const { guidance } = message.data;
  const guidanceEntry = guidance?.[0] || {};
  const {
    insight, rationale, recommendation, body,
  } = guidanceEntry;
  const url = body?.url;
  const cpc = body?.cpc;
  const sumTraffic = body?.sumTraffic;

  // Look up per-page data from predominantlyPaidPages
  const paidPages = stats.predominantlyPaidPages || [];
  const pageData = paidPages.find((p) => p.url === url) || {};
  const pageBounceRate = pageData.bounceRate ?? 0;
  const pageViews = pageData.pageViews ?? 0;
  const avgBounceRate = stats.averageBounceRate ?? 0;
  const impact = pageBounceRate > avgBounceRate
    ? (pageBounceRate - avgBounceRate) * pageViews
    : pageViews;

  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: 'ad-intent-mismatch',
    origin: 'AUTOMATION',
    title: 'Low-performing paid search page detected',
    description: 'Page with predominantly paid search traffic and high bounce rate. '
      + `Average bounce rate: ${(stats.averageBounceRate * 100).toFixed(1)}%, `
      + `Total page views: ${formatNumberWithK(stats.totalPageViews)}.`,
    guidance: {
      recommendations: [
        {
          insight,
          rationale,
          recommendation,
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
      url,
      page: url,
      cpc,
      sumTraffic,
      totalPageViews: stats.totalPageViews,
      averageBounceRate: stats.averageBounceRate,
      temporalCondition: stats.temporalCondition,
      pageViews,
      trackedPageKPIName: 'Bounce Rate',
      trackedPageKPIValue: pageBounceRate,
      trackedKPISiteAverage: avgBounceRate,
      opportunityImpact: impact,
      metrics: [],
      samples: 0,
    },
    status: 'NEW',
    tags: [
      'Paid',
      'SEO',
    ],
  };
}

/**
 * Maps guidance data to an ad-intent-mismatch suggestion entity.
 *
 * Reads variation data from message.data.guidance[0].body.suggestions.
 *
 * @param {Object} context - The execution context
 * @param {string} opportunityId - The opportunity ID
 * @param {Object} message - The SQS message from mystique
 * @returns {Object} Suggestion entity
 */
export function mapToKeywordOptimizerSuggestion(
  context,
  opportunityId,
  message = {},
) {
  const { guidance } = message.data || {};
  const variations = guidance?.[0]?.body?.suggestions || [];

  return {
    opportunityId,
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: context.site?.requiresValidation
      ? SuggestionModel.STATUSES.PENDING_VALIDATION
      : SuggestionModel.STATUSES.NEW,
    data: {
      variations,
      kpiDeltas: { estimatedKPILift: 0 },
    },
  };
}
