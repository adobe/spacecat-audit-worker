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

import { filterForms, generateOpptyData } from './utils.js';

/**
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the data access and logger objects.
 */
// eslint-disable-next-line max-len
export default async function convertToOpportunity(auditUrl, auditDataObject, scrapedData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  // eslint-disable-next-line no-param-reassign
  const auditData = JSON.parse(JSON.stringify(auditDataObject));
  log.info(`Syncing opportunity high page views low form views for ${auditData.siteId}`);
  let highFormViewsLowConversionsOppty;

  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
    highFormViewsLowConversionsOppty = opportunities.find((oppty) => oppty.getType() === 'high-form-views-low-conversions');
  } catch (e) {
    log.error(`Fetching opportunities for siteId ${auditData.siteId} failed with error: ${e.message}`);
    throw new Error(`Failed to fetch opportunities for siteId ${auditData.siteId}: ${e.message}`);
  }

  const { formVitals } = auditData.auditResult;
  log.debug(`scraped data for form ${JSON.stringify(scrapedData, null, 2)}`);
  const formOpportunities = generateOpptyData(formVitals, scrapedData, context);
  log.debug(`forms opportunities ${JSON.stringify(formOpportunities, null, 2)}`);
  const filteredOpportunities = filterForms(formOpportunities, scrapedData, log);
  log.info(`filtered opportunties high page views low form views for form ${JSON.stringify(filteredOpportunities, null, 2)}`);

  try {
    for (const opptyData of filteredOpportunities) {
      const opportunityData = {
        siteId: auditData.siteId,
        auditId: auditData.id ?? auditData.latestAuditId,
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

      log.info(`Forms Opportunity high page views low form views ${JSON.stringify(opportunityData, null, 2)}`);
      if (!highFormViewsLowConversionsOppty) {
        // eslint-disable-next-line no-await-in-loop
        highFormViewsLowConversionsOppty = await Opportunity.create(opportunityData);
        log.debug('Forms Opportunity created');
      } else {
        highFormViewsLowConversionsOppty.setAuditId(auditData.siteId);
        highFormViewsLowConversionsOppty.setData({
          ...highFormViewsLowConversionsOppty.getData(),
          ...opportunityData.data,
        });
        // eslint-disable-next-line no-await-in-loop
        await highFormViewsLowConversionsOppty.save();
      }
    }
  } catch (e) {
    log.error(`Creating Forms opportunity for siteId ${auditData.siteId} failed with error: ${e.message}`, e);
  }
  log.info(`Successfully synced Opportunity for site: ${auditData.siteId} and high-form-views-low-conversions audit type.`);
}
