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
import { filterForms, generateOpptyData } from '../utils.js';

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
// eslint-disable-next-line max-len
export default async function createLowFormViewsOpportunities(auditUrl, auditDataObject, scrapedData, context) {
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
  // eslint-disable-next-line max-len
  const formOpportunities = await generateOpptyData(formVitals, context, [FORM_OPPORTUNITY_TYPES.LOW_FORM_VIEWS]);
  log.debug(`forms opportunities high-page-views-low-form-views: ${JSON.stringify(formOpportunities, null, 2)}`);

  const filteredOpportunities = filterForms(formOpportunities, scrapedData, log);
  log.info(`filtered opportunities: high-page-views-low-form-views:  ${JSON.stringify(filteredOpportunities, null, 2)}`);

  try {
    for (const opptyData of filteredOpportunities) {
      let highPageViewsLowFormViewsOptty = opportunities.find(
        (oppty) => oppty.getType() === FORM_OPPORTUNITY_TYPES.LOW_FORM_VIEWS
          && oppty.getData().form === opptyData.form,
      );

      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.auditId,
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EeYKNa4HQkRAleWXjC5YZbMBMhveB08F1yTTUQSrP97Eow?e=cZdsnA',
        type: FORM_OPPORTUNITY_TYPES.LOW_FORM_VIEWS,
        origin: 'AUTOMATION',
        title: 'Form Page has high views but the Form has low views',
        description: 'The Form Page has a lot of views but the Form has low Views due to Form being below the fold',
        tags: ['Forms Conversion'],
        data: {
          ...opptyData,
        },
        guidance: {
          recommendations: [
            {
              insight: `The Form in the page: ${opptyData.form} is either placed below the fold or is shown as a pop-up/modal`,
              recommendation: 'Position the form or a teaser of the form higher up on the page so users see it without scrolling. If the form is in a pop-up/modal, embed it directly on the page instead.',
              type: 'guidance',
              rationale: 'Forms that are visible above the fold are more likely to be seen and interacted with by users. People often close modals automatically without reading.',
            },
          ],
        },
      };

      log.info(`Forms Opportunity created high page views low form views ${JSON.stringify(opportunityData, null, 2)}`);
      if (!highPageViewsLowFormViewsOptty) {
        // eslint-disable-next-line no-await-in-loop
        highPageViewsLowFormViewsOptty = await Opportunity.create(opportunityData);
      } else {
        highPageViewsLowFormViewsOptty.setAuditId(auditData.auditId);
        highPageViewsLowFormViewsOptty.setData({
          ...highPageViewsLowFormViewsOptty.getData(),
          ...opportunityData.data,
        });
        highPageViewsLowFormViewsOptty.setGuidance(opportunityData.guidance);
        // eslint-disable-next-line no-await-in-loop
        await highPageViewsLowFormViewsOptty.save();
      }
    }
  } catch (e) {
    log.error(`Creating Forms opportunity for high page views low form views for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
  }
  log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high page views low form views audit type.`);
}
