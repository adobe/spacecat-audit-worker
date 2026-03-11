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

import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { AUDIT_TYPE } from './constants.js';

/**
 * Post-processor that creates/updates the opportunity and syncs suggestions.
 * The opportunity title is determined by the deviceType in the audit result.
 */
export default async function opportunityHandler(finalUrl, auditData, context) {
  const { auditResult } = auditData;
  const { deviceType } = auditResult.metadata;

  const opportunity = await convertToOpportunity(
    finalUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    { deviceType },
  );

  await syncSuggestions({
    opportunity,
    newData: auditResult.urlDetails,
    context,
    buildKey: (data) => data.url,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: entry.pageviews,
      data: { ...entry },
    }),
  });

  return auditData;
}
