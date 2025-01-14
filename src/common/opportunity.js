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

import { opportunityData } from '../metatags/opportunityDataMapper.js';

// eslint-disable-next-line consistent-return
export async function convertToOpportunity(auditUrl, auditData, context, AUDIT_TYPE) {
  // eslint-disable-next-line new-cap
  const opportunityInstance = new opportunityData();
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  let opportunity;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`); // internalServerError
  }

  try {
    if (!opportunity) {
      const opportunityDataSchema = {
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: opportunityInstance.runbook,
        type: AUDIT_TYPE,
        origin: opportunityInstance.origin,
        title: opportunityInstance.title,
        description: opportunityInstance.description,
        guidance: opportunityInstance.guidance,
        tags: opportunityInstance.tags,
      };
      opportunity = await Opportunity.create(opportunityDataSchema);
      return opportunity;
    } else {
      opportunity.setAuditId(auditData.id);
      await opportunity.save();
    }
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
    throw e;
  }
}
