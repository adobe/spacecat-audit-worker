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
import { FORM_OPPORTUNITY_TYPES } from '../constants.js';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;
  const { auditId, siteId, data } = message;
  log.info(`Message received in quality handler: ${JSON.stringify(message, null, 2)}`);
  const { url, form_source: formsource, form_quality_metrics: formQualityMetrics } = data;

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  // eslint-disable-next-line max-len
  const opportunities = existingOpportunities.filter((oppty) => Object.values(FORM_OPPORTUNITY_TYPES).includes(oppty.getType())
          && oppty.getData()?.form === url
          && (!formsource || oppty.getData()?.formsource === formsource));

  if (opportunities.length > 0) {
    log.info(`Found ${opportunities.length} existing opportunities for page: ${url}. Updating each with new data.`);

    for (const opportunity of opportunities) {
      opportunity.setAuditId(auditId);
      opportunity.setUpdatedBy('system');
      opportunity.setData({
        ...opportunity.getData(),
        ...formQualityMetrics,
      });

      // eslint-disable-next-line no-await-in-loop
      await opportunity.save();
      log.info(`Updated opportunity: ${JSON.stringify(opportunity, null, 2)}`);
    }
  }

  return ok();
}
