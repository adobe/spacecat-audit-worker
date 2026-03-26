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
import { isValidUrl } from '@adobe/spacecat-shared-utils';
import { filterBrokenSuggestedUrls } from '../utils/url-utils.js';
import { warnOnInvalidSuggestionData } from '../utils/data-access.js';

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

  // Batch-fetch all suggestions in a single query instead of N individual findById calls
  const suggestionIds = brokenLinks
    .map((bl) => bl.suggestionId)
    .filter(Boolean);

  const { data: existingSuggestions = [] } = suggestionIds.length > 0
    ? await Suggestion.batchGetByKeys(suggestionIds.map((id) => ({ suggestionId: id })))
    : { data: [] };

  const suggestionMap = new Map(existingSuggestions.map((s) => [s.getId(), s]));

  // Filter and validate suggested URLs configured for the site
  const overrideBaseURL = site.getConfig()?.getFetchConfig()?.overrideBaseURL;
  const effectiveBaseURL = (overrideBaseURL && isValidUrl(overrideBaseURL))
    ? overrideBaseURL
    : site.getBaseURL();

  const toSave = [];
  // Process each broken link (URL filtering is async but not a DB call)
  await Promise.all(brokenLinks.map(async (brokenLink) => {
    const suggestion = suggestionMap.get(brokenLink.suggestionId);
    if (!suggestion) {
      log.error(`[${opportunity.getType()}] Suggestion not found for ID: ${brokenLink.suggestionId}`);
      return;
    }

    const suggestedUrls = brokenLink.suggestedUrls || [];

    // Validate that suggestedUrls is an array
    if (!Array.isArray(suggestedUrls)) {
      log.info(
        `[${opportunity.getType()}] Invalid suggestedUrls format for suggestion ${brokenLink.suggestionId}. `
        + `Expected array, got: ${typeof suggestedUrls}. Available fields: ${Object.keys(brokenLink).join(', ')}`,
      );
    }

    const validSuggestedUrls = Array.isArray(suggestedUrls) ? suggestedUrls : [];
    const filteredSuggestedUrls = await filterBrokenSuggestedUrls(
      validSuggestedUrls,
      effectiveBaseURL,
    );
    const existingData = suggestion.getData() || {};
    const existingSuggestedUrls = Array.isArray(existingData.urlsSuggested)
      ? existingData.urlsSuggested.filter(Boolean)
      : [];
    let nextSuggestedUrls = filteredSuggestedUrls;
    if (nextSuggestedUrls.length === 0) {
      nextSuggestedUrls = existingSuggestedUrls.length > 0
        ? existingSuggestedUrls
        : [effectiveBaseURL];
    }

    // Handle AI rationale - clear it if all URLs were filtered out
    // This prevents showing rationale for URLs that don't exist
    let aiRationale = brokenLink.aiRationale || '';
    if (filteredSuggestedUrls.length === 0 && validSuggestedUrls.length > 0) {
      // All URLs were filtered out (likely invalid/broken), clear rationale
      log.info('All the suggested URLs were filtered out');
      aiRationale = existingSuggestedUrls.length > 0 ? existingData.aiRationale || '' : '';
    } else if (filteredSuggestedUrls.length === 0 && validSuggestedUrls.length === 0) {
      // No URLs were provided by Mystique, clear rationale
      log.info('No suggested URLs provided by Mystique');
      aiRationale = existingSuggestedUrls.length > 0 ? existingData.aiRationale || '' : '';
    }

    const updatedData = {
      ...existingData,
      urlsSuggested: nextSuggestedUrls,
      aiRationale,
    };
    warnOnInvalidSuggestionData(updatedData, opportunity.getType(), log);
    suggestion.setData(updatedData);
    toSave.push(suggestion);
  }));

  if (toSave.length > 0) {
    await Suggestion.saveMany(toSave);
  }

  return ok();
}
