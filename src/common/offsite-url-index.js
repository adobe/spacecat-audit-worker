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

import { syncOpportunityUrlIndex } from './url-index.js';
import { PEER, errorField } from '../utils/offsite-logging.js';

// Stable event token so index-sync outcomes stay greppable/alertable in the offsite taxonomy.
const URL_INDEX_EVENT = 'url_index_sync';

/**
 * Offsite adapter around the generic URL-index writer (`syncOpportunityUrlIndex`): runs it, then
 * renders the structured result into the offsite log taxonomy through the caller's bound logger.
 * Keeps offsite-logging knowledge out of the generic writer. Best-effort — the writer swallows its
 * own errors, so this never throws.
 *
 * @param {object} params
 * @param {object} params.context - audit context (`dataAccess`)
 * @param {object} params.opportunity - the persisted Opportunity entity
 * @param {string} params.auditType - the opportunity type (e.g. `wikipedia-analysis`)
 * @param {object} params.olog - the caller's bound offsite logger (`createOffsiteLogger`)
 * @returns {Promise<void>}
 */
export async function syncOffsiteUrlIndex({
  context, opportunity, auditType, olog,
}) {
  const result = await syncOpportunityUrlIndex({ context, opportunity, auditType });

  if (result.status === 'ok') {
    olog.debug(URL_INDEX_EVENT, 'synced source urls', {
      peer: PEER.POSTGRES,
      entityType: auditType,
      urlCount: result.urlCount,
      suggestionCount: result.suggestionCount,
    });
  } else if (result.status === 'error') {
    // `degraded` (not `failure`): best-effort write that self-heals on the next run.
    olog.warn(URL_INDEX_EVENT, `failed to sync url index (${result.phase})`, {
      peer: PEER.POSTGRES,
      phase: result.phase,
      entityType: auditType,
      ...errorField(result.error),
    });
  }
  // `skipped` (no registered extractor) → nothing to log.
}
