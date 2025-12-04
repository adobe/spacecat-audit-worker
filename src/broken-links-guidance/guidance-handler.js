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
  log.debug(`Message received in broken-links suggestion handler: ${JSON.stringify(message, null, 2)}`);

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

  // Validate brokenLinks array
  if (!brokenLinks || !Array.isArray(brokenLinks)) {
    log.error(`[${opportunity.getType()} Guidance] Invalid brokenLinks format. Expected array, got: ${typeof brokenLinks}. Message: ${JSON.stringify(message)}`);
    return badRequest('Invalid brokenLinks format');
  }

  if (brokenLinks.length === 0) {
    log.info(`[${opportunity.getType()} Guidance] No broken links provided in Mystique response`);
    return ok();
  }

  await Promise.all(brokenLinks.map(async (brokenLink) => {
    const suggestion = await Suggestion.findById(brokenLink.suggestionId);
    if (!suggestion) {
      log.error(`[${opportunity.getType()}] Suggestion not found for ID: ${brokenLink.suggestionId}`);
      return {};
    }

    const suggestedUrls = brokenLink.suggestedUrls || [];

    // Validate that suggestedUrls is an array
    if (!Array.isArray(suggestedUrls)) {
      log.info(
        `[${opportunity.getType()}] Invalid suggestedUrls format for suggestion ${brokenLink.suggestionId}. `
        + `Expected array, got: ${typeof suggestedUrls}. Available fields: ${Object.keys(brokenLink).join(', ')}`,
      );
    }

    // Filter and validate suggested URLs
    const validSuggestedUrls = Array.isArray(suggestedUrls) ? suggestedUrls : [];

    // Use overrideBaseURL if configured
    const overrideBaseURL = site.getConfig()?.getFetchConfig()?.overrideBaseURL;
    const baseURL = overrideBaseURL || site.getBaseURL();

    const filteredSuggestedUrls = await filterBrokenSuggestedUrls(
      validSuggestedUrls,
      baseURL,
      log,
    );

    // Handle AI rationale - clear it if all URLs were filtered out
    // This prevents showing rationale for URLs that don't exist
    let aiRationale = brokenLink.aiRationale || '';
    if (filteredSuggestedUrls.length === 0 && validSuggestedUrls.length > 0) {
      // All URLs were filtered out (likely invalid/broken), clear rationale
      log.info(`[Broken Links Guidance] All ${validSuggestedUrls.length} suggested URLs were filtered out for suggestion ${brokenLink.suggestionId}. Clearing AI rationale.`);
      aiRationale = '';
    } else if (filteredSuggestedUrls.length === 0 && validSuggestedUrls.length === 0) {
      // No URLs were provided by Mystique, clear rationale
      log.info(`[Broken Links Guidance] No suggested URLs provided by Mystique for suggestion ${brokenLink.suggestionId}`);
      aiRationale = '';
    }

    suggestion.setData({
      ...suggestion.getData(),
      urlsSuggested: filteredSuggestedUrls,
      aiRationale,
    });

    return suggestion.save();
  }));

  return ok();
}
