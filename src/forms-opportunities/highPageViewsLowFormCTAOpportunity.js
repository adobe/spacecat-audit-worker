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

import { generateOpptyDataForHighPageViewsLowFormCTA } from './utils.js';

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
export default async function highPageViewsLowFormCTAOpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  log.info(`Syncing high page views low form cta opportunity for ${auditData.siteId}`);
  let highPageViewsLowFormCtaOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    highPageViewsLowFormCtaOppty = opportunities.find((oppty) => oppty.getType() === 'high-page-views-low-form-cta');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { formVitals } = auditData.auditResult;
  const formOpportunities = generateOpptyDataForHighPageViewsLowFormCTA(formVitals);

  try {
    for (const opptyData of formOpportunities) {
      if (!highPageViewsLowFormCtaOppty) {
        const opportunityData = {
          siteId: auditData.siteId,
          auditId: auditData.id,
          runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
          type: 'high-page-views-low-form-cta',
          origin: 'AUTOMATION',
          title: 'Form has low views but CTA page has high views',
          description: 'Form has low views but CTA page has high view',
          tags: ['Forms Conversion'],
          data: {
            ...opptyData,
          },
        };
        // eslint-disable-next-line no-await-in-loop
        highPageViewsLowFormCtaOppty = await Opportunity.create(opportunityData);
        log.debug('Forms Opportunity for high page views low form cta created');
      } else {
        highPageViewsLowFormCtaOppty.setAuditId(auditData.siteId);
        // eslint-disable-next-line no-await-in-loop
        await highPageViewsLowFormCtaOppty.save();
      }
    }
  } catch (e) {
    log.error(`Creating Forms opportunity for high page views low form cta for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
    throw new Error(`Failed to create Forms opportunity for high page views low form cta for siteId ${auditData.siteId}: ${e.message}`);
  }
  log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high page views low form cta audit type.`);
}
