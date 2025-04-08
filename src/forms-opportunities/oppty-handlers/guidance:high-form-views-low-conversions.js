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

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, guidance, suggestions } = data;
  log.info(`Message received in high-form-views-low-conversions guidance handler: ${JSON.stringify(message, null, 2)}`);

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  let opportunity = existingOpportunities.find(
    (oppty) => oppty.getData()?.page === url,
  );

  if (opportunity) {
    log.info(`Existing Opportunity found for page: ${url}. Updating it with new data.`);
    opportunity.setAuditId(auditId);
    // Wrap the guidance data under the recommendation key
    const wrappedGuidance = { recommendation: guidance };
    opportunity.setGuidance(wrappedGuidance);
    log.info(`high-form-views-low-conversions guidance updated oppty : ${JSON.stringify(opportunity, null, 2)}`);
    opportunity = await opportunity.save();

    const existingSuggestions = await opportunity.getSuggestions();

    // delete previous suggestions if any
    await Promise.all(existingSuggestions.map((suggestion) => suggestion.remove()));

    // map the suggestions received from M to PSS
    const suggestionData = {
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: 1,
      status: 'NEW',
      data: {
        variations: suggestions,
        recommendation: guidance, // Add guidance under recommendation key
      },
      kpiDeltas: {
        estimatedKPILift: 0,
      },
    };

    await Suggestion.create(suggestionData);
  }

  return ok();
}
