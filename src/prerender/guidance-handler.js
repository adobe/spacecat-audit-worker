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

const AUDIT_TYPE = 'prerender';

/**
 * Handles Mystique responses for prerender guidance.
 *
 * Flow assumptions:
 * - The prerender audit flow (`src/prerender/handler.js`) has already created an
 *   Opportunity and persisted all prerender suggestions (URL, metrics, S3 keys, etc.).
 * - Audit Worker (via API service) sends a minimal message to Mystique:
 *     {
 *       type: "guidance:prerender",
 *       siteId,
 *       auditId,
 *       data: {
 *         opportunityId,
 *         suggestions: [
 *           { suggestionId, url, originalHtmlMarkdownKey, markdownDiffKey }
 *         ]
 *       }
 *     }
 * - Mystique responds on SQS with:
 *     {
 *       type: "guidance:prerender",
 *       siteId,
 *       auditId,
 *       data: {
 *         opportunityId,
 *         suggestions: [
 *           { suggestionId, url, aiSummary, valuable }
 *         ]
 *       }
 *     }
 *
 * This handler:
 * - Locates the existing prerender opportunity by `opportunityId`.
 * - Loads its existing suggestions.
 * - For each suggestion from Mystique, finds the matching existing suggestion
 *   (by URL) and updates only:
 *     - `aiSummary`
 *     - `valuable` (boolean flag indicating if prerender is worth doing)
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Audit, Site, Opportunity, Suggestion,
  } = dataAccess;
  const { siteId, auditId, data } = message;
  const { suggestions, opportunityId } = data || {};

  log.info(
    `[${AUDIT_TYPE}] Received Mystique guidance for prerender: ${JSON.stringify(
      message,
      null,
      2,
    )}`,
  );

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE}] No audit found for auditId: ${auditId}`);
    return notFound();
  }

  // Validate site exists
  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[${AUDIT_TYPE}] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  log.info(
    `[${AUDIT_TYPE}] Processing AI guidance for siteId=${siteId}, auditId=${auditId}, opportunityId=${opportunityId}`,
  );

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    log.warn(
      `[${AUDIT_TYPE}] No suggestions provided in Mystique response for siteId=${siteId}`,
    );
    return ok();
  }

  if (!opportunityId) {
    const msg = `[${AUDIT_TYPE}] Missing opportunityId in Mystique response for siteId=${siteId}, auditId=${auditId}`;
    log.error(msg);
    return badRequest(msg);
  }

  // Look up the existing prerender opportunity by ID
  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) {
    const msg = `[${AUDIT_TYPE}] Opportunity not found for opportunityId=${opportunityId}, siteId=${siteId}`;
    log.error(msg);
    return notFound('Opportunity not found');
  }

  // Load existing suggestions for this opportunity
  const existingSuggestions = await opportunity.getSuggestions();
  if (!existingSuggestions || existingSuggestions.length === 0) {
    log.warn(
      `[${AUDIT_TYPE}] No existing suggestions found for opportunityId=${opportunityId}, siteId=${siteId}`,
    );
    return ok();
  }

  // Filter out OUTDATED suggestions (stale data from previous audit runs)
  // Update all other suggestions regardless of status to enrich them with AI summaries
  const updateableSuggestions = existingSuggestions.filter((s) => {
    const status = s.getStatus?.();
    return status !== 'OUTDATED';
  });

  if (updateableSuggestions.length === 0) {
    log.info(
      `[${AUDIT_TYPE}] No updateable suggestions found (all are OUTDATED) for opportunityId=${opportunityId}, siteId=${siteId}`,
    );
    return ok();
  }

  log.info(
    `[${AUDIT_TYPE}] Found ${updateableSuggestions.length}/${existingSuggestions.length} updateable suggestions (excluding OUTDATED) for opportunityId=${opportunityId}`,
  );

  // Index updateable suggestions by URL for quick lookup
  const suggestionsByUrl = new Map();
  updateableSuggestions.forEach((s) => {
    const dataObj = s.getData?.() || {};
    if (dataObj.url) {
      suggestionsByUrl.set(dataObj.url, s);
    }
  });

  // Prepare updates for all suggestions
  const suggestionsToSave = [];

  suggestions.forEach((incoming) => {
    const { url, aiSummary, valuable } = incoming || {};

    if (!url) {
      log.warn(
        `[${AUDIT_TYPE}] Skipping Mystique suggestion without URL: ${JSON.stringify(
          incoming,
        )}`,
      );
      return;
    }

    const existing = suggestionsByUrl.get(url);
    if (!existing) {
      log.warn(
        `[${AUDIT_TYPE}] No existing suggestion found for URL=${url} on opportunityId=${opportunityId}`,
      );
      return;
    }

    const currentData = existing.getData?.() || {};
    const updatedData = {
      ...currentData,
      aiSummary: aiSummary || '',
      // Default to true if not provided, but respect explicit boolean from Mystique
      valuable: typeof valuable === 'boolean' ? valuable : true,
    };

    existing.setData(updatedData);
    suggestionsToSave.push(existing);
  });

  // Batch save all suggestions using DynamoDB batch write
  if (suggestionsToSave.length > 0) {
    try {
      // eslint-disable-next-line no-underscore-dangle
      await Suggestion._saveMany(suggestionsToSave);

      log.info(
        `[${AUDIT_TYPE}] Successfully batch updated ${suggestionsToSave.length}/${suggestions.length} suggestions with AI summaries for opportunityId=${opportunityId}, siteId=${siteId}`,
      );
    } catch (error) {
      log.error(
        `[${AUDIT_TYPE}] Error batch saving suggestions: ${error.message}`,
      );
    }
  } else {
    log.warn(
      `[${AUDIT_TYPE}] No valid suggestions to update for opportunityId=${opportunityId}, siteId=${siteId}`,
    );
  }

  return ok();
}
