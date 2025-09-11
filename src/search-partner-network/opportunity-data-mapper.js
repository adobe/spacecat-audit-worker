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

import { DATA_SOURCES } from '../common/constants.js';

const ESTIMATED_CPC = 0.80;

function formatNumberWithK(num) {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

export function createOpportunityData(auditUrl, auditData) {
  const { auditResult } = auditData;
  const { details } = auditResult;
  const projectedTrafficValue = details.highBounceRatePageviews * ESTIMATED_CPC;

  return {
    origin: 'AUTOMATION',
    title: 'High bounce rate detected on Search Partner Network traffic',
    description: `Search Partner Network is generating traffic with high bounce rates. ${details.highBounceRatePages} pages have bounce rates ≥70%, affecting ${details.impactPercentage.toFixed(1)}% of syndicate pageviews (${formatNumberWithK(details.highBounceRatePageviews)} pageviews).`,
    guidance: {
      steps: [
        'Review Search Partner Network settings in Google Ads',
        'Analyze top affected pages for UX issues',
        'Consider disabling Search Partner Network if bounce rates remain high',
        'Monitor performance after changes',
      ],
    },
    tags: ['Engagement', 'Paid Traffic'],
    data: {
      dataSources: [
        DATA_SOURCES.SITE,
        DATA_SOURCES.RUM,
      ],
      projectedTrafficLost: details.highBounceRatePageviews,
      projectedTrafficValue,
      opportunityType: 'search-partner-network',
      totalPages: details.totalPages,
      highBounceRatePages: details.highBounceRatePages,
      averageBounceRate: details.averageBounceRate,
      impactPercentage: details.impactPercentage,
      topAffectedPages: details.topHighBounceRatePages,
    },
  };
}
