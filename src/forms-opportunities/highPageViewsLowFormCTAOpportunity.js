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

import { generateOpptyDataForHighPageViewsLowFormCTR } from './utils.js';

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
export default async function highPageViewsLowFormCTROpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  log.info(`Syncing high page views low form ctr opportunity for ${auditData.siteId}`);
  log.info(`Debug log 2 ${JSON.stringify(auditData, null, 2)}`);

  let highPageViewsLowFormCtaOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    highPageViewsLowFormCtaOppty = opportunities.find((oppty) => oppty.getType() === 'high-page-views-low-form-ctr');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { formVitals } = auditData.auditResult;
  const identifiedOpportunities = [];
  const formOpportunities = generateOpptyDataForHighPageViewsLowFormCTR(formVitals);

  try {
    for (const opptyData of formOpportunities) {
      if (!highPageViewsLowFormCtaOppty) {
        const opportunityData = {
          siteId: auditData.siteId,
          auditId: auditData.id,
          runbook: 'https://adobe.sharepoint.com/:w:/r/sites/AEM_Forms/_layouts/15/doc.aspx?sourcedoc=%7Bc64ab030-cd49-4812-b8fa-a70bf8d91618%7D',
          type: 'high-page-views-low-form-ctr',
          origin: 'AUTOMATION',
          title: 'Form has low views but conversion element has low CTR',
          description: 'The page containing the form CTA has high views but low CTR for the form CTA',
          tags: ['Forms Conversion'],
          data: {
            ...opptyData,
          },
        };
        // eslint-disable-next-line no-await-in-loop
        highPageViewsLowFormCtaOppty = await Opportunity.create(opportunityData);
        identifiedOpportunities.push(opportunityData);
        log.debug('Forms Opportunity for high page views low form cta created');
      } else {
        highPageViewsLowFormCtaOppty.setAuditId(auditData.siteId);
        // eslint-disable-next-line no-await-in-loop
        await highPageViewsLowFormCtaOppty.save();
      }
    }

    log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high page views low form cta audit type.`);
    // eslint-disable-next-line no-param-reassign
    auditData.formsOpportunities = identifiedOpportunities;
    return {
      ...auditData,
    };
  } catch (e) {
    log.error(`Creating Forms opportunity for high page views low form cta for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
    throw new Error(`Failed to create Forms opportunity for high page views low form cta for siteId ${auditData.siteId}: ${e.message}`);
  }
}
