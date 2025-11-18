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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { v4 as uuidv4 } from 'uuid';
import { FORM_OPPORTUNITY_TYPES, ORIGINS } from '../constants.js';

/**
 * Fetches existing suggestions and merges them with new suggestions
 * @param opportunity
 * @param newSuggestions
 * @returns {Promise<void>}
 */
async function addSuggestions(
  opportunity,
  newSuggestions,
) {
  const existingSuggestions = await opportunity.getSuggestions();

  if (
    (existingSuggestions && existingSuggestions.length > 0)
    || (newSuggestions && newSuggestions.length > 0)
  ) {
    // merge existing and new suggestions and add to opportunity.
    // To be done once M starts generating suggestions for this guidance
  } else {
    const emptySuggestionList = [
      {
        id: uuidv4(),
        opportunityId: opportunity.opportunityId,
        type: 'CONTENT_UPDATE',
        rank: 1,
        status: 'NEW',
        data: {
          variations: [
            {
              name: 'Control',
              changes: [
                {
                  type: 'text',
                  element: null,
                  text: 'Control',
                },
              ],
              variationEditPageUrl: null,
              id: uuidv4(),
              variationPageUrl: '',
              explanation: null,
              projectedImpact: null,
              previewImage: '',
            },
          ],
        },
        kpiDeltas: {
          estimatedKPILift: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: 'system',
      },
    ];
    await opportunity.addSuggestions(emptySuggestionList);
  }
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    url,
    form_source: formsource,
    guidance, suggestions,
  } = data;
  log.info(`[Form Opportunity] [Site Id: ${siteId}] message received in high-page-views-low-form-views guidance handler: ${JSON.stringify(message, null, 2)}`);

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const opportunity = existingOpportunities
    .filter((oppty) => oppty.getType() === FORM_OPPORTUNITY_TYPES.LOW_VIEWS)
    .find((oppty) => oppty.getData()?.form === url && (!formsource
      || oppty.getData()?.formsource === formsource)
      && oppty.getData()?.origin !== ORIGINS.ESS_OPS);

  if (opportunity) {
    log.debug(`[Form Opportunity] [Site Id: ${siteId}] existing opportunity found for page: ${url}. Updating it with new data.`);
    opportunity.setAuditId(auditId);
    // Wrap the guidance data under the recommendation key
    const wrappedGuidance = { recommendations: guidance };
    opportunity.setGuidance(wrappedGuidance);
    opportunity.setUpdatedBy('system');
    await addSuggestions(opportunity, suggestions);
    await opportunity.save();
    log.debug(`[Form Opportunity] [Site Id: ${siteId}] high-page-views-low-form-views guidance updated oppty: ${JSON.stringify(opportunity, null, 2)}`);
  }
  return ok();
}
