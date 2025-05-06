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

import { FORM_OPPORTUNITY_TYPES } from '../constants.js';

/**
 * @param auditUrl - The URL of the audit
 * @param auditDataObject - The audit data containing the audit result and additional details.
 * @param scrapedData - The scraped data containing the form data and a11y issues.
 * @param context - The context object containing the data access and logger objects.
 */
// eslint-disable-next-line max-len
export default async function createA11yOpportunities(auditUrl, auditDataObject, scrapedData, context) {
  const {
    dataAccess, log,
  } = context;
  const { Opportunity } = dataAccess;
  const { formA11yData } = scrapedData;

  if (formA11yData?.length === 0) {
    log.info(`[Form Opportunity] [Site Id: ${auditDataObject.siteId}] No a11y data found`);
    return;
  }

  // eslint-disable-next-line no-param-reassign
  const auditData = JSON.parse(JSON.stringify(auditDataObject));
  log.info(`[Form Opportunity] [Site Id: ${auditData.siteId}] Syncing opportunity a11y`);
  const filteredA11yData = formA11yData.filter((a11y) => a11y.scrapedData?.a11yIssues?.length > 0);
  if (filteredA11yData.length === 0) {
    log.info(`[Form Opportunity] [Site Id: ${auditData.siteId}] No accessibility issues found`);
    return;
  }
  let opportunities;
  try {
    opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  try {
    for (const a11yOpty of filteredA11yData) {
      const existingOppty = opportunities.find(
        (oppty) => oppty.getType() === FORM_OPPORTUNITY_TYPES.FORM_A11Y
                    && oppty.getData().form === a11yOpty.finalUrl,
      );
      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.auditId,
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
        type: FORM_OPPORTUNITY_TYPES.FORM_A11Y,
        origin: 'AUTOMATION',
        title: 'Accessibility Issues',
        description: 'Accessibility Issues',
        tags: [
          'Forms Accessibility',
        ],
        data: {
          form: a11yOpty.finalUrl,
          a11yIssues: a11yOpty.scrapedData.a11yIssues,
        },
      };

      if (!existingOppty) {
        // eslint-disable-next-line no-await-in-loop
        await Opportunity.create(opportunityData);
        log.info(`[Form Opportunity] [Site Id: ${auditData.siteId}] Created a11y opportunity for ${a11yOpty.finalUrl}`);
      } else {
        existingOppty.setAuditId(auditData.auditId);
        existingOppty.setData({
          ...existingOppty.getData(),
          ...opportunityData.data,
        });
        // eslint-disable-next-line no-await-in-loop
        await existingOppty.save();
        log.info(`[Form Opportunity] [Site Id: ${auditData.siteId}] Updated a11y opportunity for ${a11yOpty.finalUrl}`);
      }
    }
  } catch (e) {
    log.error(`Creating a11y opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to create a11y opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }
  log.info(`[Form Opportunity] [Site Id: ${auditData.siteId}] Successfully synced Opportunity for form-accessibility audit type.`);
}
