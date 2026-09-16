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

import { syncUrlIndex, syncUrlIndexMany, syncOpportunitySemantic } from '@adobe/spacecat-shared-data-access';
import {
  REASON, failure, resolvePostgrestClient, sanitizeUrls, sanitizeTopics,
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

// Topic dimension: the shared embedding space the opportunity vectors and the api-service query
// embedder must agree on (a `vector(1536)` index column). 1536 is the model's native dimension —
// `AzureEmbeddingClient.createEmbeddings` is called WITHOUT `dimensions` so it is not truncated.
const TOPIC_SOURCE_TYPE = 'topic';
const TOPIC_EMBEDDING_MODEL = 'azure/text-embedding-3-small';
const TOPIC_EMBEDDING_DIMS = 1536;

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

/**
 * Runs `getTitles(entity)` through `sanitizeTopics`, mirroring `extractIndexableUrls`.
 * A genuinely empty result (`[]`) clears the entity's topic vectors (full-replace self-heal); a
 * non-empty candidate list that hygiene reduces to nothing is `NO_INDEXABLE_TOPICS` (extraction is
 * probably broken, not "this entity has no topics" — must not clear). See ADR 006 Decision 9.
 *
 * @param {(entity: object) => unknown[]} getTitles - the caller's topic-rows extractor
 * @param {object} entity - the opportunity to extract topics from
 * @returns {{topics: {sourceId: (string|undefined), text: string}[]}|{error: Error}}
 */
function extractIndexableTopics(getTitles, entity) {
  let rawTopics;
  let sanitizedTopics;

  try {
    rawTopics = getTitles(entity);
    if (!Array.isArray(rawTopics)) {
      return failure(REASON.EXTRACT_TOPICS_FAILED);
    }
    sanitizedTopics = sanitizeTopics(rawTopics);
  } catch (cause) {
    return failure(REASON.EXTRACT_TOPICS_FAILED, cause);
  }

  if (rawTopics.length > 0 && sanitizedTopics.length === 0) {
    return failure(REASON.NO_INDEXABLE_TOPICS);
  }

  return { topics: sanitizedTopics };
}

/**
 * Sync one opportunity's own topics into the shared semantic index (the "lookup by topic"
 * dimension). Best-effort: never throws. Additive sibling of `indexOpportunityByUrl` (ADR 006),
 * same `{ error }`-or-raw-result contract.
 *
 * Unlike the URL dimension, the match key is derived, not intrinsic: the caller extracts topic
 * titles from the opportunity and this function embeds them (via the injected `embeddingClient`,
 * an `EmbeddingProvider`) with the shared model into `vector(1536)`, then full-replaces the
 * opportunity's `source_type='topic'` vectors via `syncOpportunitySemantic`. Embedding is injected
 * (not constructed here) so this stays testable and free of a hard embedding-client dependency.
 *
 * @param {object} params
 * @param {object} params.context - the caller's context (`dataAccess`)
 * @param {object} params.opportunity - the persisted Opportunity entity
 * @param {string} params.entityType - the opportunity type (e.g. `cited-analysis`)
 * @param {(opportunity: object) => unknown[]} params.getTitles - raw topic rows (`{ id, title }`)
 *   from the opportunity's analysis; filtered through `sanitizeTopics` before embedding.
 * @param {{createEmbeddings: (inputs: string[]) => Promise<number[][]>}} params.embeddingClient -
 *   an `EmbeddingProvider`; `createEmbeddings` returns one native-dimension vector per input.
 * @returns {Promise<{opportunityId?: string, submittedEntry?: {entityId: string, sourceType:
 *   string, topicCount: number}, syncedIndexResult?: number, error?: Error}>}
 *   On success: `submittedEntry.topicCount` is how many topic vectors were submitted (post-
 *   hygiene); `syncedIndexResult` is `syncOpportunitySemantic`'s own return value, verbatim. On
 *   failure: only `error`, same convention as `indexOpportunityByUrl`.
 */
export async function indexOpportunityByTopic({
  context, opportunity, entityType, getTitles, embeddingClient,
}) {
  const postgrestClient = resolvePostgrestClient(context);

  if (!postgrestClient?.from) {
    return failure(REASON.RESOLVE_POSTGREST_CLIENT_FAILED);
  }

  const extracted = extractIndexableTopics(getTitles, opportunity);
  if (extracted.error) {
    return extracted;
  }
  const { topics } = extracted;

  let sources;
  try {
    if (topics.length === 0) {
      sources = []; // genuine empty → full-replace clears this opportunity's topic vectors
    } else {
      const vectors = await embeddingClient.createEmbeddings(topics.map((t) => t.text));
      sources = topics.map((topic, i) => ({
        text: topic.text,
        vector: vectors[i],
        model: TOPIC_EMBEDDING_MODEL,
        dims: TOPIC_EMBEDDING_DIMS,
        sourceId: topic.sourceId,
      }));
    }
  } catch (cause) {
    return failure(REASON.EMBED_TOPICS_FAILED, cause);
  }

  try {
    const entityId = opportunity.getId();

    const syncedIndexResult = await syncOpportunitySemantic(postgrestClient, {
      siteId: opportunity.getSiteId(),
      entityId,
      entityType,
      sourceType: TOPIC_SOURCE_TYPE,
      sources,
    });

    return {
      opportunityId: entityId,
      submittedEntry: { entityId, sourceType: TOPIC_SOURCE_TYPE, topicCount: sources.length },
      syncedIndexResult,
    };
  } catch (cause) {
    return failure(REASON.SYNC_SEMANTIC_INDEX_FAILED, cause);
  }
}
