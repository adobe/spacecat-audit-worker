/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { validateUrls } from '../utils/seo-validators.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const AUDIT_TYPE = 'on-page-seo';

/**
 * Determines if a page is eligible for optimization based on SERP position.
 *
 * Business Rules:
 * - Positions 1-3: Exclude (already performing well)
 * - Positions 4-20: Include (sweet spot - low-hanging fruit)
 * - Positions 21-30: Secondary (softer range if < 3 opportunities)
 * - Positions 31+: Exclude (too difficult for quick wins)
 *
 * @param {number} serpPosition - Current SERP ranking position
 * @param {boolean} useSofterRange - Whether to include positions 21-30
 * @returns {boolean} Whether this position is eligible
 */
function isEligibleForOptimization(serpPosition, useSofterRange = false) {
  if (serpPosition >= 4 && serpPosition <= 20) {
    return true; // Primary range
  }
  if (useSofterRange && serpPosition >= 21 && serpPosition <= 30) {
    return true; // Secondary range (if needed)
  }
  return false; // Too high (1-3) or too low (31+)
}

/**
 * Gets the cluster total value for sorting.
 * This is the aggregate value calculated by Mystique for the entire keyword cluster.
 *
 * @param {object} item - URL mapping with keyword data
 * @returns {number} Cluster total value for prioritization
 */
function getClusterTotalValue(item) {
  // Mystique provides cluster_total_value (aggregate of all keywords in cluster)
  return item.cluster_total_value || item.clusterTotalValue || 0;
}

/**
 * Main handler - processes keyword clusters from Mystique
 * @param {object} message - SQS message from Mystique
 * @param {object} context - Audit context
 * @returns {Promise<object>} Handler result
 */
export async function processKeywordClusters(message, context) {
  const {
    log, dataAccess, sqs, env,
  } = context;
  const { data, siteId, auditId } = message;
  const { Suggestion } = dataAccess;

  const { clusters = [], mappings = [] } = data;

  if (!isNonEmptyArray(mappings)) {
    log.info(`[${AUDIT_TYPE}] No URL mappings provided. Site: ${siteId}`);
    return { status: 'complete' };
  }

  log.info(`[${AUDIT_TYPE}] Processing ${mappings.length} keyword mappings for site ${siteId}`);

  // Step 1: Filter eligible opportunities by SERP position (4-20)
  let eligibleOpportunities = mappings.filter((mapping) => {
    const serpPosition = mapping.serp_position || mapping.serpPosition || mapping.ranking || 99;
    return isEligibleForOptimization(serpPosition, false);
  });

  log.info(`[${AUDIT_TYPE}] Found ${eligibleOpportunities.length} opportunities in positions 4-20`);

  // Step 2: If fewer than 3, soften range to 4-30
  if (eligibleOpportunities.length < 3) {
    log.info(`[${AUDIT_TYPE}] Fewer than 3 opportunities found, softening range to positions 4-30`);
    eligibleOpportunities = mappings.filter((mapping) => {
      const serpPosition = mapping.serp_position || mapping.serpPosition || mapping.ranking || 99;
      return isEligibleForOptimization(serpPosition, true);
    });
    log.info(`[${AUDIT_TYPE}] Found ${eligibleOpportunities.length} opportunities in softened range (4-30)`);
  }

  // Step 3: Sort by cluster_total_value (descending) and select top 3
  const topOpportunities = eligibleOpportunities
    .sort((a, b) => getClusterTotalValue(b) - getClusterTotalValue(a))
    .slice(0, 3);
  const urls = topOpportunities.map((opp) => opp.url);

  log.info(`[${AUDIT_TYPE}] Selected top ${topOpportunities.length} URLs by cluster_total_value (positions 4-20/30)`);

  // Run technical validation
  const validationResults = await validateUrls(urls, context);

  // Separate clean URLs from blocked URLs
  const cleanUrls = validationResults.filter((r) => r.indexable);
  const blockedUrls = validationResults.filter((r) => !r.indexable);

  log.info(`[${AUDIT_TYPE}] Validation complete: ${cleanUrls.length} clean, ${blockedUrls.length} blocked`);

  // Create opportunity
  const site = await dataAccess.Site.findById(siteId);

  const opportunity = await convertToOpportunity(
    site.getBaseURL(),
    { siteId, id: auditId },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    {
      totalClusters: clusters.length,
      totalMappings: mappings.length,
      selectedOpportunities: topOpportunities.length,
      cleanUrls: cleanUrls.length,
      blockedUrls: blockedUrls.length,
      topOpportunity: topOpportunities[0], // Highest ranked opportunity for impact calculation
    },
  );

  // Create suggestions for BLOCKED URLs (with technical details)
  const requiresValidation = Boolean(context.site?.requiresValidation);

  for (const blockedResult of blockedUrls) {
    const originalMapping = topOpportunities.find((m) => m.url === blockedResult.url);

    // eslint-disable-next-line no-await-in-loop
    await Suggestion.create({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: getClusterTotalValue(originalMapping),
      status: requiresValidation ? 'PENDING_VALIDATION' : 'NEW',
      data: {
        url: blockedResult.url,
        keywords: originalMapping?.keywords || [],
        searchVolume: originalMapping?.searchVolume || 0,
        difficulty: originalMapping?.difficulty || 0,
        serpPosition: originalMapping?.serp_position
          || originalMapping?.serpPosition
          || originalMapping?.ranking
          || 0,
        clusterTotalValue: getClusterTotalValue(originalMapping),

        // Technical issue details
        requiresTechnicalFix: true,
        technicalIssues: blockedResult.blockers,
        checks: blockedResult.checks,
      },
    });
  }

  log.info(`[${AUDIT_TYPE}] Created ${blockedUrls.length} technical issue suggestions`);

  // Send CLEAN URLs to Mystique for content recommendations
  if (cleanUrls.length > 0) {
    const cleanMappings = topOpportunities.filter((m) => cleanUrls.some((c) => c.url === m.url));

    const messageToMystique = {
      type: 'guidance:on-page-seo',
      siteId,
      auditId,
      opportunityId: opportunity.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        urls: cleanMappings.map((m) => ({
          url: m.url,
          keywords: m.keywords,
          searchVolume: m.searchVolume,
          difficulty: m.difficulty,
          serpPosition: m.serp_position || m.serpPosition || m.ranking || 0,
          clusterTotalValue: getClusterTotalValue(m),
        })),
        clusters,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, messageToMystique);
    log.info(`[${AUDIT_TYPE}] Sent ${cleanUrls.length} clean URLs to Mystique for content recommendations`);
  } else {
    log.warn(`[${AUDIT_TYPE}] No clean URLs to send to Mystique - all URLs have technical issues`);
  }

  return { status: 'complete', opportunity };
}

/**
 * Default handler export
 * @param {object} message - SQS message
 * @param {object} context - Audit context
 * @returns {Promise<object>} Handler result
 */
export default async function handler(message, context) {
  return processKeywordClusters(message, context);
}
