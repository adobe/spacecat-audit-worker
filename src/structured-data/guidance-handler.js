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

import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Suggestion, Site } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    suggestionId, opportunityId, remediations,
  } = data;
  log.info(`Message received in broken-links suggestion handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const { Opportunity } = dataAccess;
  const opportunity = await Opportunity.findById(opportunityId);

  if (!opportunity) {
    log.error(`[Structured Data Guidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[${opportunity.getType()} Guidance] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  const suggestion = await Suggestion.findById(suggestionId);
  if (!suggestion) {
    log.error(`Suggestion not found for suggestionId: ${suggestionId}`);
    return notFound('Suggestion not found');
  }

  suggestion.setData({
    ...suggestion.getData(),
    errors: remediations.map((remediation) => (
      {
        aiRationale: remediation.ai_rationale,
        id: remediation.id,
        errorTitle: remediation.error_title,
        fix: remediation.corrected_markup,
      })),
  });
  await suggestion.save();
  return ok();
}
