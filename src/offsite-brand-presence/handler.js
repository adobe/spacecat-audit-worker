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

import DrsClient, {
  SCRAPE_DATASET_IDS,
  REDDIT_COMMENTS_SORT_BY_VALUES,
} from '@adobe/spacecat-shared-drs-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { getPreviousWeeks, loadBrandPresenceData } from '../utils/offsite-brand-presence-enrichment.js';
import { postMessageOptional } from '../utils/slack-utils.js';
import {
  DRS_URLS_LIMIT,
  RETRIABLE_STATUSES,
  RETRY_DELAY_MS,
  ACCEPTED_REGIONS,
  OFFSITE_DOMAINS,
  CITED_ANALYSIS_DRS_CONFIG,
  YOUTUBE_URL_REGEX,
  REDDIT_URL_REGEX,
  TOP_CITED_EXCLUDED_DOMAINS,
  DRS_POLL_INTERVAL_SECONDS,
  DRS_POLL_MAX_WAIT_SECONDS,
  DRS_STATUS_AUDIT_TYPE,
} from './constants.js';

/**
 * Extracts reddit_comments scrape parameters from Slack/API `messageData`.
 * Slack delivers keyword values as strings, so this normalizes them:
 *  - `redditCommentLimit` / `redditDaysBack` → positive integer (or undefined)
 *  - `redditSortBy` → allowlisted enum value; `'QA'` is normalized to `'Q&A'`
 *    so Slack users can avoid Slack mangling the ampersand. Unknown values
 *    are dropped.
 *  - `redditLoadAllReplies` → strict boolean (only the strings 'true'/'false'
 *    or real booleans are accepted; anything else is dropped)
 *
 * Invalid values are dropped rather than thrown — the DRS client validates and
 * surfaces a clear error.
 *
 * @param {object} [messageData]
 * @returns {{
 *   commentLimit?: number,
 *   sortBy?: string,
 *   daysBack?: number,
 *   loadAllReplies?: boolean,
 * }}
 */
