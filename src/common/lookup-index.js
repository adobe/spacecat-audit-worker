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

import { syncUrlIndex, syncUrlIndexMany } from '@adobe/spacecat-shared-data-access';
import {
  REASON, failure, resolvePostgrestClient, sanitizeUrls,
} from './lookup-index-utils.js';

export { REASON };

/**
 * Shared Lookup Service write-side foundation for opportunity owners in this repo.
 * Any opportunity type can call these two functions from its own persist path to keep
 * the URL-lookup index in sync, without knowing anything about the underlying storage.
 *
 * The Lookup Service defines a "lookup by URL" dimension today; "lookup by topic" and "lookup by
 * claim" are specified as future dimensions of the same service. This module is organized so a
 * later dimension is additive (`indexOpportunityByTopic`, ...) rather than a rewrite: it never
 * assumes URL is the only match key, and the result contract carries no URL-specific vocabulary.
 *
 * The actual canonicalization/upsert/cascade-delete is owned by `syncUrlIndex`/`syncUrlIndexMany`
 * in `@adobe/spacecat-shared-data-access` — this module's job is only to supply match keys (via
 * caller-supplied extraction). It reports what was submitted and what the writer returned.
 *
 * Whatever `getUrls` returns is filtered through `sanitizeUrls` (`./lookup-index-utils.js`)
 * before it becomes part of a submission: every caller's candidates ultimately end up in a shared,
 * cross-tenant, customer-facing lookup table, so the hygiene gate lives here once rather than
 * being something each caller must remember to apply before calling in.
 *
 * Both functions below are best-effort and never throw: a failure is returned as `{ error }`, not
 * raised, so a lookup-index write can never fail the caller's own persist. A result with no `error`
 * key succeeded.
 */

const OPPORTUNITY_URLS_TABLE = 'opportunity_urls';
const SUGGESTION_URLS_TABLE = 'suggestion_urls';

/**
 * Runs `getUrls(entity)` through `sanitizeUrls`, shared by both functions below.
 *
 * Distinguishes a genuinely empty result (`[]` clears the entity's index rows - Decision 8's
 * self-heal) from a non-empty candidate list that hygiene reduces to nothing (extraction is
 * probably broken, not "this entity has no sources" - must not be submitted as an intentional
 * clear). See ADR 006, Decision 9.
 *
 * @param {(entity: object) => unknown[]} getUrls - the caller's URLs extractor for `entity`
 * @param {object} entity - the opportunity or suggestion to extract URLs from
 * @returns {{urls: string[]}|{error: Error}}
 */
function extractIndexableUrls(getUrls, entity) {
  let rawUrls;
  let sanitizedUrls;

  try {
    rawUrls = getUrls(entity);
    if (!Array.isArray(rawUrls)) {
      return failure(REASON.EXTRACT_URLS_FAILED);
    }
    sanitizedUrls = sanitizeUrls(rawUrls);
  } catch (cause) {
    return failure(REASON.EXTRACT_URLS_FAILED, cause);
  }

  if (rawUrls.length > 0 && sanitizedUrls.length === 0) {
    return failure(REASON.NO_INDEXABLE_URLS);
  }

  return { urls: sanitizedUrls };
}

/**
 * Sync one opportunity's own URLs into the shared URL index. Best-effort: never throws.
 *
 * The shared foundation reports exactly what was submitted and exactly what the underlying writer
 * returned.
 *
 * @param {object} params
 * @param {object} params.context - the caller's context (`dataAccess`)
 * @param {object} params.opportunity - the persisted Opportunity entity
 * @param {string} params.entityType - the opportunity type (e.g. `wikipedia-analysis`)
 * @param {(opportunity: object) => unknown[]} params.getUrls - raw URL candidates from the
 *   opportunity's analysis; filtered through `sanitizeUrls` before submission.
 * @returns {Promise<{opportunityId?: string, submittedEntry?: {entityId: string, urls: string[]},
 *   syncedIndexResult?: number, error?: Error}>}
 *   On success: `submittedEntry` is exactly what was submitted to the writer - the post-hygiene
 *   URLs, not necessarily every value `getUrls` returned (`entityId` here is always
 *   `opportunityId`). `syncedIndexResult` is `syncUrlIndex`'s own return value, passed through
 *   verbatim.
 *   On failure: only `error` is present. `error.message` names the reason it failed; `error.cause`
 *   is the original underlying error, if there was one.
 */
