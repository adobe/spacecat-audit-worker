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
import { toPathOnly } from './utils.js';

/**
 * Handles Mystique responses for LLM error pages and persists AI enrichment
 * directly to DB Suggestions.
 *
 * Replaces the legacy Excel/SharePoint read-modify-write with a DB update:
 * each brokenLink in the Mystique response is matched to an existing Suggestion
 * by URL, then suggestedUrls, aiRationale, and confidenceScore are written back
 * via Suggestion.saveMany() in a single bulk operation.
 *
 * @param {Object} message - Message from Mystique containing AI guidance
 * @param {Object} context - Lambda context with dataAccess and logger
 * @returns {Promise<Response>} HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Audit, Opportunity, Suggestion,
  } = dataAccess;
  const { siteId, auditId, data } = message;
  const { brokenLinks = [], opportunityId } = data;

  log.debug(`[LLM-ERROR-PAGES] Guidance handler received message: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[LLM-ERROR-PAGES] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[LLM-ERROR-PAGES] No audit found for auditId: ${auditId}`);
    return notFound('Audit not found');
  }

  if (!opportunityId) {
    log.error('[LLM-ERROR-PAGES] No opportunityId provided in Mystique message');
    return badRequest('Missing opportunityId');
  }

  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) {
    log.error(`[LLM-ERROR-PAGES] Opportunity not found for opportunityId: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  const existingSuggestions = await opportunity.getSuggestions();
  const baseUrl = site.getBaseURL?.() || '';

  // Build a path → Suggestion map for O(1) lookup.
  // Suggestions store their URL as a full URL in data.url; normalise to path-only
  // so it matches the path-only urlTo values returned by Mystique.
  const suggestionByPath = new Map(
    existingSuggestions.map((s) => [toPathOnly(s.getData()?.url, baseUrl), s]),
  );

  const toUpdate = [];

  for (const brokenLink of brokenLinks) {
    const {
      urlTo, suggestedUrls, aiRationale, confidenceScore,
    } = brokenLink;

    if (!suggestedUrls || suggestedUrls.length === 0) {
      log.warn(`[LLM-ERROR-PAGES] No suggested URLs returned by Mystique for: ${urlTo}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    const path = toPathOnly(urlTo, baseUrl);
    const suggestion = suggestionByPath.get(path);

    if (!suggestion) {
      log.info(`[LLM-ERROR-PAGES] No matching DB suggestion found for URL: ${urlTo} — skipping`);
      // eslint-disable-next-line no-continue
      continue;
    }

    suggestion.setData({
      ...suggestion.getData(),
      suggestedUrls,
      aiRationale: aiRationale || '',
      ...(confidenceScore !== undefined && { confidenceScore }),
    });

    toUpdate.push(suggestion);
    log.debug(`[LLM-ERROR-PAGES] Queued AI enrichment for suggestion: ${path} (${suggestedUrls.length} suggested URLs)`);
  }

  if (toUpdate.length === 0) {
    log.warn('[LLM-ERROR-PAGES] No suggestions matched Mystique response — nothing persisted');
    return ok();
  }

  await Suggestion.saveMany(toUpdate);
  log.info(`[LLM-ERROR-PAGES] Persisted Mystique AI enrichment for ${toUpdate.length} / ${brokenLinks.length} suggestions (opportunityId: ${opportunityId})`);

  return ok();
}
