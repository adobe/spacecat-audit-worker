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
import { Audit, Opportunity as Oppty } from '@adobe/spacecat-shared-data-access';
import { DATA_SOURCES } from './constants.js';
import { checkGoogleConnection } from './opportunity-utils.js';
/**
  * Converts audit data to an opportunity instance.
  *
  * @param {string} auditUrl - The URL of the audit.
  * @param {Object} auditData - The audit data containing the audit result and additional details.
  * @param {Object} context - The context object containing the data access and logger objects.
  * @param {string} auditType - The type of the audit.
  * @param {Function} createOpportunityData - The function to create the opportunity data object.
  * @param {Object} [props={}] - Either the KPI deltas for the cwv audit or opportunity properties
  * for the mapper.
  * @param {Function} [comparisonFn] - Optional function to compare existing opportunity with
  * new opportunity instance. Should return true if they are the same, false otherwise.
  * Receives (oppty, opportunityInstance) as parameters.
  * @returns {Promise<Object>} The created or updated opportunity object.
  * @throws {Error} If fetching or creating the opportunity fails.
  */

// eslint-disable-next-line max-len
export async function convertToOpportunity(auditUrl, auditData, context, createOpportunityData, auditType, props = {}, comparisonFn = undefined) {
  const opportunityInstance = createOpportunityData(props);
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  let opportunity;

  if (auditType !== 'high-organic-low-ctr') {
    try {
      // eslint-disable-next-line max-len
      const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, Oppty.STATUSES.NEW);
      opportunity = opportunities.find((oppty) => {
        if (oppty.getType() === auditType) {
          // If comparison function is provided, use it to determine if opportunities are the same
          if (comparisonFn && typeof comparisonFn === 'function') {
            return comparisonFn(oppty, opportunityInstance);
          }
          // Default behavior: just match by type
          return true;
        }
        return false;
      });
    } catch (e) {
      log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
    }
  }

  const isGoogleConnected = await checkGoogleConnection(auditUrl, context);

  if (!isGoogleConnected && opportunityInstance.data?.dataSources) {
    opportunityInstance.data.dataSources = opportunityInstance.data.dataSources
      .filter((source) => source !== DATA_SOURCES.GSC);
  }

  try {
    if (!opportunity) {
      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: opportunityInstance.runbook,
        type: auditType,
        origin: opportunityInstance.origin,
        title: opportunityInstance.title,
        description: opportunityInstance.description,
        guidance: opportunityInstance.guidance,
        tags: opportunityInstance.tags,
        data: opportunityInstance.data,
      };
      opportunity = await Opportunity.create(opportunityData);
      return opportunity;
    } else {
      opportunity.setAuditId(auditData.id);
      if (auditType === Audit.AUDIT_TYPES.CWV
          || auditType === Audit.AUDIT_TYPES.META_TAGS
          || auditType === Audit.AUDIT_TYPES.SECURITY_CSP
          || auditType === Audit.AUDIT_TYPES.PRODUCT_METATAGS
          || auditType === Audit.AUDIT_TYPES.SECURITY_VULNERABILITIES) {
        opportunity.setData({
          ...opportunity.getData(),
          ...props, // kpiDeltas
          dataSources: opportunityInstance.data?.dataSources,
        });
      } else if (auditType === Audit.AUDIT_TYPES.PRERENDER) {
        opportunity.setData({
          ...opportunity.getData(),
          ...opportunityInstance.data,
        });
      } else {
        opportunity.setData({
          ...opportunity.getData(),
          dataSources: opportunityInstance.data?.dataSources,
        });
      }
      opportunity.setUpdatedBy('system');
      await opportunity.save();
      return opportunity;
    }
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
    throw e;
  }
}
