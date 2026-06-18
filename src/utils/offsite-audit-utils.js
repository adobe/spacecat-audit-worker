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

/**
 * Shared helpers for off-site guidance audits (reddit, youtube, cited, etc.):
 * caps on URLs sent to Mystique (SQS payload size), optional `urlLimit` from the audit queue,
 * and DRS availability filtering to ensure only already-scraped URLs are sent for analysis.
 */

export const MYSTIQUE_URLS_LIMIT = 50;

/**
 * Social, search, and deal-aggregator domains that are NOT earned third-party
 * editorial content. Cited analysis measures earned brand perception, so these
 * are dropped entirely.
 *
 * Inclusion criteria: only domains actually observed polluting production
 * cited-URL lists are listed here, kept deliberately narrow to avoid dropping
 * legitimately earned content. Other social platforms (tiktok.com,
 * pinterest.com, linkedin.com) and search engines (bing.com) are intentionally
 * absent until they show up in real data — add them as observed.
 *
 * Note: `youtube.com` / `reddit.com` are also absent because they are routed
 * to their own dedicated analyses via `OFFSITE_DOMAINS` and are therefore
 * already excluded from the top-cited bucket.
 *
 * @type {readonly string[]}
 */
export const NON_EARNED_EXCLUDED_DOMAINS = Object.freeze([
  'google.com',
  'facebook.com',
  'instagram.com',
  'groupon.com',
]);

// Tokens shorter than this are dropped from brand-token matching: a 1-2 char
// substring would match almost any host and turn the branded filter into a
// blunt instrument.
const MIN_BRAND_TOKEN_LENGTH = 3;

/**
 * Builds the set of lowercase brand tokens used to detect brand-owned lookalike
 * domains that are not subdomains of the brand apex (e.g. `lovedbylovesac.com`
 * for `lovesac.com`, which does not end in `.lovesac.com`).
 *
 * Tokens are sourced from:
 *  - the site apex label (`lovesac.com` → `lovesac`), and
 *  - each configured brand keyword, normalized to `[a-z0-9]` only.
 *
 * @param {string} [siteHostname] - www-stripped client hostname (e.g. `lovesac.com`)
 * @param {string[]} [brandKeywords] - brand keywords from site config
 * @returns {Set<string>} lowercase tokens at least `MIN_BRAND_TOKEN_LENGTH` chars long
 */
export function computeBrandTokens(siteHostname, brandKeywords = []) {
  const tokens = new Set();
  const apexLabel = String(siteHostname || '').toLowerCase().split('.')[0];
  if (apexLabel.length >= MIN_BRAND_TOKEN_LENGTH) {
    tokens.add(apexLabel);
  }
  // The parameter default ([]) covers a missing argument; the `|| []` guard
  // covers an explicit null/undefined passed by a caller (e.g. an unconfigured
  // `getBrandKeywords()` returning null). Both are needed.
  for (const keyword of brandKeywords || []) {
    const normalized = String(keyword).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized.length >= MIN_BRAND_TOKEN_LENGTH) {
      tokens.add(normalized);
    }
  }
  return tokens;
}

/**
 * Extracts the hostname from a URL or bare host string, stripping the leading
 * `www.` so apex-to-apex comparison works regardless of how the brand domain is
 * configured (`bmw.com` vs `https://www.bmw.com/`).
 *
 * Returns an empty string for unparseable input — callers then treat the check
 * as a no-op rather than dropping URLs based on garbage.
 * @param {string} value
 * @returns {string}
 */
export function toApexHost(value) {
  if (!value) {
    return '';
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return '';
  }
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Returns the reason a cited URL host must NOT enter the URL Store / cited
 * analysis, or `null` when the host is allowed.
 *
 * A host is excluded when it is (or is a subdomain of) a non-earned domain, or
 * when it contains a brand token as a substring (branded-lookalike match).
 * Matching is on the host only — never the path — so a third-party review at
 * `techradar.com/is-lovesac-good` is kept while `lovedbylovesac.com` is dropped.
 *
 * The reason string is intended for debug logging so operators can see exactly
 * which domain or brand token dropped a URL (important for short/common-word
 * brand tokens like `gap` or `art`). A non-null return is truthy, so existing
 * boolean call sites (`if (isExcludedCitedHost(...))`) keep working.
 *
 * @param {string} hostname - URL hostname (may include a leading `www.`)
 * @param {Set<string>} [brandTokens] - tokens from {@link computeBrandTokens}
 * @returns {string|null} reason (e.g. `domain:google.com` / `brand-token:lovesac`) or null
 */
export function isExcludedCitedHost(hostname, brandTokens) {
  if (!hostname) {
    return null;
  }
  const bare = String(hostname).toLowerCase().replace(/^www\./, '');
  for (const domain of NON_EARNED_EXCLUDED_DOMAINS) {
    if (bare === domain || bare.endsWith(`.${domain}`)) {
      return `domain:${domain}`;
    }
  }
  if (brandTokens) {
    for (const token of brandTokens) {
      if (bare.includes(token)) {
        return `brand-token:${token}`;
      }
    }
  }
  return null;
}

/**
 * Effective max URLs to send to Mystique for store-backed guidance audits
 * (reddit / youtube / cited). Optional limit from `auditContext.messageData.urlLimit`
 * (RunnerAudit). Runners merge the resolved value into `auditResult.config.urlLimit` for
 * post-processors and persistence (same field name as Slack).
 * Capped at MYSTIQUE_URLS_LIMIT.
 *
 * @param {object} [auditContext]
 * @param {number|string} [auditContext.messageData.urlLimit]
 * @param {object} [log]
 * @param {string} [logPrefix]
 * @returns {number}
 */
/**
 * Error thrown when DRS successfully responded but reported no available scraped content.
 * Signals that scraping has not completed yet for any of the requested URLs.
 */
export class DrsNoContentAvailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DrsNoContentAvailableError';
  }
}

