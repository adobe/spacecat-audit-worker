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

import { isoCalendarWeek, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import DrsClient, { SCRAPE_DATASET_IDS } from '@adobe/spacecat-shared-drs-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import {
  BRAND_PRESENCE_REGEX,
  DRS_URLS_LIMIT,
  FETCH_PAGE_SIZE,
  FETCH_TIMEOUT_MS,
  INCLUDE_COLUMNS,
  REDDIT_COMMENTS_DAYS_BACK,
  OFFSITE_DOMAINS,
  PROVIDERS_SET,
  TOP_CITED_DRS_CONFIG,
} from './constants.js';

const LOG_PREFIX = '[OffsiteBrandPresence]';

const DOMAIN_ALIASES = Object.freeze({
  'youtu.be': 'youtube.com',
});

/**
 * Gets the previous ISO week number and year.
 * @returns {{ week: number, year: number }} Previous week number and year
 */
function getPreviousWeek() {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 7);
  return isoCalendarWeek(now);
}

/**
 * Fetches query-index.json for a site via the Spacecat API.
 *
 * @param {string} siteId - The site ID
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<object|null>} Parsed JSON data or null if the request failed
 */
async function fetchQueryIndex(siteId, env, log) {
  const apiBase = env.SPACECAT_API_URI;
  const apiKey = env.SPACECAT_API_KEY;
  const url = `${apiBase}/sites/${siteId}/llmo/data/query-index.json`;

  log.info(`${LOG_PREFIX} Fetching query-index from: ${url}`);

  try {
    const headers = { 'x-api-key': apiKey };
    const response = await fetch(url, { headers, timeout: FETCH_TIMEOUT_MS });

    if (!response.ok) {
      log.warn(`${LOG_PREFIX} Failed to fetch query-index: ${response.status}`);
      return null;
    }

    return response.json();
  } catch (error) {
    log.error(`${LOG_PREFIX} Error fetching query-index: ${error.message}`);
    return null;
  }
}

/**
 * Fetches brand presence JSON data for a specific file via the Spacecat API.
 * Uses pagination (limit/offset) to handle large files that would otherwise
 * exceed the API's response size limit (HTTP 413).
 *
 * @param {string} siteId - The site ID
 * @param {string} fileName - The brand presence file path relative to the llmo data directory
 *                            (e.g. 'brand-presence/w7/brandpresence-copilot-w7-2026-010126.json')
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<object|null>} Parsed JSON data or null if not found
 */
