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
 * Finds or creates a generic opportunity for a specific device type.
 */
async function findOrCreateOpportunity(
  deviceType,
  existingOpportunities,
  auditData,
  Opportunity,
  log,
) {
  const expectedTitle = OPPORTUNITY_TITLES[deviceType] || OPPORTUNITY_TITLES.mobile;
  const opportunityInstance = createOpportunityData({ deviceType });

  let opportunity = existingOpportunities.find(
    (oppty) => oppty.getType() === OPPORTUNITY_TYPE && oppty.getTitle() === expectedTitle,
  );

  try {
    if (!opportunity) {
      opportunity = await Opportunity.create({
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: opportunityInstance.runbook,
        type: OPPORTUNITY_TYPE,
        status: Oppty.STATUSES.NEW,
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

  return opportunity;
}

/**
 * Post-processor that creates/updates opportunities and syncs suggestions
 * for each device type (mobile and desktop).
 * auditData.auditResult is an array of per-device results.
 */
export default async function opportunityHandler(finalUrl, auditData, context) {
  const { auditResult } = auditData;
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  let existingOpportunities;
  try {
    existingOpportunities = await Opportunity.allBySiteIdAndStatus(
      auditData.siteId,
      Oppty.STATUSES.NEW,
    );
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  await Promise.all(auditResult.map(async (deviceResult) => {
    const { deviceType } = deviceResult.metadata;

    const opportunity = await findOrCreateOpportunity(
      deviceType,
      existingOpportunities,
      auditData,
      Opportunity,
      log,
    );

    await syncSuggestions({
      opportunity,
      newData: [deviceResult],
      context,
      buildKey: () => `${deviceType}-report`,
      mapNewSuggestion: (result) => ({
        opportunityId: opportunity.getId(),
        type: 'CONTENT_UPDATE',
        rank: result.summary.totalUrls,
        data: {
          suggestionValue: JSON.stringify(result),
        },
      }),
      mergeDataFunction: (existingData, newResult) => ({
        ...existingData,
        suggestionValue: JSON.stringify(newResult),
      }),
      newSuggestionStatus: 'NEW',
    });
  }));

  return auditData;
}
