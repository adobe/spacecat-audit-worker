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

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 * @param AUDIT_TYPE - The type of the audit.
 * @param OpportunityData - The opportunity data object.
 * @param props - Either The KPI deltas for the audit or opportunity properties for the mapper.
 */

// eslint-disable-next-line max-len
export async function convertToOpportunity(auditUrl, auditData, context, OpportunityData, AUDIT_TYPE, props = {}) {
  const opportunityInstance = new OpportunityData(props);
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  let opportunity;

  if (AUDIT_TYPE !== 'high-organic-low-ctr') {
    try {
      const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
      opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
    } catch (e) {
      log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
    }
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
        data: opportunityInstance.data,
      };
      // opportunity = await Opportunity.create(opportunityDataSchema);
      if (AUDIT_TYPE === 'high-organic-low-ctr') {
        opportunityDataSchema.status = 'NEW';
        const opportunities = await Opportunity.allBySiteId(auditData.siteId);
        opportunity = opportunities.find(
          (oppty) => (oppty.getType() === opportunityDataSchema.type) && oppty.getData()
            && (oppty.getData().page === opportunityDataSchema.data.page),
        );
        if (opportunity) {
          log.info(`Updating opportunity entity for ${opportunityDataSchema.data.page} with the new data`);
          opportunity.setAuditId(opportunityDataSchema.auditId);
          opportunity.setData({
            ...opportunityDataSchema.data,
          });
          await opportunity.save();
          return opportunity;
        }
      }
      opportunity = await Opportunity.create(opportunityDataSchema);
      return opportunity;
    } else {
      opportunity.setAuditId(auditData.id);
      if (AUDIT_TYPE === 'cwv') {
        opportunity.setData({
          ...opportunity.getData(),
          ...props, // kpiDeltas
        });
      }
      await opportunity.save();
      return opportunity;
    }
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
    throw e;
  }
}
