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
 * @param {Array<string>} urls - The URLs of low-performing pages
 * @param {Object} audit - The audit object
 * @param {Object} pageGuidance - The parsed guidance object
 * @returns {Object} Opportunity entity
 */
export function mapToKeywordOptimizerOpportunity(siteId, urls, audit, pageGuidance) {
  const stats = audit.getAuditResult();
  const pageCount = urls.length;

  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: 'paid-keyword-optimizer',
    origin: 'AUTOMATION',
    title: 'Low-performing paid search pages detected',
    description: `Found ${pageCount} page${pageCount !== 1 ? 's' : ''} with predominantly paid search traffic and high bounce rates. `
      + `Average bounce rate: ${(stats.averageBounceRate * 100).toFixed(1)}%, `
      + `Total page views: ${formatNumberWithK(stats.totalPageViews)}.`,
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
      opportunityType: 'paid-keyword-optimizer',
      pages: urls,
      pageCount,
      totalPageViews: stats.totalPageViews,
      averageBounceRate: stats.averageBounceRate,
      temporalCondition: stats.temporalCondition,
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
 * @param {string} siteId - The site ID
 * @param {string} opportunityId - The opportunity ID
 * @param {Array<string>} urls - The URLs of low-performing pages
 * @param {Object} pageGuidance - The parsed guidance object
 * @returns {Object} Suggestion entity
 */
export function mapToKeywordOptimizerSuggestion(
  context,
  siteId,
  opportunityId,
  urls,
  pageGuidance = {},
) {
  return {
    opportunityId,
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: context.site?.requiresValidation
      ? SuggestionModel.STATUSES.PENDING_VALIDATION
      : SuggestionModel.STATUSES.NEW,
    data: {
      recommendations: urls.map((url) => ({
        id: randomUUID(),
        pageUrl: url,
      })),
      analysis: pageGuidance.body?.data?.analysis,
      impact: {
        business: pageGuidance.body?.data?.impact?.business,
        user: pageGuidance.body?.data?.impact?.user,
      },
    },
  };
}
