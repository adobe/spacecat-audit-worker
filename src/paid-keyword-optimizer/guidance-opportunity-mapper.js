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
 * @param {Object} body - The guidance body object
 * @returns {boolean} True if severity is low or none
 */
export function isLowSeverityGuidanceBody(body) {
  if (body && body.issueSeverity) {
    const sev = body.issueSeverity.toLowerCase();
    return sev.includes('none') || sev.includes('low');
  }

  return false;
}

/**
 * Maps audit data to a paid keyword optimizer opportunity entity
 * @param {string} siteId - The site ID
 * @param {Object} audit - The audit object
 * @param {Object} message - The message from Mystique with insight, rationale,
 *   recommendation, and body
 * @returns {Object} Opportunity entity
 */
export function mapToKeywordOptimizerOpportunity(siteId, audit, message) {
  const stats = audit.getAuditResult();
  const {
    insight, rationale, recommendation, body,
  } = message;
  const url = body?.data?.url;
  const cpc = body?.data?.cpc;
  const sumTraffic = body?.data?.sum_traffic;

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
 * Maps guidance data to a paid keyword optimizer suggestion entity
 * @param {Object} context - The execution context
 * @param {string} opportunityId - The opportunity ID
 * @param {Object} message - The message from Mystique with body.data.suggestions
 * @returns {Object} Suggestion entity
 */
export function mapToKeywordOptimizerSuggestion(
  context,
  opportunityId,
  message = {},
) {
  const variations = message.body?.data?.suggestions || [];

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
