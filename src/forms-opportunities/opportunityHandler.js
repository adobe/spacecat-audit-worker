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

import generateOpptyData from './utils.js';

/**
 * filter login and search forms from the opportunities
 * @param formOpportunities
 * @param scrapedData
 * @param log
 * @returns {*}
 */
function filterForms(formOpportunities, scrapedData, log) {
  if (!scrapedData?.formData || !Array.isArray(scrapedData.formData)) {
    log.debug('No valid scraped data available.');
    return formOpportunities; // Return original opportunities if no valid scraped data
  }

  return formOpportunities.filter((opportunity) => {
    // Find matching form in scraped data
    const matchingForm = scrapedData.formData.find((form) => {
      const urlMatches = form.finalUrl === opportunity?.form;
      const isSearchForm = Array.isArray(form.scrapeResult)
          && form.scrapeResult.some((result) => result?.formType === 'search');

      return urlMatches && isSearchForm;
    });

    if (matchingForm) {
      log.debug(`Filtered out search form: ${opportunity?.url}`);
      return false;
    }

    return true;
  });
}

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
export default async function convertToOpportunity(auditUrl, auditData, scrapedData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  log.info(`Syncing opportunity for ${auditData.siteId}`);
  let highFormViewsLowConversionsOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');

    highFormViewsLowConversionsOppty = opportunities.find((oppty) => oppty.getType() === 'high-form-views-low-conversions');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { formVitals } = auditData.auditResult;

  const formOpportunities = generateOpptyData(formVitals);
  const filteredOpportunities = filterForms(formOpportunities, scrapedData, log);

  try {
    for (const opptyData of filteredOpportunities) {
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
        log.debug('Forms Opportunity created');
      } else {
        highFormViewsLowConversionsOppty.setAuditId(auditData.siteId);
        // eslint-disable-next-line no-await-in-loop
        await highFormViewsLowConversionsOppty.save();
      }
    }
  } catch (e) {
    log.error(`Creating Forms opportunity for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
    throw new Error(`Failed to create Forms opportunity for siteId ${auditData.siteId}: ${e.message}`);
  }
  log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high-form-views-low-conversions audit type.`);
}
