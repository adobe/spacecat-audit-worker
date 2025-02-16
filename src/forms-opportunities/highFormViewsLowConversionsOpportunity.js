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

import { generateOpptyData } from './utils.js';

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
export default async function highFormViewsLowConversionsOpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  log.info(`Syncing opportunity for ${auditData.siteId}`);
  log.info(`Debug log 1 ${auditData}`);
  let highFormViewsLowConversionsOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    highFormViewsLowConversionsOppty = opportunities.find((oppty) => oppty.getType() === 'high-form-views-low-conversions');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { formVitals } = auditData.auditResult;
  const identifiedOpportunities = [];
  const formOpportunities = generateOpptyData(formVitals);

  try {
    for (const opptyData of formOpportunities) {
      if (!highFormViewsLowConversionsOppty) {
        const opportunityData = {
          siteId: auditData.siteId,
          auditId: auditData.id,
          runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
          type: 'high-form-views-low-conversions',
          origin: 'AUTOMATION',
          title: 'Form has high views but low conversions',
          description: 'Form has high views but low conversions',
          tags: ['Forms Conversion'],
          data: {
            ...opptyData,
          },
        };
        // eslint-disable-next-line no-await-in-loop
        highFormViewsLowConversionsOppty = await Opportunity.create(opportunityData);
        identifiedOpportunities.push(opportunityData);
        log.debug('Forms Opportunity created');
      } else {
        highFormViewsLowConversionsOppty.setAuditId(auditData.siteId);
        // eslint-disable-next-line no-await-in-loop
        await highFormViewsLowConversionsOppty.save();
      }
    }

    log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high-form-views-low-conversions audit type.`);
    // eslint-disable-next-line no-param-reassign
    auditData.formsOpportunities = identifiedOpportunities;
    return {
      ...auditData,
    };
  } catch (e) {
    log.error(`Creating Forms opportunity for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
    throw new Error(`Failed to create Forms opportunity for siteId ${auditData.siteId}: ${e.message}`);
  }
}
