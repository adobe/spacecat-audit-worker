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
  const { log, dataAccess } = context;
  const { auditId, siteId, data } = message;
  const { opportunityId, a11y: a11yGuidanceOfIssues } = data;
  const { Opportunity } = dataAccess;
  log.info(`Message received in accessibility guidance handler: ${JSON.stringify(message, null, 2)}`);
  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) {
    log.error(`[Form Opportunity] [Site Id: ${siteId}] A11y opportunity not found`);
    return ok();
  }
  const a11yData = opportunity.getData().accessibility;
  a11yGuidanceOfIssues.forEach((a11y) => {
    const { form, formSource, a11yIssues } = a11y;
    const formA11yData = a11yData.find(
      (a11yIssue) => a11yIssue.form === form && a11yIssue.formSource === formSource,
    );
    const mergedA11yIssues = [...formA11yData.a11yIssues];
    a11yIssues.forEach((a11yIssue, index) => {
      if (mergedA11yIssues.length > index) {
        mergedA11yIssues[index] = {
          ...mergedA11yIssues[index],
          ...a11yIssue,
        };
      }
    });
    // update the a11yIssues with the guidance
    formA11yData.a11yIssues = mergedA11yIssues;
  });
  opportunity.setUpdatedBy('system');
  opportunity.setAuditId(auditId);
  opportunity.setData({
    ...opportunity.getData(),
    accessibility: a11yData,
  });
  await opportunity.save();
  log.info(`[Form Opportunity] [Site Id: ${siteId}] A11y opportunity updated with guidance`);
  return ok();
}
