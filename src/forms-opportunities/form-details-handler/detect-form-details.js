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
      ...formDetails,
    });

    // eslint-disable-next-line no-await-in-loop
    await opportunity.save();
    log.info(`Updated opportunity: ${JSON.stringify(opportunity, null, 2)}`);

    // sending message to mystique for guidance
    log.info('sending message to mystique');
    const mystiqueMessage = {
      type: `guidance:${opportunity.getType()}`,
      siteId: opportunity.getSiteId(),
      auditId: opportunity.getAuditId(),
      deliveryType: opportunity.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        url: opportunity.data?.form || '',
        cr: opportunity.data?.trackedFormKPIValue || 0,
        metrics: opportunity.data?.metrics || {},
        cta_source: opportunity.data?.formNavigation?.source || '',
        cta_text: opportunity.data?.formNavigation?.text || '',
        form_source: opportunity.data?.formsource || '',
      },
    };

    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
    log.info(`forms opportunity sent to mystique for guidance: ${JSON.stringify(mystiqueMessage)}`);
  }

  return ok();
}
