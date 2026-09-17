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

import { copyEntityVectors } from '@adobe/spacecat-shared-data-access';
import { AzureEmbeddingClient } from '@adobe/spacecat-shared-gpt-client';
import {
  indexOpportunityByUrl, indexOpportunitySuggestionsByUrl, indexOpportunityByTopic,
} from './lookup-index.js';
import { resolvePostgrestClient } from './lookup-index-utils.js';
import { PEER, errorField } from '../utils/offsite-logging.js';

const START_INDEX_SYNC_EVENT = 'audit_funneling_start';
const SYNC_URL_INDEX_EVENT = 'audit_funneling_index_url_synced';
// Per-dimension sync-outcome event (ADR 006 Decision 7): topic gets its own name so its outcomes
// stay independently queryable. Added additively as its own funneling sub-phase (it emits its own
// `audit_funneling_start`/`_end` boundary) rather than refactoring the merged URL path into one
// combined phase — a follow-up could consolidate to a single boundary pair per Decision 7's ideal.
const SYNC_TOPIC_INDEX_EVENT = 'audit_funneling_index_topic_synced';
const COPY_TOPIC_SNAPSHOT_EVENT = 'audit_funneling_index_topic_snapshot_copied';
const END_INDEX_SYNC_EVENT = 'audit_funneling_end';

const LEVEL = { OPPORTUNITY: 'opportunity', SUGGESTIONS: 'suggestions' };

function countUrls(entries) {
  return entries.reduce((total, entry) => total + entry.urls.length, 0);
}

function resolveOpportunitySyncedCount(syncedIndexResult) {
  return typeof syncedIndexResult === 'number'
    ? { urlCount: syncedIndexResult, recognized: true }
    : { urlCount: undefined, recognized: false };
}

function resolveSuggestionsSyncedUrlCount(syncedIndexResult, submittedCount) {
  if (submittedCount === 0) {
    // The writer is never called when there's nothing to submit — this is the one case where
    // `syncedIndexResult` being absent is expected, not a gap in what we can interpret.
    return { urlCount: 0, recognized: true };
  }
  if (!(syncedIndexResult instanceof Map)) {
    return { urlCount: undefined, recognized: false };
  }
  // Each Map value is the number of URLs synced for that suggestion (syncUrlIndexMany's own
  // per-entity count, the batched equivalent of syncUrlIndex's return value) — summing them
  // gives the URL-level count. `.size` (the entity count) is deliberately not surfaced here: it
  // is set for every submitted entry before any write happens, so it can never differ from
  // `submittedSuggestionCount` and carries no signal a caller couldn't already see.
  const urlCount = Array.from(syncedIndexResult.values())
    .reduce((total, entityUrlCount) => total + entityUrlCount, 0);
  return { urlCount, recognized: true };
}

function logLevelResult(olog, {
  auditType, level, result,
}) {
  if (result.error) {
    olog.warn(SYNC_URL_INDEX_EVENT, 'Sync to lookup URL index failed', {
      peer: PEER.POSTGRES, direction: 'outbound', auditType, ...errorField(result.error),
    });
    return;
  }

  let counts;
  let synced;

  if (level === LEVEL.OPPORTUNITY) {
    const submittedUrlCount = result.submittedEntry.urls.length;
    synced = resolveOpportunitySyncedCount(result.syncedIndexResult);

    counts = {
      submittedUrlCount,
      syncedUrlCount: synced.urlCount,
    };
  } else {
    const { submittedEntries } = result;
    synced = resolveSuggestionsSyncedUrlCount(result.syncedIndexResult, submittedEntries.length);

    counts = {
      submittedSuggestionCount: submittedEntries.length,
      submittedUrlCount: countUrls(submittedEntries),
      syncedUrlCount: synced.urlCount,
    };
  }

  if (!synced.recognized) {
    olog.warn(SYNC_URL_INDEX_EVENT, 'Sync to lookup URL index returned an unrecognized result', {
      peer: PEER.POSTGRES, direction: 'outbound', auditType, ...counts,
    });
    return;
  }

  olog.success(SYNC_URL_INDEX_EVENT, 'Sync to lookup URL index succeeded', {
    peer: PEER.POSTGRES, direction: 'outbound', auditType, ...counts,
  });
}

