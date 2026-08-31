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

import { syncUrlIndex } from '@adobe/spacecat-shared-data-access';

/**
 * Writes an opportunity's (and its suggestions') source URLs into the shared URL index at
 * persist time, so the lookup API can resolve URL -> opportunity/suggestion. The producer
 * owns URL extraction; `syncUrlIndex` owns canonicalization + storage.
 */

const OPPORTUNITY_URLS_TABLE = 'opportunity_urls';
const SUGGESTION_URLS_TABLE = 'suggestion_urls';

/**
 * Per opportunity-type extractor of an opportunity's source URLs. A type absent from this map
 * is a no-op. For wikipedia the opportunity and its suggestions share one source (the analysed
 * page), so the same URLs are indexed for both.
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
  try {
    const { postgrestClient } = dataAccess.services;
    const siteId = opportunity.getSiteId();
    const urls = extractUrls(opportunity);

    await syncUrlIndex(postgrestClient, {
      table: OPPORTUNITY_URLS_TABLE,
      siteId,
      entityId,
      entityType: auditType,
      urls,
    });

    const suggestions = await opportunity.getSuggestions();
    await Promise.all(suggestions.map((suggestion) => syncUrlIndex(postgrestClient, {
      table: SUGGESTION_URLS_TABLE,
      siteId,
      entityId: suggestion.getId(),
      entityType: auditType,
      urls,
    })));

    log.debug(`[url-index] synced ${urls.length} url(s) for opportunity ${entityId}`);
  } catch (error) {
    log.warn(`[url-index] failed to sync url index for opportunity ${entityId}: ${error.message}`);
  }
}
