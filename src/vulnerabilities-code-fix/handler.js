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
    opportunityId, patches,
  } = data;
  const AUDIT_TYPE = 'security-vulnerabilities'; // TODO: don't hardcode this
  log.debug(`[${AUDIT_TYPE} Code-Fix] Message received in vulnerabilities code-fix handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${siteId}] Site not found`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE} Code-Fix] [Site: ${site.getId()}] No audit found for auditId: ${auditId}`);
    return notFound('Audit not found');
  }
  const { Opportunity } = dataAccess;
  const opportunity = await Opportunity.findById(opportunityId);

  if (!opportunity) {
    log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${site.getId()}] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[${AUDIT_TYPE} Code-Fix] [Opportunity: ${opportunityId}] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  await Promise.all(patches.map(async (patch) => {
    const suggestion = await Suggestion.findById(patch.suggestionId);
    if (!suggestion) {
      log.error(`[${AUDIT_TYPE} Code-Fix] [Site: ${site.getId()}] Suggestion not found for ID: ${patch.suggestionId}`);
      return {};
    }
    suggestion.setData({
      ...suggestion.getData(),
      // TODO: add patch content
    });

    return suggestion.save();
  }));

  return ok();
}