function resolveRedditCommentsParams(messageData) {
  const md = messageData || {};
  const params = {};

  const parseInteger = (raw) => {
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  const commentLimit = parseInteger(md.redditCommentLimit);
  if (commentLimit !== undefined) {
    params.commentLimit = commentLimit;
  }

  const daysBack = parseInteger(md.redditDaysBack);
  if (daysBack !== undefined) {
    params.daysBack = daysBack;
  }

  if (md.redditSortBy !== undefined && md.redditSortBy !== null && md.redditSortBy !== '') {
    const sortBy = md.redditSortBy === 'QA' ? 'Q&A' : md.redditSortBy;
    if (REDDIT_COMMENTS_SORT_BY_VALUES.has(sortBy)) {
      params.sortBy = sortBy;
    }
  }

  const rawLoadAll = md.redditLoadAllReplies;
  if (rawLoadAll === true || rawLoadAll === 'true') {
    params.loadAllReplies = true;
  } else if (rawLoadAll === false || rawLoadAll === 'false') {
    params.loadAllReplies = false;
  }

  return params;
}

const LOG_PREFIX = '[OffsiteBrandPresence]';

// The top-cited bucket key (mirrors addUrlsToUrlStore) — also a valid granular scope.
const TOP_CITED_BUCKET = 'top-cited';
// Valid values for messageData.domainScope on granular single-audit runs.
const VALID_DOMAIN_SCOPES = new Set([...Object.keys(OFFSITE_DOMAINS), TOP_CITED_BUCKET]);

const DOMAIN_ALIASES = Object.freeze({
  'youtu.be': 'youtube.com',
});

/**
 * Normalizes a YouTube URL to keep only essential identifiers.
 * URL store canonicalizes URLs before storing, so we use the short form to match.
 * - /watch?v=VIDEO_ID → converts to short form https://youtu.be/VIDEO_ID
 * - /shorts/SHORT_ID → strips all query params
 *
 * @param {URL} parsed - Parsed URL object
 * @returns {string} Normalized URL
 */
function normalizeYoutubeUrl(parsed) {
  const { pathname } = parsed;

  if (pathname.startsWith('/watch')) {
    const videoId = parsed.searchParams.get('v');
    if (videoId) {
      return `https://youtu.be/${videoId}`;
    }
  }

  // For other YouTube URLs (shorts, channels, playlists, etc.), strip query params
  return `${parsed.origin}${pathname}`;
}

/**
 * Normalizes a parsed URL based on its domain to remove unnecessary query parameters
 * and ensure consistent formatting.
 *
 * @param {URL} parsed - Parsed URL object
 * @param {string|null} domain - The matched offsite domain, or null for generic URLs
 * @returns {string} The normalized URL
 */
function normalizeUrl(parsed, domain) {
  let url = domain === 'youtube.com'
    ? normalizeYoutubeUrl(parsed)
    : `${parsed.origin}${parsed.pathname}`;

  // Remove trailing slash (unless it's just the domain)
  if (url.endsWith('/') && parsed.pathname !== '/') {
    url = url.slice(0, -1);
  }

  return url;
}

/**
 * Classifies a URL into its matching offsite domain (if any) and normalizes it.
 * Returns domain info for all valid URLs — offsite domains get their matched key,
 * other URLs get domain: null. Filters out URLs belonging to the client's own site.
 *
 * @param {string} rawUrl - The raw URL string to classify and normalize
 * @param {string} [siteHostname] - The client site's hostname (www-stripped); URLs
 *   matching this hostname or any subdomain of it are excluded
 * @returns {{ url: string, domain: string|null } | null} Normalized URL with domain, or null
 */
function classifyAndNormalize(rawUrl, siteHostname) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
    parsed.protocol = 'https:';
  } catch {
    return null;
  }

  const { hostname } = parsed;

  if (siteHostname) {
    const bare = hostname.replace(/^www\./, '');
    if (bare === siteHostname || bare.endsWith(`.${siteHostname}`)) {
      return null;
    }
  }
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      if (domain === 'youtube.com' && !YOUTUBE_URL_REGEX.test(rawUrl)) {
        return null;
      }
      if (domain === 'reddit.com' && !REDDIT_URL_REGEX.test(rawUrl)) {
        return null;
      }
      return { url: normalizeUrl(parsed, domain), domain };
    }
  }

  // Tag (but don't scrape) these so selectTopUrls keeps them out of top-cited.
  for (const domain of TOP_CITED_EXCLUDED_DOMAINS) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return { url: normalizeUrl(parsed, domain), domain };
    }
  }

  const aliasedDomain = DOMAIN_ALIASES[hostname];
  if (aliasedDomain) {
    return { url: normalizeUrl(parsed, aliasedDomain), domain: aliasedDomain };
  }

  return { url: normalizeUrl(parsed, null), domain: null };
}

/**
 * Records a URL association for a topic, tracking category and prompt.
 *
 * @param {Map<string, {category: string, urlMap: Map}>} topicMap - Topic map (mutated)
 * @param {string} topicName - The topic name
 * @param {string} url - The normalized URL
 * @param {string} category - The category from the brand presence row
 * @param {string} prompt - The prompt from the brand presence row
 */
/* c8 ignore start */
// eslint-disable-next-line no-unused-vars
function trackTopicUrl(topicMap, topicName, url, category, prompt) {
  let topic = topicMap.get(topicName);
  if (!topic) {
    topic = { category, urlMap: new Map() };
    topicMap.set(topicName, topic);
  }
  let urlEntry = topic.urlMap.get(url);
  if (!urlEntry) {
    urlEntry = { category, subPrompts: new Set() };
    topic.urlMap.set(url, urlEntry);
  }
  if (prompt) {
    urlEntry.subPrompts.add(prompt);
  }
}
/* c8 ignore stop */

/**
 * Extracts URLs and topic associations from brand presence data rows in a single pass.
 * Populates both the global URL map (for URL store) and the topic map (for guideline store).
 * Only processes rows whose Region is in ACCEPTED_REGIONS.
 *
 * @param {object} data - Brand presence JSON data (expects a "data" array of rows)
 * @param {Map<string, {count: number, domain: string|null}>} allUrls - Global URL map (mutated)
 * @param {Map<string, {category: string, urlMap: Map}>} topicMap - Topic map (mutated)
 * @param {object} log - Logger instance
 * @param {string} [siteHostname] - Client site hostname to exclude
 */
