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

import { indexOpportunityByUrl, indexOpportunitySuggestionsByUrl } from './lookup-index.js';
import { PEER, errorField } from '../utils/offsite-logging.js';

const START_INDEX_SYNC_EVENT = 'audit_funneling_start';
const SYNC_URL_INDEX_EVENT = 'audit_funneling_index_url_synced';
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
