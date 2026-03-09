/*
 * Copyright 2024 Adobe. All rights reserved.
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
import { createOpportunityData, compareOpportunityByDevice } from './opportunity-data-mapper.js';
import { AUDIT_TYPE } from './constants.js';

/**
 * Synchronizes opportunities and suggestions for CWV Trends Audit
 * Creates or updates device-specific opportunity and syncs suggestions
 * @param {object} context - Context object containing site, audit, finalUrl, log, dataAccess
 * @returns {Promise<object>} The created or updated opportunity object
 */
export async function syncOpportunitiesAndSuggestions(context) {
  const { site, audit, finalUrl } = context;

  const auditResult = audit.getAuditResult();

  // Build minimal audit data object for opportunity creation
  const auditData = {
    siteId: site.getId(),
    id: audit.getId(),
    auditResult,
  };

  // Create/update opportunity with device-specific matching
  const opportunity = await convertToOpportunity(
    finalUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    auditResult, // Pass full audit result as props
    compareOpportunityByDevice, // Custom comparison function
  );

  // Sync suggestions (one per URL in urlDetails)
  const buildKey = (data) => data.url;

  await syncSuggestions({
    opportunity,
    newData: auditResult.urlDetails,
    context,
    buildKey,
    mapNewSuggestion: (urlEntry) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: urlEntry.pageviews, // Rank by pageviews
      data: {
        ...urlEntry,
      },
    }),
  });

  return opportunity;
}