function extractUrlsAndTopics(data, allUrls, topicMap, log, siteHostname) {
  const rows = data.data;
  for (const row of rows) {
    const sources = row.Sources?.trim();
    if (!sources || !ACCEPTED_REGIONS.has(row.Region)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    /* c8 ignore start */
    const topicName = row.Topics?.trim();
    const prompt = row.Prompt?.trim();
    const category = row.Category?.trim() || '';
    /* c8 ignore stop */

    for (const raw of sources.split(/[;\n]/)) {
      const trimmed = raw.trim();
      if (!trimmed) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const result = classifyAndNormalize(trimmed, siteHostname);
      if (!result) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const existing = allUrls.get(result.url);
      if (existing) {
        existing.count += 1;
      } else {
        allUrls.set(result.url, { count: 1, domain: result.domain });
      }

      /* c8 ignore start */
      if (topicName) {
        trackTopicUrl(topicMap, topicName, result.url, category, prompt);
      }
      /* c8 ignore stop */
    }
  }
  log.info(`${LOG_PREFIX} Found ${allUrls.size} unique source URLs`);
}

/**
 * Persists offsite-domain and top-cited URLs to the URL store.
 * Returns the successfully stored offsite URLs organized by domain,
 * suitable for passing directly to triggerDrsScraping.
 *
 * @param {string} siteId - The site ID
 * @param {Object<string, string[]>} topByDomain - Top URLs per offsite domain
 * @param {string[]} topCited - Top cited non-offsite URLs
 * @param {object} dataAccess - Data access layer from context
 * @param {object} log - Logger instance
 * @returns {Promise<Object<string, string[]>>} Stored URLs keyed by domain
 */
async function addUrlsToUrlStore(siteId, topByDomain, topCited, dataAccess, log) {
  const { AuditUrl } = dataAccess;

  const entries = [];
  for (const [domain, config] of Object.entries(OFFSITE_DOMAINS)) {
    const urls = topByDomain[domain];
    for (const url of urls) {
      entries.push({ url, audits: [config.auditType] });
    }
    log.info(`${LOG_PREFIX} Selected top ${urls.length} ${domain} URLs (limit ${DRS_URLS_LIMIT})`);
  }
  for (const url of topCited) {
    entries.push({ url, audits: [CITED_ANALYSIS_DRS_CONFIG.auditType] });
  }
  log.info(`${LOG_PREFIX} Selected top ${topCited.length} cited URLs excluding offsite domains (limit ${DRS_URLS_LIMIT})`);
  log.info(`${LOG_PREFIX} Adding ${entries.length} URLs to URL store`);

  let existingUrlSet;
  try {
    const keys = entries.map((e) => ({ siteId, url: e.url }));
    const { data: existingUrls } = await AuditUrl.batchGetByKeys(keys);
    existingUrlSet = new Set(existingUrls.map((u) => u.getUrl()));
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to check existing URLs: ${error.message}`);
    return {};
  }

  const results = await Promise.all(
    entries.map(async (entry) => {
      if (existingUrlSet.has(entry.url)) {
        return entry.url;
      }
      try {
        await AuditUrl.create({
          siteId,
          url: entry.url,
          byCustomer: false,
          audits: entry.audits,
          createdBy: 'system',
          updatedBy: 'system',
        });
        return entry.url;
      } catch (createError) {
        log.warn(`${LOG_PREFIX} Failed to add URL to store: ${entry.url} - ${createError.message}`);
        return null;
      }
    }),
  );

  const storedUrls = new Set(results.filter(Boolean));
  const existingCount = existingUrlSet.size;
  const createdCount = storedUrls.size - existingCount;
  const failCount = entries.length - storedUrls.size;

  log.info(`${LOG_PREFIX} URL store complete: ${createdCount} created, ${existingCount} already existed, ${failCount} failed`);

  const storedByDomain = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    storedByDomain[domain] = topByDomain[domain].filter((url) => storedUrls.has(url));
  }
  storedByDomain['top-cited'] = topCited.filter((url) => storedUrls.has(url));

  return storedByDomain;
}

/**
 * Fetches all existing SentimentTopic entities for a site and indexes them by topic name.
 * This handles paginated results so reconciliation sees the full current topic set.
 *
 * @param {string} siteId - The site ID
 * @param {object} SentimentTopic - SentimentTopic collection from data access
 * @returns {Promise<Map<string, object>>} Existing topics keyed by name
 */
/* c8 ignore start */
async function fetchExistingTopicsByName(siteId, SentimentTopic) {
  const existingByName = new Map();
  let cursor = null;

  do {
    // eslint-disable-next-line no-await-in-loop
    const result = await SentimentTopic.allBySiteId(siteId, cursor ? { cursor } : {});
    for (const topic of (result.data || [])) {
      existingByName.set(topic.getName(), topic);
    }
    cursor = result.cursor || null;
  } while (cursor);

  return existingByName;
}
/* c8 ignore stop */

/**
 * Persists topic data to the guideline store as SentimentTopic entities.
 * Updates existing topics (matched by name) or creates new ones.
 * The timesCited for each URL is taken from the global allUrls map.
 *
 * @param {string} siteId - The site ID
 * @param {Map<string, {category: string, urlMap: Map}>} topicMap - Aggregated topic data
 * @param {Map<string, {count: number, domain: string|null}>} allUrls - Global URL citation map
 * @param {object} dataAccess - Data access layer from context
 * @param {object} log - Logger instance
 */
/* c8 ignore start */
// eslint-disable-next-line no-unused-vars
async function addTopicsToGuidelineStore(siteId, topicMap, allUrls, dataAccess, log) {
  const { SentimentTopic } = dataAccess;
  const existingByName = await fetchExistingTopicsByName(siteId, SentimentTopic);

  const entries = [...topicMap.entries()];
  log.info(`${LOG_PREFIX} Persisting ${entries.length} topics to guideline store (${existingByName.size} existing)`);

  const results = await Promise.all(
    entries.map(async ([name, topicData]) => {
      try {
        const urls = [...topicData.urlMap.entries()]
          .map(([url, info]) => ({
            url,
            timesCited: allUrls.get(url).count,
            category: info.category,
            subPrompts: [...info.subPrompts],
          }));

        const existing = existingByName.get(name);
        if (existing) {
          existing.setDescription('');
          existing.setUrls(urls);
          existing.setEnabled(true);
          existing.setUpdatedBy('system');
          await existing.save();
          return 'updated';
        }

        await SentimentTopic.create({
          siteId,
          name,
          description: '',
          urls,
          enabled: true,
          createdBy: 'system',
        });
        return 'created';
      } catch (error) {
        log.warn(`${LOG_PREFIX} Failed to save topic ${name}: ${error.message}`);
        return 'error';
      }
    }),
  );

  const created = results.filter((r) => r === 'created').length;
  const updated = results.filter((r) => r === 'updated').length;
  const failed = results.filter((r) => r === 'error').length;

  log.info(`${LOG_PREFIX} Guideline store complete: ${created} created, ${updated} updated, ${failed} failed`);
}
/* c8 ignore stop */

/**
 * Determines whether an error is worth retrying.
 * Retries on network-level failures (TypeError from fetch) and specific HTTP
 * status codes that indicate transient server problems.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isRetriable(err) {
  if (err instanceof TypeError) {
    return true;
  }
  return typeof err.status === 'number' && RETRIABLE_STATUSES.has(err.status);
}

/**
 * Submits a single DRS job with one selective retry.
 * Only retries on network errors (TypeError) and retriable HTTP status codes
 * (408, 429, 500, 502, 503, 504). Non-retriable errors (4xx) fail immediately.
 *
 * NOTE: POST /jobs is not idempotent and DRS does not support an idempotency
 * key. A request that times out client-side but lands server-side may produce
 * a duplicate job. The retry is limited to one attempt to minimise this risk.
 *
 * @param {{ domain: string, datasetId: string, params: object }} job
 * @param {Function} submitFn - Async function that submits the job
 * @param {object} log - Logger
 * @returns {Promise<object>} Job result with status
 */
async function submitWithRetry({ domain, datasetId, params }, submitFn, log) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const start = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const result = await submitFn(params);
      log.info(`${LOG_PREFIX} DRS job created for ${domain}/${datasetId}: jobId=${result?.job_id} (${Date.now() - start}ms)`);
      return {
        domain, datasetId, status: 'success', response: result,
      };
    } catch (err) {
      if (attempt === 0 && isRetriable(err)) {
        log.warn(`${LOG_PREFIX} DRS job for ${domain}/${datasetId} failed (attempt 1), retrying in ${RETRY_DELAY_MS}ms: ${err.message}`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, RETRY_DELAY_MS);
        });
      } else {
        const label = attempt === 0 ? '' : ' after retry';
        log.error(`${LOG_PREFIX} DRS job failed for ${domain}/${datasetId}${label}: ${err.message}`);
        return {
          domain, datasetId, status: 'error', error: err.message,
        };
      }
    }
  }
  /* c8 ignore next 4 */
  return {
    domain, datasetId, status: 'error', error: 'unexpected',
  };
}

/**
 * Triggers DRS (Data Retrieval Service) scraping jobs for the collected URLs.
 * For each domain, one job is created per dataset_id defined in OFFSITE_DOMAINS.
 * Top-cited URLs use CITED_ANALYSIS_DRS_CONFIG for their dataset configuration.
 *
 * When spacecatOrgId is provided, it is passed through to
 * drsClient.submitScrapeJob and included as spacecat_org_id in the DRS request.
 *
 * DRS auto-resolves the customer's imsOrgId (and brand) from site_id by reading
 * the SpaceCat organization, and rejects the job with HTTP 400 when that
 * resolution fails (i.e. the organization has no imsOrgId). Because the caller
 * reads imsOrgId from the same organization, an absent imsOrgId reliably
 * predicts that DRS resolution would fail, so we skip submission rather than
 * fire jobs that are guaranteed to 400.
 *
 * Reddit-comments params (`commentLimit`, `sortBy`, `daysBack`,
 * `loadAllReplies`) are only attached to the `reddit_comments` dataset. When
 * they are omitted, the DRS client applies its defaults (`commentLimit=150`,
 * `sortBy='Best'`, no `daysBack`, no `loadAllReplies`).
 *
 * @param {object} urlsByDomain - Map of domain/bucket to array of URL strings
 * @param {string} siteId - The site ID
 * @param {object} context - Context with env and log
 * @param {string} [spacecatOrgId] - Optional SpaceCat org ID
 * @param {string} [imsOrgId] - IMS org ID resolved from the site's organization.
 *   When falsy, DRS scraping is skipped (see above).
 * @param {object} [redditCommentsParams] - Per-run reddit_comments scrape params
 *   (see {@link resolveRedditCommentsParams})
 * @returns {Promise<{skipped: (string|null), results: Array}>} `skipped` is a
 *   human-readable reason when scraping was skipped (and `results` is empty),
 *   otherwise `null` with the DRS job creation results.
 */
async function triggerDrsScraping(
  urlsByDomain,
  siteId,
  context,
  spacecatOrgId,
  imsOrgId,
  redditCommentsParams = {},
) {
  const { log } = context;
  const drsClient = DrsClient.createFrom(context);

  if (!drsClient.isConfigured()) {
    log.error(`${LOG_PREFIX} DRS_API_URL or DRS_API_KEY not configured, skipping DRS scraping`);
    return { skipped: 'DRS is not configured (DRS_API_URL/DRS_API_KEY missing)', results: [] };
  }

  // DRS rejects scrape jobs (HTTP 400) unless it can resolve the customer's
  // imsOrgId from the site_id, which requires the SpaceCat organization to have
  // imsOrgId set. Resolve it here as a faithful pre-flight check: if it is
  // missing we skip rather than fire jobs that are guaranteed to fail.
  if (!imsOrgId) {
    log.warn(`${LOG_PREFIX} Site ${siteId} organization has no imsOrgId, skipping DRS scraping. Populate imsOrgId on the SpaceCat organization to enable offsite brand presence scraping.`);
    return {
      skipped: 'organization has no imsOrgId — populate imsOrgId on the SpaceCat organization to enable scraping',
      results: [],
    };
  }

  const jobs = [];
  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    const urlList = Array.from(urls);

    if (urlList.length === 0) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const { datasetIds } = OFFSITE_DOMAINS[domain] || CITED_ANALYSIS_DRS_CONFIG;

    for (const datasetId of datasetIds) {
      const scrapeUrls = datasetId === SCRAPE_DATASET_IDS.TOP_CITED
        ? urlList.map((url) => ({ url }))
        : urlList;
      // imsOrgId is guaranteed truthy here (the guard above returns early when
      // it is absent). DRS attaches it as parameters.metadata.imsOrgId to scope
      // the job's S2S token instead of relying on site_id auto-resolution.
      const params = {
        datasetId, siteId, urls: scrapeUrls, imsOrgId,
      };
      if (datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS) {
        Object.assign(params, redditCommentsParams);
      }
      if (spacecatOrgId) {
        params.spacecatOrgId = spacecatOrgId;
      }
      jobs.push({ domain, datasetId, params });
    }
  }

  const orgSuffix = spacecatOrgId ? ` (with spacecat_org_id: ${spacecatOrgId})` : '';
  log.info(`${LOG_PREFIX} Submitting ${jobs.length} DRS scrape jobs${orgSuffix}`);

  const results = [];
  for (const job of jobs) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await submitWithRetry(job, (p) => drsClient.submitScrapeJob(p), log));
  }
  return { skipped: null, results };
}

/**
 * Sorts all URLs by citation count once, then partitions them into per-domain
 * buckets and a top-cited bucket in a single pass.
 *
 * @param {Map<string, {count: number, domain: string|null}>} allUrls - Unified URL map
 * @param {number} maxUrlsPerBucket - Max URLs to select per bucket (domain or top-cited)
 * @param {string[]} excludedFromTopCited - Domains to exclude from top-cited results
 * @returns {{ topByDomain: Object<string, string[]>, topCited: string[] }}
 */
function selectTopUrls(allUrls, maxUrlsPerBucket, excludedFromTopCited) {
  const excluded = new Set(excludedFromTopCited);
  const sorted = [...allUrls.entries()].sort((a, b) => b[1].count - a[1].count);

  const topByDomain = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    topByDomain[domain] = [];
  }
  const topCited = [];

  for (const [url, info] of sorted) {
    const domainBucket = info.domain !== null ? topByDomain[info.domain] : undefined;
    if (domainBucket !== undefined && domainBucket.length < maxUrlsPerBucket) {
      domainBucket.push(url);
    }
    if (!excluded.has(info.domain) && topCited.length < maxUrlsPerBucket) {
      topCited.push(url);
    }
  }

  return { topByDomain, topCited };
}

/**
 * Restricts the selected buckets to a single scope for granular single-audit runs.
 * Non-scoped per-domain buckets are emptied (kept as keys so addUrlsToUrlStore stays
 * happy); `'top-cited'` keeps only the top-cited bucket, any other value keeps only
 * that offsite-domain bucket.
 *
 * @param {Object<string, string[]>} topByDomain
 * @param {string[]} topCited
 * @param {string} domainScope - An OFFSITE_DOMAINS key or 'top-cited'
 * @returns {{ topByDomain: Object<string, string[]>, topCited: string[] }}
 */
function scopeBucketsToDomain(topByDomain, topCited, domainScope) {
  const scoped = {};
  for (const domain of Object.keys(topByDomain)) {
    scoped[domain] = domain === domainScope ? topByDomain[domain] : [];
  }
  return { topByDomain: scoped, topCited: domainScope === TOP_CITED_BUCKET ? topCited : [] };
}

/**
 * Sends a Slack notification when DRS scraping was skipped before any jobs were
 * triggered (e.g. DRS not configured, or the organization has no imsOrgId).
 * Posts only when a Slack thread context is available (manual runs);
 * postMessageOptional no-ops on scheduled runs.
 *
 * @param {string} reason - Human-readable reason scraping was skipped
 * @param {string} baseURL - The site's base URL
 * @param {object} context - The execution context
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Slack thread timestamp
 */
async function notifyDrsSkipped(reason, baseURL, context, channelId, threadTs) {
  const text = `:warning: *offsite-brand-presence* DRS scraping *skipped* for *${baseURL}* — ${reason}.`;
  await postMessageOptional(context, channelId, text, { threadTs });
}

/**
 * Sends a Slack notification summarizing DRS job results.
 *
 * @param {Array} drsResults - Array of DRS job result objects
 * @param {string} baseURL - The site's base URL
 * @param {object} context - The execution context
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Slack thread timestamp
 */
async function notifyDrsResults(drsResults, baseURL, context, channelId, threadTs) {
  if (drsResults.length === 0) {
    return;
  }

  const succeeded = drsResults.filter((r) => r.status === 'success');
  const failed = drsResults.filter((r) => r.status === 'error');
  const lines = [
    `:white_check_mark: *offsite-brand-presence* DRS jobs for *${baseURL}*:`,
    ...succeeded.map((r) => `• \`${r.domain}\` / \`${r.datasetId}\` → job_id: \`${r.response?.job_id}\``),
    ...(failed.length > 0 ? [
      `:x: *Failed (${failed.length}):*`,
      ...failed.map((r) => `• \`${r.domain}\` / \`${r.datasetId}\` → ${r.error}`),
    ] : []),
  ];
  await postMessageOptional(context, channelId, lines.join('\n'), { threadTs });
}

