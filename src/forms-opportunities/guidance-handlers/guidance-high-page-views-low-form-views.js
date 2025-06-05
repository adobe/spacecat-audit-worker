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
import { FORM_OPPORTUNITY_TYPES } from '../constants.js';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, formsource, guidance } = data;
  log.info(`Message received in high-page-views-low-form-views guidance handler: ${JSON.stringify(message, null, 2)}`);

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const opportunity = existingOpportunities
    .filter((oppty) => oppty.getType() === FORM_OPPORTUNITY_TYPES.LOW_VIEWS)
    .find((oppty) => oppty.getData()?.form === url && (!formsource
      || oppty.getData()?.formsource === formsource));

  if (opportunity) {
    log.info(`Existing Opportunity found for page: ${url}. Updating it with new data.`);
    opportunity.setAuditId(auditId);
    // Wrap the guidance data under the recommendation key
    const wrappedGuidance = { recommendations: guidance };
    opportunity.setGuidance(wrappedGuidance);
    opportunity.setUpdatedBy('system');
    await opportunity.save();
    log.info(`high-page-views-low-form-views guidance updated oppty : ${JSON.stringify(opportunity, null, 2)}`);
  }

  return ok();
}