async function fetchBrandPresenceData(siteId, fileName, env, log) {
  const apiBase = env.SPACECAT_API_URI;
  const apiKey = env.SPACECAT_API_KEY;
  const headers = { 'x-api-key': apiKey };
  const baseUrl = `${apiBase}/sites/${siteId}/llmo/data/${fileName}?sheet=all&include=${INCLUDE_COLUMNS}`;

  let allRows = [];
  let offset = 0;
  let hasMore = true;

  log.info(`${LOG_PREFIX} Fetching brand presence data from: ${baseUrl}`);
  while (hasMore) {
    const url = `${baseUrl}&limit=${FETCH_PAGE_SIZE}&offset=${offset}`;

    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(url, { headers, timeout: FETCH_TIMEOUT_MS });

    if (!response.ok) {
      // eslint-disable-next-line no-await-in-loop
      const errorBody = await response.text().catch(() => '(unable to read body)');
      log.warn(`${LOG_PREFIX} Failed to fetch data for ${fileName}: ${response.status}`, {
        url,
        status: response.status,
        statusText: response.statusText,
        responseBody: errorBody,
      });
      if (allRows.length === 0) {
        return null;
      }
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const data = await response.json();
    const rows = data?.data || [];
    allRows = allRows.concat(rows);

    if (rows.length < FETCH_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += FETCH_PAGE_SIZE;
    }
  }
  return { data: allRows };
}

/**
 * Attempts to extract a matching brand presence file path from a query-index entry.
 * Returns the relative file path if it matches the target week and a known provider,
 * or null otherwise.
 *
 * @param {object} entry - A single query-index entry
 * @param {number} targetWeek - The target week number to match
 * @param {number} targetYear - The target year to match
 * @returns {string|null} The matched file path, or null
 */
function matchBrandPresenceEntry(entry, targetWeek, targetYear) {
  if (!entry?.path) return null;

  const bpIdx = entry.path.indexOf('brand-presence/');
  if (bpIdx === -1) return null;

  const filePath = entry.path.substring(bpIdx);
  const match = filePath.match(BRAND_PRESENCE_REGEX);
  if (!match) return null;

  const [, providerId, weekStr, yearStr] = match;
  const fileWeek = Number.parseInt(weekStr, 10);
  const fileYear = Number.parseInt(yearStr, 10);
  const yearMatches = fileYear === targetYear;

  if (fileWeek === targetWeek && yearMatches && PROVIDERS_SET.has(providerId)) {
    return filePath;
  }
  return null;
}

/**
 * Filters brand presence file paths from the query-index response.
 * Only returns files matching the pattern brandpresence-{provider}-w{week}-{year}-*.json
 * where the provider is in PROVIDERS and both week and year match the targets.
 *
 * @param {object} queryIndex - The parsed query-index response
 * @param {number} targetWeek - The target week number to match
 * @param {number} targetYear - The target year to match
 * @returns {string[]} Matched file paths relative to the llmo data directory
 */
export function filterBrandPresenceFiles(queryIndex, targetWeek, targetYear) {
  const entries = queryIndex?.data || [];
  const matched = [];

  for (const entry of entries) {
    const filePath = matchBrandPresenceEntry(entry, targetWeek, targetYear);
    if (filePath) {
      matched.push(filePath);
    }
  }
  return matched;
}

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
 * other URLs get domain: null.
 *
 * @param {string} rawUrl - The raw URL string to classify and normalize
 * @returns {{ url: string, domain: string|null } | null} Normalized URL with domain, or null
 */
function classifyAndNormalize(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
    parsed.protocol = 'https:';
  } catch {
    return null;
  }

  const { hostname } = parsed;
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
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

/**
 * Extracts URLs and topic associations from brand presence data rows in a single pass.
 * Populates both the global URL map (for URL store) and the topic map (for guideline store).
 * Only processes rows with Region=US.
 *
 * @param {object} data - Brand presence JSON data (expects a "data" array of rows)
 * @param {Map<string, {count: number, domain: string|null}>} allUrls - Global URL map (mutated)
 * @param {Map<string, {category: string, urlMap: Map}>} topicMap - Topic map (mutated)
 * @param {object} log - Logger instance
 */
function extractUrlsAndTopics(data, allUrls, topicMap, log) {
  const rows = data.data;
  for (const row of rows) {
    const sources = row.Sources?.trim();
    if (!sources || row.Region !== 'US') {
      // eslint-disable-next-line no-continue
      continue;
    }

    const topicName = row.Topic?.trim();
    const prompt = row.Prompt?.trim();
    const category = row.Category?.trim() || '';

    for (const raw of sources.split(/[;\n]/)) {
      const trimmed = raw.trim();
      if (!trimmed) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const result = classifyAndNormalize(trimmed);
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

      if (topicName) {
        trackTopicUrl(topicMap, topicName, result.url, category, prompt);
      }
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
    entries.push({ url, audits: [TOP_CITED_DRS_CONFIG.auditType] });
  }
  log.info(`${LOG_PREFIX} Selected top ${topCited.length} cited URLs excluding offsite domains (limit ${DRS_URLS_LIMIT})`);
  log.info(`${LOG_PREFIX} Adding ${entries.length} URLs to URL store`);

  const results = await Promise.all(
    entries.map(async (entry) => {
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
      } catch (error) {
        log.warn(`${LOG_PREFIX} Failed to add URL to store: ${entry.url} - ${error.message}`);
        return null;
      }
    }),
  );

  const storedUrls = new Set(results.filter(Boolean));
  const failCount = results.length - storedUrls.size;

  log.info(`${LOG_PREFIX} URL store complete: ${storedUrls.size} created, ${failCount} failed`);

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

/**
 * Triggers DRS (Data Retrieval Service) scraping jobs for the collected URLs.
 * For each domain, one job is created per dataset_id defined in OFFSITE_DOMAINS.
 * Top-cited URLs use TOP_CITED_DRS_CONFIG for their dataset configuration.
 *
 * @param {object} urlsByDomain - Map of domain/bucket to array of URL strings
 * @param {string} siteId - The site ID
 * @param {object} context - Context with env and log
 * @returns {Promise<Array>} Results of DRS job creation
 */
async function triggerDrsScraping(urlsByDomain, siteId, context) {
  const { log } = context;
  const drsClient = DrsClient.createFrom(context);

  if (!drsClient.isConfigured()) {
    log.error(`${LOG_PREFIX} DRS_API_URL or DRS_API_KEY not configured, skipping DRS scraping`);
    return [];
  }

  const jobs = [];
  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    const urlList = Array.from(urls);

    if (urlList.length === 0) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const { datasetIds } = OFFSITE_DOMAINS[domain] || TOP_CITED_DRS_CONFIG;

    for (const datasetId of datasetIds) {
      const params = { datasetId, siteId, urls: urlList };
      if (datasetId === SCRAPE_DATASET_IDS.REDDIT_COMMENTS) {
        params.daysBack = REDDIT_COMMENTS_DAYS_BACK;
      }
      jobs.push({ domain, datasetId, params });
    }
  }

  log.info(`${LOG_PREFIX} Submitting ${jobs.length} DRS scrape jobs`);

  return Promise.all(
    jobs.map(async ({ domain, datasetId, params }) => {
      try {
        const result = await drsClient.submitScrapeJob(params);
        log.info(`${LOG_PREFIX} DRS job created for ${domain}/${datasetId}: jobId=${result.job_id}`);
        return {
          domain, datasetId, status: 'success', response: result,
        };
      } catch (err) {
        log.error(`${LOG_PREFIX} DRS job failed for ${domain}/${datasetId}: ${err.message}`);
        return {
          domain, datasetId, status: 'error', error: err.message,
        };
      }
    }),
  );
}

/**
 * Fetches matched brand presence files sequentially and aggregates
 * all source URLs and topic associations across files.
 *
 * @param {string} siteId - The site ID
 * @param {string[]} matchedFiles - File paths to fetch
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<{allUrls: Map, topicMap: Map}>} Unified URL map and topic map
 */
async function fetchAndAggregateData(siteId, matchedFiles, env, log) {
  const allUrls = new Map();
  const topicMap = new Map();

  for (const filePath of matchedFiles) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const data = await fetchBrandPresenceData(siteId, filePath, env, log);
      if (!data) {
        // eslint-disable-next-line no-continue
        continue;
      }

      extractUrlsAndTopics(data, allUrls, topicMap, log);
    } catch (err) {
      log.error(`${LOG_PREFIX} Error fetching brand presence file ${filePath}: ${err.message}`);
    }
  }

  log.info(`${LOG_PREFIX} Extracted ${topicMap.size} unique topics`);
  return { allUrls, topicMap };
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
export async function offsiteBrandPresenceRunner(finalUrl, context, site) {
  const { dataAccess, env, log } = context;
  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  log.info(`${LOG_PREFIX} Starting audit for site: ${siteId} (${baseURL})`);

  if (!env.SPACECAT_API_URI || !env.SPACECAT_API_KEY) {
    log.error(`${LOG_PREFIX} SPACECAT_API_URI or SPACECAT_API_KEY not configured`);
    return {
      auditResult: { success: false, error: 'SPACECAT_API_URI or SPACECAT_API_KEY not configured' },
      fullAuditRef: finalUrl,
    };
  }

  // Fetch query-index.json
  const queryIndex = await fetchQueryIndex(siteId, env, log);
  if (!queryIndex) {
    log.error(`${LOG_PREFIX} Failed to fetch query-index for site ${siteId}`);
    return {
      auditResult: { success: false, error: 'Failed to fetch query-index' },
      fullAuditRef: finalUrl,
    };
  }

  const { week, year } = getPreviousWeek();
  const weekIndex = String(week).padStart(2, '0');

  log.info(`${LOG_PREFIX} Processing week w${weekIndex} of year ${year}`);

  // Filter brand presence files from query-index for the previous week
  const matchedFiles = filterBrandPresenceFiles(queryIndex, week, year);
  log.info(`${LOG_PREFIX} Found ${matchedFiles.length} brand presence files for week w${weekIndex}`);

  // Fetch all matched files and collect source URLs + topic associations
  const { allUrls, topicMap } = await fetchAndAggregateData(siteId, matchedFiles, env, log);
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
        week: weekIndex,
        year,
      },
      fullAuditRef: finalUrl,
    };
  }

  // Sort once, partition into per-domain + top-cited buckets
  const excludedFromTopCited = Object.keys(OFFSITE_DOMAINS);
  const {
    topByDomain, topCited,
  } = selectTopUrls(allUrls, DRS_URLS_LIMIT, excludedFromTopCited);

  const storedByDomain = await addUrlsToUrlStore(siteId, topByDomain, topCited, dataAccess, log);
  const drsResults = await triggerDrsScraping(storedByDomain, siteId, context);

  if (topicMap.size > 0) {
    await addTopicsToGuidelineStore(siteId, topicMap, allUrls, dataAccess, log);
  }

  log.info(`${LOG_PREFIX} Audit complete for site ${siteId}: ${allUrls.size} URLs processed, ${drsResults.length} DRS jobs triggered`);

  return {
    auditResult: {
      success: true,
      urlCounts,
      drsJobs: drsResults,
      week: weekIndex,
      year,
    },
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(offsiteBrandPresenceRunner)
  .build();
