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

import { isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { FORM_OPPORTUNITY_TYPES } from '../constants.js';
import {
  calculateProjectedConversionValue,
  filterForms,
  generateOpptyData,
  sendMessageToFormsQualityAgent,
} from '../utils.js';
import { DATA_SOURCES } from '../../common/constants.js';

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 * @param excludeForms - A set of Forms to exclude from the opportunity creation process.
 */
// eslint-disable-next-line max-len
export default async function createLowViewsOpportunities(auditUrl, auditDataObject, scrapedData, context, excludeForms = new Set()) {
  const {
    dataAccess, log, sqs, site, env,
  } = context;
  const { Opportunity } = dataAccess;

  const auditData = JSON.parse(JSON.stringify(auditDataObject));
  log.info(`Syncing high page views low form views opportunity for ${auditData.siteId}`);
  let opportunities;

  try {
    opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { formVitals } = auditData.auditResult;
  // eslint-disable-next-line max-len
  const formOpportunities = await generateOpptyData(formVitals, context, [FORM_OPPORTUNITY_TYPES.LOW_VIEWS]);
  log.debug(`forms opportunities high-page-views-low-form-views: ${JSON.stringify(formOpportunities, null, 2)}`);

  const filteredOpportunities = filterForms(formOpportunities, scrapedData, log, excludeForms);
  filteredOpportunities.forEach((oppty) => excludeForms.add(oppty.form + oppty.formsource));
  log.info(`filtered opportunities: high-page-views-low-form-views:  ${JSON.stringify(filteredOpportunities, null, 2)}`);
  try {
    for (const opptyData of filteredOpportunities) {
      let highPageViewsLowFormViewsOptty = opportunities.find(
        (oppty) => oppty.getType() === FORM_OPPORTUNITY_TYPES.LOW_VIEWS
          && oppty.getData().form === opptyData.form,
      );
      // eslint-disable-next-line no-await-in-loop,max-len
      const { projectedConversionValue = null } = (await calculateProjectedConversionValue(context, auditData.siteId, opptyData)) || {};

      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.auditId,
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EeYKNa4HQkRAleWXjC5YZbMBMhveB08F1yTTUQSrP97Eow?e=cZdsnA',
        type: FORM_OPPORTUNITY_TYPES.LOW_VIEWS,
        origin: 'AUTOMATION',
        title: 'Form has low views',
        description: 'The form has low views but the page containing the form has higher traffic',
        tags: ['Form Placement'],
        data: {
          ...opptyData,
          projectedConversionValue,
          dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.PAGE],
        },
        guidance: {
          recommendations: [
            {
              insight: `The form in the page: ${opptyData.form} has low discoverability and only ${((opptyData.formViews / opptyData.pageViews) * 100).toFixed(2)}% visitors landing on the page are viewing the form.`,
              recommendation: 'Position the form higher up on the page so users see it without scrolling. Consider using clear and compelling CTAs, minimizing distractions, and ensuring strong visibility across devices.',
              type: 'guidance',
              rationale: 'Forms that are visible above the fold are more likely to be seen and interacted with by users.',
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
        if (!isNonEmptyObject(highPageViewsLowFormViewsOptty.guidance)) {
          highPageViewsLowFormViewsOptty.setGuidance(opportunityData.guidance);
        }

        highPageViewsLowFormViewsOptty.setUpdatedBy('system');
        // eslint-disable-next-line no-await-in-loop
        await highPageViewsLowFormViewsOptty.save();
      }
      log.info('sending message to mystique for high-page-views-low-form-views');
      const mystiqueMessage = {
        type: 'guidance:high-page-views-low-form-views',
        siteId: auditData.siteId,
        auditId: auditData.auditId,
        deliveryType: site.getDeliveryType(),
        time: new Date().toISOString(),
        data: {
          url: opportunityData.data.form,
          form_source: opportunityData.data.formsource,
          cta_text: '', // This will be available after merging the changes for scraping form CTA text
          cta_source: '', // This will be available after merging the changes for scraping form CTA text
        },
      };

      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
      log.info(`forms opportunity high page views low form views sent to mystique: ${JSON.stringify(mystiqueMessage)}`);
      // eslint-disable-next-line max-len,no-await-in-loop
      await sendMessageToFormsQualityAgent(auditDataObject, context, opportunityData.data.form, opportunityData.data.formsource);
    }
  } catch (e) {
    log.error(`Creating Forms opportunity for high page views low form views for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
  }
  log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high page views low form views audit type.`);
}
