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
import { filterBrokenSuggestedUrls } from '../utils/url-utils.js';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Suggestion, Site } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    brokenLinks, opportunityId,
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
    log.error(`[Broken Links Guidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[${opportunity.getType()} Guidance] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  await Promise.all(brokenLinks.map(async (brokenLink) => {
    const suggestion = await Suggestion.findById(brokenLink.suggestionId);
    if (!suggestion) {
      log.error(`[${opportunity.getType()}] Suggestion not found for ID: ${brokenLink.suggestionId}`);
      return {};
    }
    const filteredSuggestedUrls = await filterBrokenSuggestedUrls(
      brokenLink.suggestedUrls,
      site.getBaseURL(),
    );
    suggestion.setData({
      ...suggestion.getData(),
      urlsSuggested: filteredSuggestedUrls,
      aiRationale: brokenLink.aiRationale,
    });

    return suggestion.save();
  }));

  return ok();
}