/**
 * Schedules a delayed DRS status poll for the jobs that were submitted successfully.
 * Only runs for manual Slack runs (channelId + threadTs present) with at least one
 * job_id to track; scheduled runs and submission-only failures are skipped. The poll
 * message carries the job list, Slack context, and an absolute deadline so each poll
 * invocation is self-describing.
 *
 * @param {Array} drsResults - DRS job results from triggerDrsScraping
 * @param {string} baseURL - The site's base URL
 * @param {string} siteId - The site ID
 * @param {object} context - The execution context (sqs, dataAccess, log)
 * @param {string} channelId - Slack channel ID
 * @param {string} threadTs - Slack thread timestamp
 */
async function scheduleDrsStatusPoll(drsResults, baseURL, siteId, context, channelId, threadTs) {
  const { sqs, dataAccess, log } = context;

  if (!channelId || !threadTs) {
    return;
  }

  const jobs = drsResults
    .filter((r) => r.status === 'success' && r.response?.job_id)
    .map((r) => ({ domain: r.domain, datasetId: r.datasetId, jobId: r.response.job_id }));

  if (jobs.length === 0) {
    return;
  }

  const configuration = await dataAccess.Configuration.findLatest();
  await sqs.sendMessage(configuration.getQueues().audits, {
    type: DRS_STATUS_AUDIT_TYPE,
    siteId,
    auditContext: {
      baseURL,
      slackContext: { channelId, threadTs },
      jobs,
      deadline: Date.now() + DRS_POLL_MAX_WAIT_SECONDS * 1000,
    },
  }, null, DRS_POLL_INTERVAL_SECONDS);

  log.info(`${LOG_PREFIX} Scheduled DRS status poll for ${baseURL} (${jobs.length} jobs)`);
}

