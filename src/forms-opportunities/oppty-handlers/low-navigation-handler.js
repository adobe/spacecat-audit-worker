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
import { FORM_OPPORTUNITY_TYPES, ORIGINS } from '../constants.js';
import {
  calculateProjectedConversionValue,
  filterForms,
  generateOpptyData,
  sendMessageToFormsQualityAgent, sendMessageToMystiqueForGuidance,
} from '../utils.js';
import { DATA_SOURCES } from '../../common/constants.js';

const formPathSegments = ['contact', 'newsletter', 'sign', 'enrol', 'subscribe', 'register', 'join', 'apply', 'quote', 'buy', 'trial', 'demo', 'offer'];
/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 * @param excludeForms - A set of Forms to exclude from the opportunity creation process.
 */
// eslint-disable-next-line max-len
export default async function createLowNavigationOpportunities(auditUrl, auditDataObject, scrapedData, context, excludeForms = new Set()) {
  const {
    dataAccess, log,
  } = context;
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
  const formOpportunities = await generateOpptyData(formVitals, context, [FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION]);
  log.debug(`forms opportunities high-page-views-low-form-navigations: ${JSON.stringify(formOpportunities, null, 2)}`);

  // for opportunity type high page views low form navigation
  // excluding opportunities whose cta page has search in it.
  // eslint-disable-next-line max-len
  const filteredOpportunitiesByNavigation = formOpportunities.filter((opportunity) => formPathSegments.some((substring) => opportunity.form?.includes(substring)
    && !opportunity.formNavigation?.url?.includes('search')));

  const filteredOpportunities = filterForms(
    filteredOpportunitiesByNavigation,
    scrapedData,
    log,
    excludeForms,
  );
  filteredOpportunities.forEach((oppty) => excludeForms.add(oppty.form + oppty.formsource));
  log.info(`filtered opportunities: high-page-views-low-form-navigations:  ${JSON.stringify(filteredOpportunities, null, 2)}`);
  try {
    for (const opptyData of filteredOpportunities) {
      let highPageViewsLowFormNavOppty = opportunities.find(
        (oppty) => oppty.getType() === FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION
          && oppty.getData().form === opptyData.form,
      );
      // eslint-disable-next-line no-await-in-loop,max-len
      const { projectedConversionValue = null } = (await calculateProjectedConversionValue(context, auditData.siteId, opptyData)) || {};

      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.auditId,
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/ETCwSsZJzRJIuPqnC_jZFhgBsW29GijIgk9C6-GpkQ16xg?e=dNYZhD',
        type: FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION,
        origin: 'AUTOMATION',
        title: 'Form has low views',
        description: 'The form has low views due to low navigations in the page containing its CTA',
        tags: ['Form Navigation'],
        data: {
          ...opptyData,
          projectedConversionValue,
          dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.PAGE],
        },
        guidance: {
          recommendations: [
            {
              insight: `The CTA element in the page: ${opptyData?.formNavigation?.url} is not placed in the most optimal positions for visibility and engagement`,
              recommendation: 'Reposition the CTA to be more centrally located and ensure they are above the fold.',
              type: 'guidance',
              rationale: 'CTAs placed above the fold and in central positions are more likely to be seen and clicked by users, leading to higher engagement rates.',
            },
          ],
        },
      };

      log.info(`Forms Opportunity created high page views low form nav ${JSON.stringify(opportunityData, null, 2)}`);
      let formsList = [];

      if (!highPageViewsLowFormNavOppty) {
        // eslint-disable-next-line no-await-in-loop
        highPageViewsLowFormNavOppty = await Opportunity.create(opportunityData);
        log.debug('Forms Opportunity high page views low form nav created');
        // eslint-disable-next-line max-len
        formsList = [{ form: opportunityData.data.form, formSource: opportunityData.data.formsource }];
      } else if (highPageViewsLowFormNavOppty.getOrigin() === ORIGINS.ESS_OPS) {
        log.debug('Forms Opportunity high page views low form nav exists and is from ESS_OPS');
        opportunityData.status = 'IGNORED';
        // eslint-disable-next-line no-await-in-loop
        highPageViewsLowFormNavOppty = await Opportunity.create(opportunityData);
        // eslint-disable-next-line max-len
        formsList = [{ form: opportunityData.data.form, formSource: opportunityData.data.formsource }];
      } else {
        const data = highPageViewsLowFormNavOppty.getData();
        const { formDetails } = data;
        log.info(`Form details available for data  ${JSON.stringify(data, null, 2)}`);
        formsList = (formDetails !== undefined && isNonEmptyObject(formDetails))
          ? (log.info('Form details available for opportunity, not sending it to mystique'), [])
          : [{ form: opportunityData.data.form, formSource: opportunityData.data.formsource }];

        highPageViewsLowFormNavOppty.setAuditId(auditData.auditId);
        highPageViewsLowFormNavOppty.setData({
          ...highPageViewsLowFormNavOppty.getData(),
          ...opportunityData.data,
        });
        if (!isNonEmptyObject(highPageViewsLowFormNavOppty.guidance)) {
          highPageViewsLowFormNavOppty.setGuidance(opportunityData.guidance);
        }

        highPageViewsLowFormNavOppty.setUpdatedBy('system');
        // eslint-disable-next-line no-await-in-loop
        await highPageViewsLowFormNavOppty.save();
      }

      // eslint-disable-next-line no-await-in-loop
      await (formsList.length === 0
        ? sendMessageToMystiqueForGuidance(context, highPageViewsLowFormNavOppty)
        : sendMessageToFormsQualityAgent(context, highPageViewsLowFormNavOppty, formsList));
    }
  } catch (e) {
    log.error(`Creating Forms opportunity for high page views low form nav for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
  }
  log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high page views low form nav audit type.`);
}
