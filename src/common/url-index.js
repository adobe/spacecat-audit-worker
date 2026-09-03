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
  appendFields, errorField, OFFSITE_DOMAIN, OUTCOME, PEER,
} from '../utils/offsite-logging.js';

/**
 * Writes an opportunity's (and its suggestions') source URLs into the shared URL index at
 * persist time, so the lookup API can resolve URL -> opportunity/suggestion. The producer
 * owns URL extraction; `syncUrlIndex` owns canonicalization + storage.
 */

const OPPORTUNITY_URLS_TABLE = 'opportunity_urls';
const SUGGESTION_URLS_TABLE = 'suggestion_urls';

// Stable event token so index-sync outcomes are alertable via the offsite log taxonomy.
const URL_INDEX_EVENT = 'url_index_sync';

// Set before each awaited step so a swallowed error names the stage that threw.
const PHASE = {
  OPPORTUNITY_INDEX: 'opportunity-index',
  SUGGESTION_FETCH: 'suggestion-fetch',
  SUGGESTION_INDEX: 'suggestion-index',
};

/**
 * Per opportunity-type extractor of source URLs; a type absent from this map is a no-op.
 * Wikipedia's opportunity and suggestions share one source, so the same URLs are indexed for both.
 * Adding cited/reddit/youtube (a distinct source per suggestion) needs a per-suggestion extractor
 * seam — see ADR `docs/decisions/006-url-index-forward-only-best-effort.md`.
 * @type {Object<string, (opportunity: object) => string[]>}
 */
const URL_EXTRACTORS = {
  'wikipedia-analysis': (opportunity) => {
    const url = opportunity.getData().fullAnalysis?.wikipediaUrl;
    return url ? [url] : [];
  },
};

/**
 * Sync the URL index for a persisted opportunity and its suggestions. Best-effort: swallows
 * errors so a failed sync never fails the audit.
 *
 * @param {object} params
 * @param {object} params.context - audit context (`dataAccess` + `log`)
 * @param {object} params.opportunity - the persisted Opportunity entity
 * @param {string} params.auditType - the opportunity type (e.g. `wikipedia-analysis`)
 * @returns {Promise<void>}
 */
export async function syncOpportunityUrlIndex({ context, opportunity, auditType }) {
  const { dataAccess, log } = context;

  const extractUrls = URL_EXTRACTORS[auditType];
  if (!extractUrls) {
    return;
  }

  const entityId = opportunity.getId();
  let siteId;
  let phase = PHASE.OPPORTUNITY_INDEX;
  try {
    const { postgrestClient } = dataAccess.services;
    siteId = opportunity.getSiteId();
    const urls = extractUrls(opportunity);

    await syncUrlIndex(postgrestClient, {
      table: OPPORTUNITY_URLS_TABLE,
      siteId,
      entityId,
      entityType: auditType,
      urls,
    });

    phase = PHASE.SUGGESTION_FETCH;
    const suggestions = await opportunity.getSuggestions();

    if (suggestions.length > 0) {
      phase = PHASE.SUGGESTION_INDEX;
      await syncUrlIndexMany(postgrestClient, {
        table: SUGGESTION_URLS_TABLE,
        siteId,
        entityType: auditType,
        entries: suggestions.map((suggestion) => ({
          entityId: suggestion.getId(),
          urls,
        })),
      });
    }

    log.debug(appendFields('[url-index] synced source urls', {
      domain: OFFSITE_DOMAIN,
      event: URL_INDEX_EVENT,
      outcome: OUTCOME.SUCCESS,
      peer: PEER.POSTGRES,
      siteId,
      opportunityId: entityId,
      entityType: auditType,
      urlCount: urls.length,
      suggestionCount: suggestions.length,
    }));
  } catch (error) {
    log.warn(appendFields(`[url-index] failed to sync url index (${phase})`, {
      domain: OFFSITE_DOMAIN,
      event: URL_INDEX_EVENT,
      outcome: OUTCOME.FAILURE,
      peer: PEER.POSTGRES,
      siteId,
      opportunityId: entityId,
      entityType: auditType,
      phase,
      ...errorField(error),
    }));
  }
}