/**
 * Offsite's integration with the shared Lookup Service foundation (`lookup-index.js`): runs the
 * URL-dimension sync for one opportunity and its suggestions, and renders the outcome into the
 * offsite log taxonomy's `audit_funneling_*` phase, under the caller's bound logger.
 *
 * Best-effort — `lookup-index.js`'s two functions never throw (a failure is returned as
 * `{ error }`), so neither does this.
 *
 * @param {object} params
 * @param {object} params.context - audit context (`dataAccess`)
 * @param {object} params.opportunity - the persisted Opportunity entity
 * @param {string} params.auditType - the opportunity type (e.g. `wikipedia-analysis`)
 * @param {(opportunity: object) => string[]} params.getOpportunityUrls - see
 *   `indexOpportunityByUrl`; supplied by the caller, unique per opportunity type.
 * @param {(suggestion: object, opportunity: object) => string[]} params.getSuggestionUrls - one
 *   suggestion's bound URLs, supplied by the caller. Takes the parent opportunity as a second
 *   argument (unlike `indexOpportunitySuggestionsByUrl`'s own single-argument `getUrls`) because a
 *   handler's extractor may need it — e.g. wikipedia's suggestions share the opportunity's own URL
 *   rather than carrying one of their own. This function closes over `opportunity` before handing
 *   it to the shared foundation, so the foundation's contract stays entity-scoped either way.
 * @param {object} params.olog - the caller's bound offsite logger (`createOffsiteLogger`)
 * @returns {Promise<void>}
 */
export async function indexOffsiteOpportunityByUrl({
  context, opportunity, auditType, getOpportunityUrls, getSuggestionUrls, olog,
}) {
  olog.start(START_INDEX_SYNC_EVENT, 'Sync to lookup index started', { auditType });

  const indexOpportunityResult = await indexOpportunityByUrl({
    context, opportunity, entityType: auditType, getUrls: getOpportunityUrls,
  });
  logLevelResult(olog, {
    auditType, level: LEVEL.OPPORTUNITY, result: indexOpportunityResult,
  });

  const indexSuggestionsResult = await indexOpportunitySuggestionsByUrl({
    context,
    opportunity,
    entityType: auditType,
    getUrls: (suggestion) => getSuggestionUrls(suggestion, opportunity),
  });
  logLevelResult(olog, {
    auditType, level: LEVEL.SUGGESTIONS, result: indexSuggestionsResult,
  });

  olog.success(END_INDEX_SYNC_EVENT, 'Sync to lookup index ended', { auditType });
}

function logTopicResult(olog, { auditType, result }) {
  if (result.error) {
    // `degraded` (not `failure`): best-effort write that self-heals on the next weekly refresh.
    olog.warn(SYNC_TOPIC_INDEX_EVENT, 'Sync to lookup topic index failed', {
      peer: PEER.POSTGRES, direction: 'outbound', auditType, ...errorField(result.error),
    });
    return;
  }
  olog.success(SYNC_TOPIC_INDEX_EVENT, 'Sync to lookup topic index succeeded', {
    peer: PEER.POSTGRES,
    direction: 'outbound',
    auditType,
    submittedTopicCount: result.submittedEntry.topicCount,
    syncedTopicCount: result.syncedIndexResult,
  });
}

