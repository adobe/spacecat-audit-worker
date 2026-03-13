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

import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { AUDIT_TYPE, OPPORTUNITY_TITLES } from './constants.js';

/**
 * Post-processor that creates/updates the opportunity and syncs suggestions.
 * Matches existing opportunities by title so mobile and desktop remain separate.
 */
export default async function opportunityHandler(finalUrl, auditData, context) {
  const { auditResult } = auditData;
  const { deviceType } = auditResult.metadata;

  const expectedTitle = OPPORTUNITY_TITLES[deviceType] || OPPORTUNITY_TITLES.mobile;
  const comparisonFn = (oppty) => oppty.getTitle() === expectedTitle;

  const opportunity = await convertToOpportunity(
    finalUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    { deviceType },
    comparisonFn,
  );

  await syncSuggestions({
    opportunity,
    newData: auditResult.urlDetails,
    context,
    buildKey: (data) => data.url,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: entry.pageviews,
      data: { ...entry },
    }),
  });

  return auditData;
}
