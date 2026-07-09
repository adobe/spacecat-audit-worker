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

import { notFound, ok } from '@adobe/spacecat-shared-http-utils';
import {
  toPathOnly,
} from './utils.js';
import { filterOutConfirmedBrokenUrls } from './url-health-check.js';

/**
 * Handles Mystique responses for LLM error pages and updates suggestions with AI data
 * @param {Object} message - Message from Mystique with AI suggestions
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Audit, Opportunity, Suggestion,
  } = dataAccess;
  const { siteId, data, auditId } = message;
  const { brokenLinks: incomingBrokenLinks, opportunityId } = data;

  log.debug(`Message received in LLM error pages guidance handler: ${JSON.stringify(message, null, 2)}`);

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

  // Defence-in-depth: HEAD-check Mystique's suggested URLs and drop any that
  // resolve to 4xx/5xx on the live site (Mystique's locale_filtered_urls pool
  // is not verified end-to-end). When the filter empties a link's suggestion
  // list, also blank its aiRationale so the row stays internally consistent —
  // the rationale text references URLs that no longer survive the check.
  const incoming = Array.isArray(incomingBrokenLinks) ? incomingBrokenLinks : [];
  const allSuggestedUrls = Array.from(new Set(
    incoming.flatMap((l) => (Array.isArray(l.suggestedUrls) ? l.suggestedUrls : [])),
  ));
  const reachable = new Set(await filterOutConfirmedBrokenUrls(allSuggestedUrls, log));
  let droppedCount = 0;
  const brokenLinks = incoming.map((link) => {
    const original = Array.isArray(link.suggestedUrls) ? link.suggestedUrls : [];
    const filtered = original.filter((u) => reachable.has(u));
    droppedCount += original.length - filtered.length;
    // When all picks were dropped, blank the rationale: it references URLs that
    // didn't survive the HEAD check and would otherwise read as orphaned prose.
    const aiRationale = filtered.length === 0 ? '' : (link.aiRationale ?? '');
    return { ...link, suggestedUrls: filtered, aiRationale };
  });
  if (droppedCount > 0) {
    log.info(`[LLM-ERROR-PAGES] Dropped ${droppedCount} suggested URL(s) that failed HEAD check`);
  }
  // Structured summary line — dashboard query target. Emitted regardless of
  // whether any URLs were dropped so the absence of drops is also observable.
  // Passed as structured metadata (second arg) so Coralogix/CloudWatch can
  // index the counters as native fields rather than re-parsing a JSON string.
  log.info('[LLM-ERROR-PAGES] head-check-summary', {
    siteId,
    total: allSuggestedUrls.length,
    kept: reachable.size,
    dropped: droppedCount,
  });

  try {
    if (!opportunityId) {
      log.warn('[LLM-ERROR-PAGES] No opportunityId in Mystique message — skipping DB update');
    } else {
      const opportunity = await Opportunity.findById(opportunityId);
      if (!opportunity) {
        log.warn(`[LLM-ERROR-PAGES] Opportunity not found: ${opportunityId}`);
      } else if (opportunity.getSiteId?.() !== siteId) {
        log.warn('[LLM-ERROR-PAGES] Opportunity siteId mismatch — skipping DB update', {
          opportunityId,
          messageSiteId: siteId,
          opportunitySiteId: opportunity.getSiteId?.(),
        });
      } else {
        const existingSuggestions = await opportunity.getSuggestions();
        const baseUrl = site.getBaseURL();
        const suggestionByPath = new Map(
          existingSuggestions.map((s) => [toPathOnly(s.getData()?.url, baseUrl), s]),
        );

        // Note: we intentionally do NOT gate on `suggestedUrls.length` here.
        // Empty-suggestion rows are still persisted so the opportunity stays
        // complete. The HEAD-check above already cleared the rationale on those
        // rows, so what lands in the DB stays internally consistent.
        const toUpdate = brokenLinks.reduce((acc, link) => {
          const {
            urlTo, suggestedUrls, aiRationale, confidenceScore,
          } = link;
          const path = toPathOnly(urlTo, baseUrl);
          const suggestion = suggestionByPath.get(path);
          if (!suggestion) {
            return acc;
          }
          suggestion.setData({
            ...suggestion.getData(),
            // suggestedUrls is normalized to an array by the HEAD-check pass.
            suggestedUrls,
            aiRationale: aiRationale || '',
            ...(confidenceScore !== undefined && { confidenceScore }),
          });
          acc.push(suggestion);
          return acc;
        }, []);

        if (toUpdate.length > 0) {
          await Suggestion.saveMany(toUpdate);
          log.info(`[LLM-ERROR-PAGES] Persisted Mystique enrichment for ${toUpdate.length} suggestions`);
        }
      }
    }
  } catch (e) {
    log.error('[LLM-ERROR-PAGES] DB guidance update failed', {
      err: e.message,
      stack: e.stack,
      siteId,
      opportunityId,
    });
  }

  return ok();
}
