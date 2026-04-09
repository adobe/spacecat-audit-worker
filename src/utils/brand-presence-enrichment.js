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
 * Computes sentiment topic payloads (urls with timesCited, category, subPrompts) from
 * LLMO brand-presence sheet data, mirroring the aggregation in offsite-brand-presence.
 */

import { isoCalendarWeek, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import {
  BRAND_PRESENCE_REGEX,
  FETCH_PAGE_SIZE,
  FETCH_TIMEOUT_MS,
  INCLUDE_COLUMNS,
  OFFSITE_DOMAINS,
  PROVIDERS_SET,
} from '../offsite-brand-presence/constants.js';

const LOG_PREFIX = '[BrandPresenceEnrichment]';

const DOMAIN_ALIASES = Object.freeze({
  'youtu.be': 'youtube.com',
});

/**
 * Gets the ISO week number and year for the previous two weeks.
 * @returns {Array<{ week: number, year: number }>} Previous two weeks (most recent first)
 */
function getPreviousWeeks() {
  return [1, 2].map((i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (7 * i));
    return isoCalendarWeek(d);
  });
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
  const apiBase = env.SPACECAT_API_BASE_URL;
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

    return await response.json();
  } catch (error) {
    log.error(`${LOG_PREFIX} Error fetching query-index: ${error.message}`);
    return null;
  }
}

/**
 * Fetches brand presence JSON data for a specific file via the Spacecat API.
 *
 * @param {string} siteId - The site ID
 * @param {string} fileName - The brand presence file path relative to the llmo data directory
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<object|null>} Parsed JSON data or null if not found
 */
async function fetchBrandPresenceData(siteId, fileName, env, log) {
  const apiBase = env.SPACECAT_API_BASE_URL;
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
 *
 * @param {object} entry - A single query-index entry
 * @param {number} targetWeek - The target week number to match
 * @param {number} targetYear - The target year to match
 * @returns {string|null} The matched file path, or null
 */
function matchBrandPresenceEntry(entry, targetWeek, targetYear) {
  if (!entry?.path) {
    return null;
  }

  const bpIdx = entry.path.indexOf('brand-presence/');
  if (bpIdx === -1) {
    return null;
  }

  const filePath = entry.path.substring(bpIdx);
  const match = filePath.match(BRAND_PRESENCE_REGEX);
  if (!match) {
    return null;
  }

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

  return `${parsed.origin}${pathname}`;
}

/**
 * Normalizes a parsed URL based on its domain.
 *
 * @param {URL} parsed - Parsed URL object
 * @param {string|null} domain - The matched offsite domain, or null for generic URLs
 * @returns {string} The normalized URL
 */
function normalizeUrl(parsed, domain) {
  let url = domain === 'youtube.com'
    ? normalizeYoutubeUrl(parsed)
    : `${parsed.origin}${parsed.pathname}`;

  if (url.endsWith('/') && parsed.pathname !== '/') {
    url = url.slice(0, -1);
  }

  return url;
}

/**
 * Classifies a URL into its matching offsite domain (if any) and normalizes it.
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

    const topicName = row.Topics?.trim();
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
 * Converts aggregated topic maps into the shape expected by enrichUrlsWithTopicData.
 *
 * @param {Map<string, {category: string, urlMap: Map}>} topicMap - Aggregated topic data
 * @param {Map<string, {count: number, domain: string|null}>} allUrls - Global URL citation map
 * @returns {Array<{
 *   name: string,
 *   urls: Array<{ url: string, timesCited: number, category: string, subPrompts: string[] }>
 * }>}
 */
export function formatTopicsForEnrichment(topicMap, allUrls) {
  return [...topicMap.entries()].map(([name, topicData]) => ({
    name,
    urls: [...topicData.urlMap.entries()].map(([url, info]) => ({
      url,
      timesCited: allUrls.get(url)?.count ?? 0,
      category: info.category,
      subPrompts: [...info.subPrompts],
    })),
  }));
}

/**
 * Loads brand-presence LLMO data for the previous ISO week and returns topic objects
 * with per-URL citation counts and prompts for URL-topic enrichment.
 *
 * @param {string} siteId - Site ID
 * @param {{ env: object, log: object }} context - Lambda context
 * @returns {Promise<Array<{ name: string, urls: object[] }>>}
 */
export async function computeTopicsFromBrandPresence(siteId, context) {
  const { env, log } = context;

  if (!env?.SPACECAT_API_BASE_URL || !env?.SPACECAT_API_KEY) {
    log.warn(`${LOG_PREFIX} SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured`);
    return [];
  }

  const queryIndex = await fetchQueryIndex(siteId, env, log);
  if (!queryIndex) {
    log.warn(`${LOG_PREFIX} Failed to fetch query-index for site ${siteId}`);
    return [];
  }

  const previousWeeks = getPreviousWeeks();
  const weekLabels = previousWeeks
    .map(({ week, year }) => `w${String(week).padStart(2, '0')}-${year}`)
    .join(', ');

  log.info(`${LOG_PREFIX} Processing weeks: ${weekLabels}`);

  const matchedFiles = previousWeeks.flatMap(
    ({ week, year }) => filterBrandPresenceFiles(queryIndex, week, year),
  );
  log.info(`${LOG_PREFIX} Found ${matchedFiles.length} brand presence files for weeks ${weekLabels}`);

  if (matchedFiles.length === 0) {
    return [];
  }

  const { allUrls, topicMap } = await fetchAndAggregateData(siteId, matchedFiles, env, log);
  return formatTopicsForEnrichment(topicMap, allUrls);
}