/**
 * Offsite's integration with the shared Lookup Service foundation for the TOPIC dimension
 * (`indexOpportunityByTopic`): embeds the opportunity's topic titles and full-replaces its semantic
 * index vectors, rendering the outcome into the offsite `audit_funneling_*` taxonomy. Emits its own
 * boundary pair (see `SYNC_TOPIC_INDEX_EVENT`).
 *
 * The embedding client is constructed here (not in the pure foundation) from `context.env`; a
 * missing/misconfigured embedding deployment is a degraded outcome, never a throw — the audit's own
 * persist has already succeeded by the time this runs.
 *
 * @param {object} params
 * @param {object} params.context - audit context (`dataAccess`, `env`)
 * @param {object} params.opportunity - the persisted Opportunity entity
 * @param {string} params.auditType - the opportunity type (e.g. `cited-analysis`)
 * @param {(opportunity: object) => unknown[]} params.getTitles - raw topic rows (`{ id, title }`),
 *   unique per opportunity type (cited=content, youtube=content+comments, reddit=combined).
 * @param {object} params.olog - the caller's bound offsite logger (`createOffsiteLogger`)
 * @returns {Promise<void>}
 */
export async function indexOffsiteOpportunityByTopic({
  context, opportunity, auditType, getTitles, olog,
}) {
  olog.start(START_INDEX_SYNC_EVENT, 'Sync to lookup topic index started', { auditType });

  let embeddingClient;
  try {
    embeddingClient = AzureEmbeddingClient.createFrom(context);
  } catch (cause) {
    olog.warn(SYNC_TOPIC_INDEX_EVENT, 'Embedding client unavailable; skipping topic index', {
      peer: PEER.POSTGRES, direction: 'outbound', auditType, ...errorField(cause),
    });
    olog.success(END_INDEX_SYNC_EVENT, 'Sync to lookup topic index ended', { auditType });
    return;
  }

  const result = await indexOpportunityByTopic({
    context, opportunity, entityType: auditType, getTitles, embeddingClient,
  });
  logTopicResult(olog, { auditType, result });

  olog.success(END_INDEX_SYNC_EVENT, 'Sync to lookup topic index ended', { auditType });
}

/**
 * Copy an evergreen opportunity's topic vectors to a new superseded-refresh snapshot id, so a
 * restored-to-visible snapshot stays topic-resolvable (a deliberate enhancement over the URL
 * dimension, which does not copy — see ADR 007). Re-points rows via `copyEntityVectors` rather than
 * re-embedding (the snapshot content is identical). Best-effort: never throws; a failed copy only
 * means that snapshot is not topic-matchable until re-indexed. Must run BEFORE the evergreen
 * refresh full-replaces its vectors, while it still holds them.
 *
 * @param {object} params
 * @param {object} params.dataAccess - the data access layer (`services.postgrestClient`)
 * @param {string} params.siteId
 * @param {string} params.fromEntityId - source (evergreen) opportunity id
 * @param {string} params.toEntityId - destination (snapshot) opportunity id
 * @param {object} params.olog - the caller's bound offsite logger
 * @returns {Promise<void>}
 */
export async function copyOffsiteOpportunityTopicVectors({
  dataAccess, siteId, fromEntityId, toEntityId, olog,
}) {
  const postgrestClient = resolvePostgrestClient({ dataAccess });
  if (!postgrestClient?.from) {
    olog.warn(COPY_TOPIC_SNAPSHOT_EVENT, 'Postgrest client unavailable; skipping snapshot topic copy', {
      peer: PEER.POSTGRES, direction: 'outbound', snapshotId: toEntityId,
    });
    return;
  }

  try {
    const copiedCount = await copyEntityVectors(postgrestClient, {
      siteId, fromEntityId, toEntityId,
    });
    olog.success(COPY_TOPIC_SNAPSHOT_EVENT, 'Copied topic vectors to snapshot', {
      peer: PEER.POSTGRES, direction: 'outbound', snapshotId: toEntityId, copiedTopicCount: copiedCount,
    });
  } catch (cause) {
    olog.warn(COPY_TOPIC_SNAPSHOT_EVENT, 'Failed to copy topic vectors to snapshot', {
      peer: PEER.POSTGRES, direction: 'outbound', snapshotId: toEntityId, ...errorField(cause),
    });
  }
}
