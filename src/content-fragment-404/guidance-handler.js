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
    contentFragment404s, opportunityId,
  } = data;

  log.debug(`[Content Fragment 404 Guidance] Message received: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[Content Fragment 404 Guidance] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[Content Fragment 404 Guidance] No audit found for auditId: ${auditId}`);
    return notFound('Audit not found');
  }

  const { Opportunity } = dataAccess;
  const opportunity = await Opportunity.findById(opportunityId);

  if (!opportunity) {
    log.error(`[Content Fragment 404 Guidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  if (opportunity.getSiteId() !== siteId) {
    const errorMessage = `[Content Fragment 404 Guidance] Mismatch in Site ID. Expected: ${siteId}, but found: ${opportunity.getSiteId()}`;
    log.error(errorMessage);
    return badRequest('Site ID mismatch');
  }

  if (!contentFragment404s
    || !Array.isArray(contentFragment404s)
    || contentFragment404s.length === 0
  ) {
    const warningMessage = '[Content Fragment 404 Guidance] No content fragment 404s found in message';
    log.warn(warningMessage);
    return ok();
  }

  // Update each suggestion with enhanced AI reasoning
  await Promise.all(contentFragment404s.map(async (item) => {
    const suggestion = await Suggestion.findById(item.suggestionId);
    if (!suggestion) {
      log.error(`[Content Fragment 404 Guidance] Suggestion not found for ID: ${item.suggestionId}`);
      return {};
    }

    const suggestionData = suggestion.getData() || {};
    suggestion.setData({
      ...suggestionData,
      aiReason: item.aiReason || item.ai_reason,
    });

    log.debug(`[Content Fragment 404 Guidance] Updated suggestion ${item.suggestionId} with AI reason: ${item.aiReason || item.ai_reason}`);

    return suggestion.save();
  }));

  log.info(`[Content Fragment 404 Guidance] Successfully updated ${contentFragment404s.length} suggestions with enhanced AI reasoning`);

  return ok();
}
