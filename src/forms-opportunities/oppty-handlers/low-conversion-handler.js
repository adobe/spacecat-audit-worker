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

import { isNonEmptyArray, isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import {
  filterForms,
  generateOpptyData,
  shouldExcludeForm,
  calculateProjectedConversionValue,
  sendMessageToFormsQualityAgent,
} from '../utils.js';
import { FORM_OPPORTUNITY_TYPES, ORIGINS } from '../constants.js';
import { DATA_SOURCES } from '../../common/constants.js';

function generateDefaultGuidance(scrapedData, oppoty) {
  if (isNonEmptyArray(scrapedData?.formData)) {
    for (const form of scrapedData.formData) {
      const formUrl = new URL(form.finalUrl);
      const opportunityUrl = new URL(oppoty.form);
      if (formUrl.origin + formUrl.pathname === opportunityUrl.origin + opportunityUrl.pathname) {
        const nonSearchForms = form.scrapeResult.filter((x) => !shouldExcludeForm(x));
        if (nonSearchForms.length !== 0) {
          const { isLargeForm, isBelowTheFold } = nonSearchForms.reduce((
            acc,
            { visibleATF, visibleFieldCount },
          ) => {
            if (visibleFieldCount > 6) {
              acc.isLargeForm = true;
            }
            if (!visibleATF) {
              acc.isBelowTheFold = true;
            }
            return acc;
          }, { isLargeForm: false, isBelowTheFold: false });
          if (isLargeForm) {
            return {
              recommendations: [
                {
                  insight: 'The form contains a large number of fields, which can be overwhelming and increase cognitive load for users',
                  recommendation: 'Consider using progressive disclosure techniques, such as multi-step forms, to make the process less daunting.',
                  type: 'guidance',
                  rationale: 'Progressive disclosure can help by breaking the form into smaller, more manageable steps that can decrease cognitive load and make it more likely for users to complete the form.',
                },
              ],
            };
          }
          // visibility takes precedence and overwrites large form guidance
          // if both issues are detected.
          if (isBelowTheFold) {
            return {
              recommendations: [
                {
                  insight: 'The form is not visible above the fold, which can reduce its visibility and accessibility to users',
                  recommendation: 'Move the form higher on the page so that it is visible without scrolling.',
                  type: 'guidance',
                  rationale: 'Forms that are visible above the fold are more likely to be seen and interacted with by users, leading to higher conversion rates.',
                },
              ],
            };
          }
          // eslint-disable-next-line max-len
          return Number(oppoty.trackedFormKPIValue) > 0 && Number(oppoty.trackedFormKPIValue) < 0.1 && {
            recommendations: [
              {
                insight: `The form has a conversion rate of ${oppoty.trackedFormKPIValue.toFixed(2) * 100}%`,
                recommendation: 'Ensure that the form communicates a compelling reason for users to fill it out. ',
                type: 'guidance',
                rationale: 'A strong, benefit-driven headline and a concise supporting message can improve engagement.',
              },
            ],
          };
        }
      }
    }
  }
  return {};
}

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 * @param excludeForms - A set of Forms to exclude from the opportunity creation process.
 */
// eslint-disable-next-line max-len
export default async function createLowConversionOpportunities(auditUrl, auditDataObject, scrapedData, context, excludeForms = new Set()) {
  const {
    dataAccess, log, site,
  } = context;
  const { Opportunity } = dataAccess;

  // eslint-disable-next-line no-param-reassign
  const auditData = JSON.parse(JSON.stringify(auditDataObject));
  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] syncing opportunity high form views low conversion for ${auditData.siteId}`);
  let opportunities;

  try {
    opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  } catch (e) {
    log.error(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] fetching opportunities failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { formVitals } = auditData.auditResult;
  // eslint-disable-next-line max-len
  const formOpportunities = await generateOpptyData(formVitals, context, [FORM_OPPORTUNITY_TYPES.LOW_CONVERSION]);
  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] opportunities high-page-views-low-form-conversions: ${JSON.stringify(formOpportunities, null, 2)}`);
  const filteredOpportunities = filterForms(formOpportunities, scrapedData, log, excludeForms);
  filteredOpportunities.forEach((oppty) => excludeForms.add(oppty.form + oppty.formsource));
  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] filtered opportunties high-page-views-low-form-conversions: ${JSON.stringify(filteredOpportunities, null, 2)}`);

  try {
    for (const opptyData of filteredOpportunities) {
      let highFormViewsLowConversionsOppty = opportunities.find(
        (oppty) => oppty.getType() === FORM_OPPORTUNITY_TYPES.LOW_CONVERSION
          && oppty.getData().form === opptyData.form,
      );
      // eslint-disable-next-line no-await-in-loop,max-len
      const { projectedConversionValue = null } = (await calculateProjectedConversionValue(context, auditData.siteId, opptyData)) || {};

      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.auditId,
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
        type: FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
        origin: 'AUTOMATION',
        title: 'Form has low conversions',
        description: 'Form has high views but low conversions',
        tags: ['Form Conversion'],
        data: {
          ...opptyData,
          projectedConversionValue,
          dataSources: [DATA_SOURCES.RUM, DATA_SOURCES.PAGE],
        },
        guidance: generateDefaultGuidance(scrapedData, opptyData),
      };

      log.info(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] forms opportunity high form views low conversion ${JSON.stringify(opportunityData, null, 2)}`);
      if (!highFormViewsLowConversionsOppty) {
        // eslint-disable-next-line no-await-in-loop
        highFormViewsLowConversionsOppty = await Opportunity.create(opportunityData);
        log.info(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] forms opportunity high page views low form conversions created for form ${opptyData.form} and form source ${opptyData.formsource}`);
      } else if (highFormViewsLowConversionsOppty.getOrigin() === ORIGINS.ESS_OPS) {
        log.info(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] forms opportunity high page views low form conversion for form ${opptyData.form} and form source ${opptyData.formsource} already exists and is from ESS_OPS manually created, creating the opportunity and marking it as ignore`);
        opportunityData.status = 'IGNORED';
        // eslint-disable-next-line no-await-in-loop
        highFormViewsLowConversionsOppty = await Opportunity.create(opportunityData);
      } else {
        log.info(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] forms opportunity high page views low form conversions for form ${opptyData.form} and form source ${opptyData.formsource} already exists and overwriting it`);
        highFormViewsLowConversionsOppty.setAuditId(auditData.auditId);
        highFormViewsLowConversionsOppty.setData({
          ...highFormViewsLowConversionsOppty.getData(),
          ...opportunityData.data,
        });
        if (!isNonEmptyObject(highFormViewsLowConversionsOppty.guidance)) {
          highFormViewsLowConversionsOppty.setGuidance(opportunityData.guidance);
        }

        highFormViewsLowConversionsOppty.setUpdatedBy('system');
        // eslint-disable-next-line no-await-in-loop
        await highFormViewsLowConversionsOppty.save();
      }

      // eslint-disable-next-line no-await-in-loop
      await sendMessageToFormsQualityAgent(auditDataObject, context, opportunityData);
    }
  } catch (e) {
    console.log(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] creating forms opportunity failed with error: ${e.message}`, e);
    log.error(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] creating forms opportunity failed with error: ${e.message}`, e);
  }
  log.info(`[Form Opportunity] [Site Id: ${site.getId()}] [Opportunity Type: ${FORM_OPPORTUNITY_TYPES.LOW_CONVERSION}] successfully synced opportunity for high form views low conversions oppty type`);
}