export async function indexOpportunityByUrl({
  context, opportunity, entityType, getUrls,
}) {
  const postgrestClient = resolvePostgrestClient(context);

  if (!postgrestClient?.from) {
    return failure(REASON.RESOLVE_POSTGREST_CLIENT_FAILED);
  }

  const extracted = extractIndexableUrls(getUrls, opportunity);
  if (extracted.error) {
    return extracted;
  }
  const { urls } = extracted;

  try {
    const entityId = opportunity.getId();

    const syncedIndexResult = await syncUrlIndex(postgrestClient, {
      table: OPPORTUNITY_URLS_TABLE,
      siteId: opportunity.getSiteId(),
      entityId,
      entityType,
      urls,
    });

    return {
      opportunityId: entityId,
      submittedEntry: { entityId, urls },
      syncedIndexResult,
    };
  } catch (cause) {
    return failure(REASON.SYNC_URL_INDEX_FAILED, cause);
  }
}

/**
 * Sync the URLs bound to one opportunity's suggestions into the shared URL index, in one batched
 * write. Best-effort: never throws.
 *
 * Every suggestion the opportunity currently has is included in the batch unless its own
 * candidates are non-empty but hygiene reduces them to nothing (`NO_INDEXABLE_URLS`) - that one
 * suggestion is skipped (its existing rows are left as-is) rather than failing the whole batch, so
 * one drifted suggestion cannot freeze every sibling suggestion's index indefinitely. A suggestion
 * with genuinely zero URLs IS included, with an empty array that clears its rows rather than
 * omitting it, so bindings that later go empty self-heal instead of leaving a stale row behind.
 *
 * As with `indexOpportunityByUrl`, the result reports exactly what was submitted and exactly what
 * the writer returned.
 *
 * @param {object} params
 * @param {object} params.context - the caller's context (`dataAccess`)
 * @param {object} params.opportunity - the persisted Opportunity entity whose suggestions to sync
 * @param {string} params.entityType - the opportunity type (e.g. `wikipedia-analysis`)
 * @param {(suggestion: object) => unknown[]} params.getUrls - one suggestion's raw URL
 *   candidates; filtered through `sanitizeUrls` before submission (see `indexOpportunityByUrl`).
 *   Takes only the suggestion — a caller whose extraction also needs the parent opportunity (e.g.
 *   because every suggestion shares the opportunity's own URL) closes over it before passing
 *   `getUrls` in.
 * @returns {Promise<{opportunityId?: string, submittedEntries?: {entityId: string,
 *   urls: string[]}[], syncedIndexResult?: (Map<string, number>|undefined), error?: Error}>}
 *   On success: `submittedEntries` is exactly what was submitted to the batched writer - the
 *   post-hygiene URLs per suggestion, in the same shape `syncUrlIndexMany` itself takes
 *   (`entityId`/`urls`). `syncedIndexResult` is `syncUrlIndexMany`'s own return value, passed
 *   through verbatim — `undefined` when there were no suggestions to submit, since the writer is
 *   never called in that case. On failure: only `error` is present, same convention as
 *   `indexOpportunityByUrl`.
 */
export async function indexOpportunitySuggestionsByUrl({
  context, opportunity, entityType, getUrls,
}) {
  const postgrestClient = resolvePostgrestClient(context);

  if (!postgrestClient?.from) {
    return failure(REASON.RESOLVE_POSTGREST_CLIENT_FAILED);
  }

  let suggestions;

  try {
    suggestions = await context.dataAccess.Suggestion.allByOpportunityId(opportunity.getId());
  } catch (cause) {
    return failure(REASON.FETCH_SUGGESTIONS_FAILED, cause);
  }

  if (!Array.isArray(suggestions)) {
    return failure(REASON.FETCH_SUGGESTIONS_FAILED);
  }

  const submittedEntries = [];

  for (const suggestion of suggestions) {
    let entityId;
    try {
      entityId = suggestion.getId();
    } catch (cause) {
      return failure(REASON.EXTRACT_URLS_FAILED, cause);
    }

    const extracted = extractIndexableUrls(getUrls, suggestion);

    if (extracted.error) {
      // A suggestion whose own candidates fail hygiene is skipped, not fatal to the batch: its
      // existing rows are left untouched (not cleared) and the rest of the batch still syncs. Any
      // other failure (the extractor itself throwing, a resolve stage failing) still aborts, since
      // that is more likely a systemic bug affecting every suggestion, not one entity's data.
      if (extracted.error.message === REASON.NO_INDEXABLE_URLS) {
        // eslint-disable-next-line no-continue
        continue;
      }
      return extracted;
    }

    submittedEntries.push({ entityId, urls: extracted.urls });
  }

  try {
    let syncedIndexResult;

    if (submittedEntries.length > 0) {
      syncedIndexResult = await syncUrlIndexMany(postgrestClient, {
        table: SUGGESTION_URLS_TABLE,
        siteId: opportunity.getSiteId(),
        entityType,
        entries: submittedEntries,
      });
    }
    return {
      opportunityId: opportunity.getId(),
      submittedEntries,
      syncedIndexResult,
    };
  } catch (cause) {
    return failure(REASON.SYNC_URL_INDEX_FAILED, cause);
  }
}