/**
 * Main runner for the offsite-brand-presence audit.
 *
 * Workflow:
 * 1. Fetches query-index.json from the Spacecat API
 * 2. Fetches brand presence data for each provider from the Spacecat API
 * 3. Collects all source URLs with citation counts and topic associations in a single pass
 * 4. Extracts top URLs per offsite domain and top cited URLs (excluding reddit/youtube)
 * 5. Persists selected URLs to the URL store, then triggers DRS scraping
 *    only for offsite URLs that were successfully stored
 * 6. Persists topic data to the guideline store as SentimentTopic entities
 *
 * @param {string} finalUrl - The resolved audit URL
 * @param {object} context - The execution context
 * @param {object} site - The site being audited
 * @returns {Promise<object>} Audit result
 */
export async function offsiteBrandPresenceRunner(finalUrl, context, site, auditContext) {
  const { dataAccess, log } = context;
  const { slackContext, messageData } = auditContext || {};
  const spacecatOrgId = messageData?.spacecatOrgId;
  // Granular single-audit runs (triggered by an analysis audit that found no scraped
  // content) scope collection + scraping to one bucket so only that audit re-triggers.
  const domainScope = messageData?.domainScope;
  const redditCommentsParams = resolveRedditCommentsParams(messageData);
  const { channelId, threadTs } = slackContext || {};
  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  // Fail fast on an unrecognized scope: scoping to an unknown bucket would silently
  // empty every bucket and produce a no-op scrape → poll → re-trigger chain.
  if (domainScope && !VALID_DOMAIN_SCOPES.has(domainScope)) {
    log.error(`${LOG_PREFIX} Unknown domainScope '${domainScope}', aborting run`);
    return {
      auditResult: { success: false, error: `Unknown domainScope: ${domainScope}` },
      fullAuditRef: finalUrl,
    };
  }

  const organization = await site.getOrganization();
  const imsOrgId = organization?.getImsOrgId();
  const previousWeeks = getPreviousWeeks();
  const weekLabels = previousWeeks
    .map(({ week, year }) => `w${String(week).padStart(2, '0')}-${year}`)
    .join(', ');

  log.info(`${LOG_PREFIX} Starting audit for site: ${siteId} (${baseURL}), weeks: ${weekLabels}`);

  let siteHostname;
  try {
    siteHostname = new URL(baseURL).hostname.replace(/^www\./, '');
  } catch {
    log.warn(`${LOG_PREFIX} Could not parse baseURL "${baseURL}", skipping site URL filter`);
  }

  const brandPresenceData = await loadBrandPresenceData({
    siteId, site, previousWeeks, context,
  });

  const allUrls = new Map();
  if (brandPresenceData) {
    const topicMap = new Map();
    extractUrlsAndTopics(brandPresenceData, allUrls, topicMap, log, siteHostname);
  }

  log.info(`${LOG_PREFIX} Total unique source URLs found: ${allUrls.size}`);

  // Compute per-domain counts for audit result
  const urlCounts = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    urlCounts[domain] = 0;
  }
  for (const [, info] of allUrls) {
    if (info.domain !== null && urlCounts[info.domain] !== undefined) {
      urlCounts[info.domain] += 1;
    }
  }

  if (allUrls.size === 0) {
    log.info(`${LOG_PREFIX} No offsite URLs found, audit complete`);
    return {
      auditResult: {
        success: true,
        urlCounts,
        weeks: previousWeeks,
      },
      fullAuditRef: finalUrl,
    };
  }

  // Sort once, partition into per-domain + top-cited buckets
  const excludedFromTopCited = [...Object.keys(OFFSITE_DOMAINS), ...TOP_CITED_EXCLUDED_DOMAINS];
  let { topByDomain, topCited } = selectTopUrls(allUrls, DRS_URLS_LIMIT, excludedFromTopCited);

  if (domainScope) {
    ({ topByDomain, topCited } = scopeBucketsToDomain(topByDomain, topCited, domainScope));
    log.info(`${LOG_PREFIX} Scoped run to '${domainScope}'`);
  }

  const storedByDomain = await addUrlsToUrlStore(siteId, topByDomain, topCited, dataAccess, log);
  const { skipped, results: drsResults } = await triggerDrsScraping(
    storedByDomain,
    siteId,
    context,
    spacecatOrgId,
    imsOrgId,
    redditCommentsParams,
  );

  if (skipped) {
    await notifyDrsSkipped(skipped, baseURL, context, channelId, threadTs);
  } else {
    await notifyDrsResults(drsResults, baseURL, context, channelId, threadTs);
    // Best-effort follow-up: a failure here (e.g. transient Configuration/SQS error)
    // must not fail the run, which already submitted the DRS jobs (POST /jobs is not
    // idempotent) and posted the initial notification. Re-running would duplicate both.
    try {
      await scheduleDrsStatusPoll(drsResults, baseURL, siteId, context, channelId, threadTs);
    } catch (err) {
      log.warn(`${LOG_PREFIX} Failed to schedule DRS status poll: ${err.message}`);
    }
  }

  // TODO: temporarily disabled
  // if (topicMap.size > 0) {
  //   await addTopicsToGuidelineStore(siteId, topicMap, allUrls, dataAccess, log);
  // }

  log.info(`${LOG_PREFIX} Audit complete for site ${siteId}: ${allUrls.size} URLs processed, ${drsResults.length} DRS jobs triggered`);

  return {
    auditResult: {
      success: true,
      urlCounts,
      drsJobs: drsResults,
      weeks: previousWeeks,
    },
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(offsiteBrandPresenceRunner)
  .build();
