/*
 * Copyright 2026 Adobe. All rights reserved.
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

/**
 * Mystique's guidance:table-of-contents reply carries prompts keyed by page URL, not by
 * suggestionId (the outbound TocSuggestionData/TocOpportunityData models on the Mystique side
 * don't round-trip an id). A single URL can have more than one TOC suggestion (one per
 * checkType, e.g. "missing-toc" and "single-heading" on the same page) — since the generated
 * prompts are grounded in the page's headings rather than the checkType, it's correct to apply
 * the same prompt set to every non-terminal suggestion for that URL.
 * @param {Array<Object>} suggestions - Existing Suggestion entities for the opportunity
 * @param {Object} Suggestion - The Suggestion data-access collection (for STATUSES)
 * @returns {Map<string, Array<Object>>} URL -> matching, non-terminal suggestion entities
 */
function groupEligibleSuggestionsByUrl(suggestions, Suggestion) {
  const byUrl = new Map();
  suggestions.forEach((suggestion) => {
    const status = suggestion.getStatus();
    if (
      status === Suggestion.STATUSES.FIXED
      || status === Suggestion.STATUSES.OUTDATED
      || status === Suggestion.STATUSES.SKIPPED
    ) {
      return;
    }
    const { url } = suggestion.getData() || {};
    if (!url) {
      return;
    }
    if (!byUrl.has(url)) {
      byUrl.set(url, []);
    }
    byUrl.get(url).push(suggestion);
  });
  return byUrl;
}

/**
 * Handles the Mystique guidance:table-of-contents callback and persists the generated
 * Impact Engine prompts back onto their matching TOC suggestions.
 * @param {Object} message - Message from Mystique with generated prompts
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Audit, Opportunity, Suggestion,
  } = dataAccess;
  const { siteId, auditId, data } = message;
  const { opportunityId, suggestions } = data || {};

  log.debug(`[TOC Guidance] Message received in TOC guidance handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[TOC Guidance] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[TOC Guidance] No audit found for auditId: ${auditId}`);
    return notFound();
  }

  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) {
    log.error(`[TOC Guidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  if (opportunity.getSiteId() !== siteId) {
    log.error(`[TOC Guidance] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`);
    return badRequest('Site ID mismatch');
  }

  if (!suggestions || !Array.isArray(suggestions)) {
    log.error(`[TOC Guidance] Invalid suggestions format. Expected array, got: ${typeof suggestions}. Message: ${JSON.stringify(message)}`);
    return badRequest('Invalid suggestions format');
  }

  if (suggestions.length === 0) {
    log.info('[TOC Guidance] No suggestions provided in Mystique response');
    return ok();
  }

  const existingSuggestions = await opportunity.getSuggestions();
  const eligibleByUrl = groupEligibleSuggestionsByUrl(existingSuggestions || [], Suggestion);

  const toSave = [];
  suggestions.forEach((promptResult) => {
    const { url, prompts, hasPrompts } = promptResult;
    const matches = eligibleByUrl.get(url);

    if (!matches || matches.length === 0) {
      log.warn(`[TOC Guidance] No matching suggestion found for URL: ${url}`);
      return;
    }

    const promptsArray = Array.isArray(prompts) ? prompts : [];

    matches.forEach((suggestion) => {
      const updatedData = {
        ...suggestion.getData(),
        prompts: promptsArray,
        hasPrompts: !!hasPrompts || promptsArray.length > 0,
      };
      suggestion.setData(updatedData);
      toSave.push(suggestion);
    });
  });

  if (toSave.length > 0) {
    await Suggestion.saveMany(toSave);
  }

  log.info(`[TOC Guidance] Successfully updated ${toSave.length} suggestion(s) with Mystique prompts for opportunityId=${opportunityId}`);
  return ok();
}
