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
 * Handles Mystique responses for LLM error pages and writes AI suggestions back to DB.
 *
 * Mystique calls this handler with a list of brokenLinks, each carrying the 404 URL
 * (urlTo), a ranked list of candidate redirects (suggestedUrls), a human-readable
 * rationale (aiRationale), and an optional confidence score (confidenceScore).
 *
 * The handler looks up the Opportunity identified by opportunityId, fetches its
 * existing Suggestions, matches each brokenLink by URL path, and updates the matched
 * Suggestion's data in a single bulk write.
 *
 * @param {Object} message - SQS message from Mystique.
 * @param {Object} context - Lambda context with dataAccess and log.
 * @returns {Promise<Response>}
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Audit, Opportunity, Suggestion,
  } = dataAccess;
  const { siteId, auditId, data } = message;
  const { brokenLinks = [], opportunityId } = data;

  log.debug(`[LLM-ERROR-PAGES] Guidance handler received message for site ${siteId}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[LLM-ERROR-PAGES] Site not found: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[LLM-ERROR-PAGES] Audit not found: ${auditId}`);
    return notFound('Audit not found');
  }

  if (!opportunityId) {
    log.error('[LLM-ERROR-PAGES] Missing opportunityId in Mystique message');
    return badRequest('Missing opportunityId');
  }

  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) {
    log.warn(`[LLM-ERROR-PAGES] Opportunity not found: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  const existingSuggestions = await opportunity.getSuggestions();
  const baseUrl = site.getBaseURL ? site.getBaseURL() : '';

  // Index suggestions by their URL path for O(1) lookup during the brokenLinks loop.
  const suggestionByPath = new Map(
    existingSuggestions.map((s) => [toPathOnly(s.getData()?.url, baseUrl), s]),
  );

  const toUpdate = [];
  for (const brokenLink of brokenLinks) {
    const {
      urlTo, suggestedUrls, aiRationale, confidenceScore,
    } = brokenLink;

    if (!suggestedUrls || suggestedUrls.length === 0) {
      log.warn(`[LLM-ERROR-PAGES] No suggested URLs returned by Mystique for ${urlTo}`);
      continue;
    }

    const path = toPathOnly(urlTo, baseUrl);
    const suggestion = suggestionByPath.get(path);
    if (!suggestion) {
      log.info(`[LLM-ERROR-PAGES] No existing suggestion matched Mystique URL: ${path}`);
      continue;
    }

    suggestion.setData({
      ...suggestion.getData(),
      suggestedUrls,
      aiRationale: aiRationale || '',
      ...(confidenceScore !== undefined && { confidenceScore }),
    });
    toUpdate.push(suggestion);
  }

  if (toUpdate.length === 0) {
    log.warn('[LLM-ERROR-PAGES] No suggestions matched Mystique response — nothing persisted');
    return ok();
  }

  await Suggestion.saveMany(toUpdate);
  log.info(`[LLM-ERROR-PAGES] Persisted Mystique AI enrichment for ${toUpdate.length} / ${brokenLinks.length} suggestions`);
  return ok();
}