/**
 * Filters an array of URL objects to only those whose content is already available in DRS.
 *
 * Runs one `lookupScrapeResults` call per dataset ID. A URL passes the filter when it has
 * `status === 'available'` in **at least one** of the provided datasets, meaning Mystique
 * will be able to retrieve its scraped content.
 *
 * Falls back gracefully (returns the original list unchanged) when DRS is not configured or
 * every dataset lookup fails / returns null — i.e. when DRS availability cannot be determined.
 *
 * Throws a `DrsNoContentAvailableError` when DRS is reachable and successfully responded but
 * reported zero available URLs, meaning scraping has not completed yet.
 *
 * @param {Array<{url: string}>} urls - URL objects from the URL Store
 * @param {string[]} datasetIds - DRS dataset IDs to check
 *   (e.g. ['reddit_posts', 'reddit_comments'])
 * @param {string} siteId - Site ID required by the DRS lookup API
 * @param {object|null} drsClient - Configured DrsClient instance (or null / unconfigured)
 * @param {object} [log]
 * @param {string} [logPrefix]
 * @returns {Promise<Array<{url: string}>>} Filtered URL objects
 * @throws {DrsNoContentAvailableError} When DRS responded but no URLs are available yet
 */
export async function filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, log, logPrefix) {
  const prefix = logPrefix ?? '';

  if (!drsClient || !drsClient.isConfigured()) {
    log?.info(`${prefix} DRS client not configured, skipping availability filter`);
    return urls;
  }

  const rawUrls = urls.map((item) => item.url);
  const availableUrls = new Set();
  let atLeastOneLookupSucceeded = false;

  for (const datasetId of datasetIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await drsClient.lookupScrapeResults({ datasetId, siteId, urls: rawUrls });
      if (!response) {
        log?.warn(`${prefix} DRS lookup returned null for datasetId=${datasetId}, skipping`);
        // eslint-disable-next-line no-continue
        continue;
      }
      atLeastOneLookupSucceeded = true;
      for (const result of response.results) {
        if (result.status === 'available') {
          availableUrls.add(result.url);
        }
      }
      log?.info(
        `${prefix} DRS lookup datasetId=${datasetId}: `
        + `${response.summary?.available ?? 0}/${response.summary?.total ?? rawUrls.length} available`,
      );
    } catch (error) {
      log?.warn(`${prefix} DRS lookup failed for datasetId=${datasetId}: ${error.message}, skipping`);
    }
  }

  if (!atLeastOneLookupSucceeded) {
    log?.warn(`${prefix} All DRS lookups failed or returned null for datasets [${datasetIds.join(', ')}], skipping availability filter`);
    return urls;
  }

  if (availableUrls.size === 0) {
    throw new DrsNoContentAvailableError(
      `No scraped content available in DRS for datasets [${datasetIds.join(', ')}] and siteId: ${siteId}`,
    );
  }

  const filtered = urls.filter((item) => availableUrls.has(item.url));
  const removed = urls.length - filtered.length;
  if (removed > 0) {
    log?.info(`${prefix} DRS availability filter: removed ${removed} URL(s) not yet scraped, ${filtered.length} remaining`);
  }
  return filtered;
}

export function resolveMystiqueUrlLimit(auditContext, log, logPrefix) {
  const prefix = logPrefix ?? '';
  const ctx = auditContext ?? {};
  const raw = ctx.messageData?.urlLimit;
  if (raw === undefined || raw === null || raw === '') {
    return MYSTIQUE_URLS_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    log?.warn(
      `${prefix} Invalid urlLimit in auditContext (${JSON.stringify(raw)}), using default ${MYSTIQUE_URLS_LIMIT}`,
    );
    return MYSTIQUE_URLS_LIMIT;
  }
  if (n > MYSTIQUE_URLS_LIMIT) {
    log?.info(`${prefix} urlLimit ${n} exceeds cap ${MYSTIQUE_URLS_LIMIT}, using ${MYSTIQUE_URLS_LIMIT}`);
    return MYSTIQUE_URLS_LIMIT;
  }
  return n;
}

/**
 * Enqueues a domain-scoped offsite-brand-presence run so a single analysis audit can
 * obtain its own DRS-scraped content when none is available yet. The scoped run
 * collects + scrapes only `domainScope`, then (after DRS completes) re-triggers the
 * analysis audit — by which point its scraped content is available.
 *
 * @param {object} context - Universal context (sqs, dataAccess, log)
 * @param {string} siteId - The site ID
 * @param {string} domainScope - An OFFSITE_DOMAINS key (e.g. 'reddit.com') or 'top-cited'
 * @param {object} [slackContext] - Forwarded so notifications/results post to the thread
 *
 * Best-effort: a transient Configuration/SQS failure is logged and swallowed rather than
 * thrown, so the analysis audit degrades to its pending_scrape result instead of failing
 * the run with an opaque infra error.
 */
export async function requestOffsiteScrape(context, siteId, domainScope, slackContext) {
  const { sqs, dataAccess, log } = context;
  try {
    const configuration = await dataAccess.Configuration.findLatest();
    await sqs.sendMessage(configuration.getQueues().audits, {
      type: 'offsite-brand-presence',
      siteId,
      auditContext: {
        ...(slackContext && { slackContext }),
        messageData: { domainScope },
      },
    });
    log?.info(`Requested DRS scrape for '${domainScope}' (site ${siteId})`);
  } catch (error) {
    log?.warn(`Failed to request DRS scrape for '${domainScope}' (site ${siteId}): ${error.message}`);
  }
}
