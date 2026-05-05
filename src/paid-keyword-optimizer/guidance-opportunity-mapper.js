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
 * Formats a currency value with $ prefix and K suffix for thousands.
 * @param {number} num - The number to format
 * @returns {string} Formatted currency string (e.g., "$1.2K", "$500")
 */
function formatCurrency(num) {
  /* c8 ignore next 3 -- defensive guard; reduce() always yields a number */
  if (num == null) {
    return '$0';
  }
  if (num >= 1000) {
    return `$${(num / 1000).toFixed(1)}K`;
  }
  return `$${Math.round(num)}`;
}

/**
 * Assigns composite ranks to cluster results based on tiered ordering:
 * - Tier 0: Mismatched (has recommendation, analysisStatus ok) by misaligned spend desc
 * - Tier 1: Aligned (no recommendation, analysisStatus ok) by cluster traffic desc
 * - Tier 2: Failed (analysisStatus failed) by cluster traffic desc
 *
 * @param {Array} clusterResults - Array of cluster result objects
 * @returns {Array} Clusters with rank field added, ordered by composite rank
 */
export function assignClusterRanks(clusterResults) {
  if (!clusterResults || clusterResults.length === 0) {
    return [];
  }

  const isMismatched = (c) => c.analysisStatus !== 'failed' && c.recommendation;
  const isAligned = (c) => c.analysisStatus !== 'failed' && !c.recommendation;
  const isFailed = (c) => c.analysisStatus === 'failed';

  const tier0 = clusterResults
    .filter(isMismatched)
    .sort((a, b) => (b.clusterMisalignedSpend || 0) - (a.clusterMisalignedSpend || 0));

  const tier1 = clusterResults
    .filter(isAligned)
    .sort((a, b) => (b.clusterTraffic || 0) - (a.clusterTraffic || 0));

  const tier2 = clusterResults
    .filter(isFailed)
    .sort((a, b) => (b.clusterTraffic || 0) - (a.clusterTraffic || 0));

  const ordered = [...tier0, ...tier1, ...tier2];
  return ordered.map((cluster, index) => ({ ...cluster, rank: index + 1 }));
}

/**
 * Maps audit data to an ad-intent-mismatch opportunity entity for the
 * cluster-based format. One opportunity per URL.
 *
 * @param {string} siteId - The site ID
 * @param {Object} audit - The audit object
 * @param {Object} message - The SQS message from mystique
 * @returns {Object} Opportunity entity
 */
export function mapToKeywordOptimizerOpportunity(siteId, audit, message) {
  const { guidance } = message.data;
  const guidanceBody = guidance?.[0]?.body || {};
  const url = message.data?.url;
  const {
    clusterResults = [],
    portfolioMetrics = {},
  } = guidanceBody;
  const { langfuseTraceId, langfuseTraceUrl } = guidanceBody?.observability || {};

  const hasConflictingHeadlineRecommendations = clusterResults.filter(
    (cr) => cr.recommendation?.type === 'modify_heading',
  ).length > 1;

  const totalClusters = clusterResults.length;
  const misalignedClusters = clusterResults.filter(
    (c) => c.analysisStatus !== 'failed' && c.recommendation,
  ).length;
  const totalMisalignedSpend = clusterResults.reduce(
    (sum, c) => sum + (c.clusterMisalignedSpend || 0),
    0,
  );

  const description = 'Multiple keyword intent groups target this page. '
    + `${misalignedClusters} of ${totalClusters} clusters show alignment gaps. `
    + `Estimated misaligned spend: ~${formatCurrency(totalMisalignedSpend)}/month (based on Semrush data).`;

  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: 'ad-intent-mismatch',
    origin: 'AUTOMATION',
    title: 'Ad intent mismatch detected across keyword clusters',
    description,
    guidance: {},
    data: {
      dataSources: [
        DATA_SOURCES.SITE,
        DATA_SOURCES.RUM,
        DATA_SOURCES.PAGE,
        DATA_SOURCES.SEO,
      ],
      url,
      page: url,
      portfolioMetrics,
      hasConflictingHeadlineRecommendations,
      langfuseTraceId,
      langfuseTraceUrl,
      totalClusters,
      misalignedClusters,
      totalMisalignedSpend,
    },
    status: 'NEW',
    tags: [
      'Paid',
      'SEO',
    ],
  };
}

/**
 * Maps a single cluster to a suggestion entity.
 * Lifts recommendation.type to recommendationType (sibling field)
 * and removes type from the nested recommendation object.
 *
 * @param {Object} context - The execution context
 * @param {string} opportunityId - The opportunity ID
 * @param {Object} cluster - Cluster data with rank assigned
 * @returns {Object} Suggestion entity
 */
export function mapClusterToSuggestion(context, opportunityId, cluster) {
  const {
    clusterId,
    representativeKeyword,
    serpTitle,
    keywords,
    clusterTraffic,
    clusterCpc,
    clusterMisalignedSpend,
    analysisStatus,
    gapAnalysis,
    overallAlignmentScore,
    keywordAnalysis,
    recommendation,
    rank,
  } = cluster;

  // Lift recommendation.type to recommendationType and remove it from nested object
  let recommendationType;
  let cleanedRecommendation;
  if (recommendation) {
    const { type: recType, ...rest } = recommendation;
    recommendationType = recType;
    cleanedRecommendation = rest;
  }

  return {
    opportunityId,
    type: 'CONTENT_UPDATE',
    rank,
    status: context.site?.requiresValidation
      ? SuggestionModel.STATUSES.PENDING_VALIDATION
      : SuggestionModel.STATUSES.NEW,
    data: {
      cluster: {
        clusterId,
        representativeKeyword,
        serpTitle,
        keywords: keywords || [],
        clusterTraffic: clusterTraffic || 0,
        clusterCpc: clusterCpc ?? null,
        clusterMisalignedSpend: clusterMisalignedSpend ?? null,
        analysisStatus: analysisStatus || 'unknown',
        gapAnalysis: gapAnalysis || {},
        overallAlignmentScore: overallAlignmentScore || null,
        keywordAnalysis: keywordAnalysis || [],
      },
      ...(recommendationType && { recommendationType }),
      ...(cleanedRecommendation && { recommendation: cleanedRecommendation }),
    },
  };
}
