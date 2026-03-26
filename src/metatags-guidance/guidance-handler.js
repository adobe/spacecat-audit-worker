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
import { warnOnInvalidSuggestionData } from '../utils/data-access.js';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Suggestion, Site } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    suggestions, opportunityId,
  } = data;
  log.debug(`Message received in metatags suggestion handler: ${JSON.stringify(message, null, 2)}`);

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
    log.error(`[Metatags Guidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[${opportunity.getType()} Guidance] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  // Validate suggestions array
  if (!suggestions || !Array.isArray(suggestions)) {
    log.error(`[${opportunity.getType()} Guidance] Invalid suggestions format. Expected array, got: ${typeof suggestions}. Message: ${JSON.stringify(message)}`);
    return badRequest('Invalid suggestions format');
  }

  if (suggestions.length === 0) {
    log.info(`[${opportunity.getType()} Guidance] No suggestions provided in Mystique response`);
    return ok();
  }

  // Batch-fetch all suggestions in a single query instead of N individual findById calls
  const suggestionIds = suggestions
    .map((s) => s.suggestionId)
    .filter(Boolean);

  const { data: existingSuggestions = [] } = suggestionIds.length > 0
    ? await Suggestion.batchGetByKeys(suggestionIds.map((id) => ({ suggestionId: id })))
    : { data: [] };

  const suggestionMap = new Map(existingSuggestions.map((s) => [s.getId(), s]));

  const toSave = [];
  for (const suggestionUpdate of suggestions) {
    const suggestion = suggestionMap.get(suggestionUpdate.suggestionId);
    if (!suggestion) {
      log.error(`[${opportunity.getType()}] Suggestion not found for ID: ${suggestionUpdate.suggestionId}`);
    } else {
      const { aiSuggestion, aiRationale } = suggestionUpdate;

      // Validate that we have both suggestion and rationale
      if (!aiSuggestion || !aiRationale) {
        log.warn(
          `[${opportunity.getType()}] Incomplete data for suggestion ${suggestionUpdate.suggestionId}. `
          + `aiSuggestion: ${!!aiSuggestion}, aiRationale: ${!!aiRationale}`,
        );
      }

      const updatedData = {
        ...suggestion.getData(),
        aiSuggestion: aiSuggestion || '',
        aiRationale: aiRationale || '',
      };
      warnOnInvalidSuggestionData(updatedData, opportunity.getType(), log);
      suggestion.setData(updatedData);
      toSave.push(suggestion);
    }
  }

  if (toSave.length > 0) {
    await Suggestion.saveMany(toSave);
  }

  log.info(`[${opportunity.getType()} Guidance] Successfully updated ${suggestions.length} suggestions`);
  return ok();
}
