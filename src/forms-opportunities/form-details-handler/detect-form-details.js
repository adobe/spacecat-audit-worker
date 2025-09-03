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
import { sendMessageToMystiqueForGuidance } from '../utils.js';

export default async function handler(message, context) {
  const {
    log, dataAccess,
  } = context;
  const { Opportunity } = dataAccess;
  const { data } = message;
  log.info(`Message received in form details handler: ${JSON.stringify(message, null, 2)}`);
  const {
    form_details: formDetails, auditId: id,
  } = data;

  const opportunity = await Opportunity.findById(id);
  if (opportunity) {
    log.info(`Opportunity found: ${JSON.stringify(opportunity)}`);
    if (opportunity.getType() === 'forms-accessibility') {
      const opportunityData = opportunity.getData();
      const updatedAccessibility = opportunityData.accessibility.map((item) => {
        // eslint-disable-next-line max-len
        const matchingFormDetail = formDetails.find((detail) => detail.url === item.form && detail.form_source === item.formSource);
        if (matchingFormDetail) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars,camelcase
          const { url, form_source, ...cleanedFormDetail } = matchingFormDetail;
          return { ...item, formDetails: cleanedFormDetail };
        }
        return item;
      });
      opportunity.setData({
        accessibility: updatedAccessibility,
      });
    } else {
      const opportunityData = opportunity.getData();
      // eslint-disable-next-line max-len
      const matchingFormDetail = formDetails.find((detail) => detail.url === opportunityData.form && detail.form_source === opportunityData.formsource);
      if (matchingFormDetail) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars,camelcase
        const { form, form_source, ...cleanedFormDetail } = matchingFormDetail;
        opportunity.setData({
          ...opportunityData,
          formDetails: cleanedFormDetail,
        });
      }
    }

    opportunity.setUpdatedBy('system');
    // eslint-disable-next-line no-await-in-loop
    await opportunity.save();
    log.info(`Updated opportunity: ${JSON.stringify(opportunity, null, 2)}`);
    await sendMessageToMystiqueForGuidance(context, opportunity);
  }
  return ok();
}
