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

import { Opportunity as Oppty } from '@adobe/spacecat-shared-data-access';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { OPPORTUNITY_TITLES } from './constants.js';

const OPPORTUNITY_TYPE = 'generic-opportunity';

/**
 * Post-processor that creates/updates the opportunity and syncs suggestions.
 * Matches existing generic opportunities by title so mobile and desktop remain separate.
 * Creates a single suggestion containing the full audit result
 * (metadata, trendData, summary, urlDetails).
 */
export default async function opportunityHandler(finalUrl, auditData, context) {
  const { auditResult } = auditData;
  const { deviceType } = auditResult.metadata;
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  const expectedTitle = OPPORTUNITY_TITLES[deviceType] || OPPORTUNITY_TITLES.mobile;
  const opportunityInstance = createOpportunityData({ deviceType });

  let opportunity;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(
      auditData.siteId,
      Oppty.STATUSES.NEW,
    );
    opportunity = opportunities.find(
      (oppty) => oppty.getType() === OPPORTUNITY_TYPE && oppty.getTitle() === expectedTitle,
    );
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  try {
    if (!opportunity) {
      opportunity = await Opportunity.create({
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: opportunityInstance.runbook,
        type: OPPORTUNITY_TYPE,
        origin: opportunityInstance.origin,
        title: opportunityInstance.title,
        description: opportunityInstance.description,
        guidance: opportunityInstance.guidance,
        tags: opportunityInstance.tags,
        data: opportunityInstance.data,
      });
    } else {
      opportunity.setAuditId(auditData.id);
      opportunity.setData({
        ...opportunity.getData(),
        dataSources: opportunityInstance.data?.dataSources,
      });
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }
  } catch (e) {
    log.error(`Failed to create/update opportunity for siteId ${auditData.siteId}: ${e.message}`);
    throw e;
  }

  // Create a single suggestion containing the full audit result
  await syncSuggestions({
    opportunity,
    newData: [auditResult], // Single item array with full result
    context,
    buildKey: () => `${deviceType}-report`, // Single key per device type
    mapNewSuggestion: (result) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: result.summary.totalUrls,
      data: {
        suggestionValue: JSON.stringify(result), // Stringified full audit result
      },
    }),
  });

  return auditData;
}
