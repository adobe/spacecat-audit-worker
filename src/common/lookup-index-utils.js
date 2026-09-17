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

import { isValidUrl } from '@adobe/spacecat-shared-utils';

/**
 * Helpers shared by `lookup-index.js`'s dimension-scoped functions (`indexOpportunityByUrl`, ...
 * today; `indexOpportunityByTopic`/`indexOpportunityByClaim` when those dimensions land) - the
 * pieces that don't vary by dimension: the `{ error }` failure shape and its fixed reason strings,
 * resolving the caller's postgrest client, and (dimension-specific, but with no other home yet)
 * the URL hygiene gate below.
 */

export const REASON = {
  RESOLVE_POSTGREST_CLIENT_FAILED: 'Failed to resolve postgrest client',
  EXTRACT_URLS_FAILED: 'Failed to extract URLs',
  NO_INDEXABLE_URLS: 'Extraction returned candidates but none were indexable',
  FETCH_SUGGESTIONS_FAILED: 'Failed to fetch suggestions',
  SYNC_URL_INDEX_FAILED: 'Failed to sync the URL index',
};

export function failure(reason, cause) {
  return { error: cause ? new Error(reason, { cause }) : new Error(reason) };
}

export function resolvePostgrestClient(context) {
  return context?.dataAccess?.services?.postgrestClient;
}

/**
 * Shared gate between a scraped/LLM-derived source and the shared URL-lookup index
 * (`lookup-index.js`). Every offsite extractor should filter its raw candidate list through
 * `sanitizeUrls` instead of a bare `isValidUrl` check: `isValidUrl` only confirms the value
 * parses as an http(s) URL, it does not gate what ends up persisted into a shared, cross-tenant,
 * customer-facing lookup table.
 *
 * Rejects (drops the candidate entirely, rather than repairing it):
 * - non-string values (a scheme-drifted payload, e.g. an array where a string was expected,
 *   would otherwise survive `isValidUrl`'s coercive `new URL()` call and later canonicalize to
 *   nothing, which fails the whole batched write it's submitted in)
 * - credential-bearing URLs (`https://user:pass@host/...`) - never worth indexing as a lookup key
 * - URLs whose length exceeds a conservative bound (a scraped URL long enough to threaten the
 *   underlying unique index's row-size limit would fail the entire upsert chunk it's batched into)
 *
 * Strips (keeps the URL, removes only the sensitive/irrelevant part):
 * - the fragment (never part of what a lookup should match on)
 * - known credential-carrying query parameter names, case-insensitively
 *
 * Deliberately does not touch other query parameters (e.g. YouTube's `watch?v=`, where the query
 * string is the resource identity) or otherwise attempt full canonicalization - that remains
 * `syncUrlIndex`'s job.
 *
 * De-duplicates on the post-strip string: stripping the fragment or a sensitive query parameter
 * can turn two distinct candidates into the same URL (two anchors on the same page, two
 * differently-tokened links to the same resource), and a duplicate would otherwise inflate
 * `submittedUrlCount` beyond what was actually distinct.
 *
 * Caps the de-duplicated result at `MAX_URLS_PER_ENTITY`: an unbounded per-entity submission means
 * an untrusted payload could drive an unbounded number of writer round-trips and rows in a shared
 * table. 500 is generous enough that no legitimate source list should ever hit it.
 */

const MAX_URL_LENGTH = 2000;
const MAX_URLS_PER_ENTITY = 500;

const SENSITIVE_QUERY_PARAMS = new Set([
  'access_token', 'token', 'api_key', 'apikey', 'key', 'secret', 'password', 'auth', 'signature', 'sig',
]);

function sanitizeUrl(candidate) {
  if (typeof candidate !== 'string' || !isValidUrl(candidate)) {
    return null;
  }

  // `isValidUrl` above already parsed this exact string with `new URL()` and returned true, so
  // this can't throw - reusing its result instead of a redundant try/catch.
  const parsed = new URL(candidate);

  if (parsed.username || parsed.password) {
    return null;
  }

  parsed.hash = '';
  for (const param of Array.from(parsed.searchParams.keys())) {
    if (SENSITIVE_QUERY_PARAMS.has(param.toLowerCase())) {
      parsed.searchParams.delete(param);
    }
  }

  const serialized = parsed.toString();
  return serialized.length <= MAX_URL_LENGTH ? serialized : null;
}

/**
 * @param {unknown[]} candidates - raw values from a scraped/LLM-derived payload
 * @returns {string[]} indexable URLs, de-duplicated, in first-seen order, capped at
 *   `MAX_URLS_PER_ENTITY`
 */
export function sanitizeUrls(candidates) {
  const cleaned = new Set();
  for (const candidate of candidates) {
    const url = sanitizeUrl(candidate);
    if (url !== null) {
      cleaned.add(url);
    }
  }
  return Array.from(cleaned).slice(0, MAX_URLS_PER_ENTITY);
}
