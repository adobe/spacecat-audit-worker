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

import { DATA_SOURCES } from '../common/constants.js';

/**
 * Calculates opportunity impact based on search volume and ranking potential
 * Formula: searchVolume * (current_position_ctr - target_position_ctr) * potential_improvement
 * @param {number} searchVolume - Monthly search volume for the keyword
 * @param {number} currentRanking - Current SERP position (1-20+)
 * @param {number} difficulty - Keyword difficulty (0-100)
 * @returns {number} Estimated traffic gain from optimization
 */
function calculateOpportunityImpact(searchVolume, currentRanking, difficulty) {
  // Simplified CTR by position (approximate industry averages)
  const ctrByPosition = {
    1: 0.32,
    2: 0.24,
    3: 0.18,
    4: 0.13,
    5: 0.10,
    6: 0.08,
    7: 0.06,
    8: 0.05,
    9: 0.04,
    10: 0.03,
  };

  const currentCTR = ctrByPosition[currentRanking] || 0.02;
  const targetPosition = Math.max(1, currentRanking - 3); // Aim to improve by ~3 positions
  const targetCTR = ctrByPosition[targetPosition] || 0.32;

  // Difficulty penalty: harder keywords have less improvement potential
  const improvementFactor = (100 - difficulty) / 100;

  return Math.round(searchVolume * (targetCTR - currentCTR) * improvementFactor);
}

/**
 * Creates opportunity data structure for on-page-seo opportunities
 * @param {string} auditUrl - The base URL that was audited
 * @param {object} auditData - Audit data containing siteId and audit ID
 * @param {object} context - Audit context
 * @param {string} type - Audit type
 * @param {object} props - Additional properties for opportunity creation
 * @returns {object} Formatted opportunity data for DynamoDB
 */
export function createOpportunityData(auditUrl, auditData, context, type, props = {}) {
  const {
    totalClusters,
    totalMappings,
    selectedOpportunities,
    cleanUrls,
    blockedUrls,
    topOpportunity, // The highest-impact opportunity for calculating overall impact
  } = props;

  // Calculate overall opportunity impact from the top opportunity
  const opportunityImpact = topOpportunity
    ? calculateOpportunityImpact(
      topOpportunity.searchVolume || 0,
      topOpportunity.ranking || 20,
      topOpportunity.difficulty || 50,
    )
    : 0;

  return {
    type: 'on-page-seo',
    title: 'On-Page SEO Content Optimization',
    description: `${selectedOpportunities} high-impact keyword opportunities identified. Optimize content for better search rankings and organic traffic.`,
    origin: 'AI',
    status: 'NEW',
    guidance: {
      recommendations: [], // Will be populated by guidance handler
    },
    data: {
      totalClusters,
      totalMappings,
      selectedOpportunities,
      cleanUrls,
      blockedUrls,
      opportunityImpact,
      dataSources: [DATA_SOURCES.SITE, DATA_SOURCES.AHREFS], // Mystique uses Ahrefs data
    },
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/SpaceCat/Shared%20Documents/runbooks/on-page-seo.docx',
    tags: ['SEO', 'Content', 'Keywords'],
  };
}
