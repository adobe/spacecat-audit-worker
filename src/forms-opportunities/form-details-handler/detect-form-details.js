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

import { ok } from '@adobe/spacecat-shared-http-utils';

export default async function handler(message, context) {
  const {
    log, dataAccess, sqs, env,
  } = context;
  const { Opportunity } = dataAccess;
  const { siteId, data } = message;
  log.info(`Message received in form details handler: ${JSON.stringify(message, null, 2)}`);
  const {
    url, form_source: formsource, form_details: formDetails,
  } = data;

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  // eslint-disable-next-line max-len
  const opportunity = existingOpportunities.find((oppty) => oppty.getData()?.form === url && (!formsource || oppty.getData()?.formsource === formsource));

  if (opportunity) {
    log.info(`Opportunity found: ${JSON.stringify(opportunity)}`);
    opportunity.setUpdatedBy('system');
    opportunity.setData({
      ...opportunity.getData(),
      formDetails,
    });

    // eslint-disable-next-line no-await-in-loop
    await opportunity.save();
    log.info(`Updated opportunity: ${JSON.stringify(opportunity, null, 2)}`);

    const opptyData = JSON.parse(JSON.stringify(opportunity));
    // sending message to mystique for guidance
    log.info('sending message to mystique');
    const mystiqueMessage = {
      type: `guidance:${opptyData.type}`,
      siteId: opptyData.siteId,
      auditId: opptyData.auditId,
      time: new Date().toISOString(),
      // keys inside data should follow snake case and outside should follow camel case
      data: {
        url: opptyData.data?.form || '',
        cr: opptyData.data?.trackedFormKPIValue || 0,
        metrics: opptyData.data?.metrics || {},
        cta_source: opptyData.data?.formNavigation?.source || '',
        cta_text: opptyData.data?.formNavigation?.text || '',
        form_source: opptyData.data?.formsource || '',
        form_details: opptyData.data?.formDetails,
        page_views: opptyData.data?.pageViews,
        form_views: opptyData.data?.formViews,
        form_navigation: {
          url: opptyData.data?.formNavigation?.url || '',
          source: opptyData.data?.formNavigation?.source || '',
          cta_clicks: opptyData.data?.formNavigation?.clicksOnCTA || 0,
          page_views: opptyData.data?.formNavigation?.pageViews || 0,
        },
      },
    };

    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
    log.info(`forms opportunity sent to mystique for guidance: ${JSON.stringify(mystiqueMessage)}`);
  }

  return ok();
}
