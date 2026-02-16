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

import { ok, notFound, badRequest } from '@adobe/spacecat-shared-http-utils';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { OPPORTUNITY_TYPE } from './constants.js';

/**
 * Guidance handler for semantic value visibility.
 *
 * Receives Mystique's response with marketing image suggestions and:
 * - Creates/updates an opportunity for the site
 * - Syncs suggestions (add new, mark outdated)
 * - If no suggestions: removes stale opportunity if one existed
 *
 * @param {Object} message - SQS message from Mystique
 * @param {Object} context - Audit context with dataAccess, log, etc.
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity, Site } = dataAccess;
  const { siteId, auditId, data } = message;

  // Validate siteId
  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[semantic-value-visibility] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const suggestions = data?.suggestions || [];
  const url = data?.url || message.url;

  // Validate suggestions structure
  // Note: semanticHtml contains untrusted LLM-generated content from Mystique.
  // Downstream consumers must sanitize before rendering.
  if (!Array.isArray(suggestions)) {
    log.error(`[semantic-value-visibility] Invalid suggestions format for siteId: ${siteId}`);
    return badRequest('Suggestions must be an array');
  }

  const validSuggestions = suggestions.filter((s) => {
    const hasRequiredFields = s?.data?.imageUrl && s?.data?.semanticHtml;
    if (!hasRequiredFields) {
      log.warn('[semantic-value-visibility] Skipping suggestion with missing imageUrl or semanticHtml');
    }
    return hasRequiredFields;
  });

  log.info(`[semantic-value-visibility] Guidance handler received ${validSuggestions.length} valid suggestions for siteId: ${siteId}`);

  // No valid suggestions — handle stale opportunity
  if (validSuggestions.length === 0) {
    log.info(`[semantic-value-visibility] No marketing images found for siteId: ${siteId}`);

    // Check if there's an existing opportunity to clean up
    const existing = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    const staleOpportunity = existing.find(
      (oppty) => oppty.getType() === OPPORTUNITY_TYPE,
    );

    if (staleOpportunity) {
      log.info(`[semantic-value-visibility] Removing stale opportunity ${staleOpportunity.getId()} for siteId: ${siteId}`);
      staleOpportunity.setStatus('RESOLVED');
      staleOpportunity.setUpdatedBy('system');
      await staleOpportunity.save();
    }

    return ok();
  }

  // Create or update opportunity
  const auditData = { siteId, id: auditId };

  const opportunity = await convertToOpportunity(
    url,
    auditData,
    context,
    createOpportunityData,
    OPPORTUNITY_TYPE,
  );

  if (!opportunity) {
    log.error(`[semantic-value-visibility] Failed to create opportunity for siteId: ${siteId}`);
    return badRequest('Failed to create opportunity');
  }

  log.info(`[semantic-value-visibility] Opportunity ${opportunity.getId()} ready for siteId: ${siteId}`);

  // Sync suggestions — adds new ones, marks outdated ones
  await syncSuggestions({
    opportunity,
    newData: validSuggestions.map((s) => s.data),
    buildKey: (suggestionData) => suggestionData.imageUrl,
    mapNewSuggestion: (suggestionData) => ({
      opportunityId: opportunity.getId(),
      type: 'SUGGESTION_CODE',
      rank: 0,
      data: suggestionData,
    }),
    context,
  });

  log.info(`[semantic-value-visibility] Synced ${validSuggestions.length} suggestions for opportunity ${opportunity.getId()}`);

  return ok();
}
