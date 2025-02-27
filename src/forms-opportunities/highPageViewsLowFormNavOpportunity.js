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

import { filterForms, generateOpptyDataForHighPageViewsLowFormNav } from './utils.js';

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
// eslint-disable-next-line max-len
export default async function highPageViewsLowFormNavOpportunity(auditUrl, auditDataObject, scrapedData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  // eslint-disable-next-line no-param-reassign
  const auditData = JSON.parse(JSON.stringify(auditDataObject));
  log.info(`Syncing high page views low form nav opportunity for ${auditData.siteId}`);
  let opportunities;

  try {
    opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { formVitals } = auditData.auditResult;
  const formOpportunities = generateOpptyDataForHighPageViewsLowFormNav(formVitals);
  log.debug(`forms opportunities high page views low form navigation ${JSON.stringify(formOpportunities, null, 2)}`);
  const filteredOpportunities = filterForms(formOpportunities, scrapedData, log);
  log.info(`filtered opportunties for form for high page views low form navigation ${JSON.stringify(filteredOpportunities, null, 2)}`);

  try {
    for (const opptyData of filteredOpportunities) {
      let highPageViewsLowFormNavOppty = opportunities.find(
        (oppty) => oppty.getType() === 'high-page-views-low-form-nav'
              && oppty.getData().form === opptyData.form,
      );

      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/ETCwSsZJzRJIuPqnC_jZFhgBsW29GijIgk9C6-GpkQ16xg?e=dNYZhD',
        type: 'high-page-views-low-form-nav',
        origin: 'AUTOMATION',
        title: 'Form has low views',
        description: 'The form has low views due to low navigations in the page containing its CTA',
        tags: ['Forms Conversion'],
        data: {
          ...opptyData,
        },
      };

      log.info(`Forms Opportunity created high page views low form nav ${JSON.stringify(opportunityData, null, 2)}`);
      if (!highPageViewsLowFormNavOppty) {
        // eslint-disable-next-line no-await-in-loop
        highPageViewsLowFormNavOppty = await Opportunity.create(opportunityData);
      } else {
        highPageViewsLowFormNavOppty.setAuditId(auditData.siteId);
        highPageViewsLowFormNavOppty.setData({
          ...highPageViewsLowFormNavOppty.getData(),
          ...opportunityData.data,
        });
        // eslint-disable-next-line no-await-in-loop
        await highPageViewsLowFormNavOppty.save();
      }
    }
  } catch (e) {
    log.error(`Creating Forms opportunity for high page views low form nav for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
  }
  log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high page views low form nav audit type.`);
}
