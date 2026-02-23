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
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { getImsOrgId } from '../utils/data-access.js';
import {
  DRS_TOP_URLS_LIMIT,
  FETCH_CONCURRENCY,
  FETCH_PAGE_SIZE,
  FETCH_TIMEOUT_MS,
  INCLUDE_COLUMNS,
  REDDIT_COMMENTS_DAYS_BACK,
} from './constants.js';

export {
  DRS_TOP_URLS_LIMIT,
  FETCH_PAGE_SIZE,
  INCLUDE_COLUMNS,
  REDDIT_COMMENTS_DAYS_BACK,
};

const LOG_PREFIX = '[OffsiteBrandPresence]';

export const PROVIDERS = Object.freeze([
  'ai-mode',
  'all',
  'chatgpt',
  'copilot',
  'gemini',
  'google-ai-overview',
  'perplexity',
]);

const PROVIDERS_SET = new Set(PROVIDERS);
const BRAND_PRESENCE_REGEX = /brandpresence-(.+?)-w(\d{1,2})-(\d{4})-.*\.json$/;

const URL_STORE_STATUS = Object.freeze({
  CREATED: 'created',
  FAILED: 'failed',
});

const DOMAIN_ALIASES = Object.freeze({
  'youtu.be': 'youtube.com',
});

const OFFSITE_DOMAINS = Object.freeze({
  'youtube.com': {
    auditType: 'youtube-analysis',
    datasetIds: ['youtube_videos', 'youtube_comments'],
  },
  'reddit.com': {
    auditType: 'reddit-analysis',
    datasetIds: ['reddit_posts', 'reddit_comments'],
  },
  'wikipedia.org': {
    auditType: 'wikipedia-analysis',
    datasetIds: ['wikipedia'],
  },
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

  const allRows = [];
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
    allRows.push(...rows);

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
 * @param {string} domain - The matched domain (youtube.com, reddit.com, wikipedia.org)
 * @returns {string} The normalized URL
 */
function normalizeUrl(parsed, domain) {
  let url;
  switch (domain) {
    case 'youtube.com':
      url = normalizeYoutubeUrl(parsed);
      break;
    default:
      url = `${parsed.origin}${parsed.pathname}`;
      break;
  }

  // Remove trailing slash (unless it's just the domain)
  if (url.endsWith('/') && parsed.pathname !== '/') {
    url = url.slice(0, -1);
  }

  return url;
}

/**
 * Classifies a single URL into its matching offsite domain, if any.
 * Normalizes the URL to remove unnecessary query parameters.
 *
 * @param {string} url - The URL to classify
 * @returns {{ domain: string, url: string } | null} The matched domain and normalized URL, or null
 */
function classifyUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
    // Ensure https protocol
    parsed.protocol = 'https:';
  } catch {
    return null;
  }

  const { hostname } = parsed;
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      const normalizedUrl = normalizeUrl(parsed, domain);
      return { domain, url: normalizedUrl };
    }
  }

  const aliasedDomain = DOMAIN_ALIASES[hostname];
  if (aliasedDomain) {
    const normalizedUrl = normalizeUrl(parsed, aliasedDomain);
    return { domain: aliasedDomain, url: normalizedUrl };
  }

  return null;
}

/**
 * Classifies all URLs from a semicolon-separated sources string
 * and increments the occurrence count for matching ones in the urlsByDomain map.
 *
 * @param {string} sources - Semicolon or newline separated URL string
 * @param {object} urlsByDomain - Map of domain to Map<url, count> (mutated in place)
 */
function classifySources(sources, urlsByDomain) {
  for (const raw of sources.split(/[;\n]/)) {
    const url = raw.trim();
    if (!url) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const match = classifyUrl(url);
    if (match) {
      const domainMap = urlsByDomain[match.domain];
      domainMap.set(match.url, (domainMap.get(match.url) || 0) + 1);
    }
  }
}

/**
 * Extracts URLs matching offsite domains from brand presence data.
 * Filters out URLs that are not in the US region or do not mention the brand.
 * Sources are semicolon/newline-separated URL lists.
 * Each URL's occurrence count is tracked across all rows.
 *
 * @param {object} data - Brand presence JSON data (expects a "data" array of rows)
 * @param {object} log - Logger instance
 * @returns {object} Map of domain to Map<url, count>
 */
function extractOffsiteUrls(data, log) {
  const urlsByDomain = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    urlsByDomain[domain] = new Map();
  }

  const rows = data.data;
  for (const row of rows) {
    const sources = row.Sources?.trim();
    // row.Mentions is true if the brand or its products are mentioned in the Sources
    if (sources && row.Region === 'US' && row.Mentions === 'true') {
      classifySources(sources, urlsByDomain);
    }
  }

  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    log.info(`${LOG_PREFIX} Found ${urls.size} unique ${domain} URLs`);
  }

  return urlsByDomain;
}

/**
 * Adds offsite URLs to the URL store via dataAccess.
 * Each URL is tagged with the appropriate audit type based on its domain.
 *
 * @param {string} siteId - The site ID
 * @param {object} urlsByDomain - Map of domain to array of URL strings
 * @param {object} dataAccess - Data access layer from context
 * @param {object} log - Logger instance
 */
async function addUrlsToUrlStore(siteId, urlsByDomain, dataAccess, log) {
  const { AuditUrl } = dataAccess;
  const urlEntries = [];
  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    const { auditType } = OFFSITE_DOMAINS[domain];
    for (const url of urls) {
      urlEntries.push({ url, audits: [auditType] });
    }
  }

  log.info(`${LOG_PREFIX} Adding ${urlEntries.length} URLs to URL store`);

  const results = await Promise.all(
    urlEntries.map(async (entry) => {
      try {
        await AuditUrl.create({
          siteId,
          url: entry.url,
          byCustomer: false,
          audits: entry.audits,
          createdBy: 'system',
          updatedBy: 'system',
        });
        return URL_STORE_STATUS.CREATED;
      } catch (error) {
        log.warn(`${LOG_PREFIX} Failed to add URL to store: ${entry.url} - ${error.message}`);
        return URL_STORE_STATUS.FAILED;
      }
    }),
  );

  let createdCount = 0;
  let failCount = 0;
  for (const status of results) {
    if (status === URL_STORE_STATUS.CREATED) {
      createdCount += 1;
    } else {
      failCount += 1;
    }
  }

  log.info(`${LOG_PREFIX} URL store complete: ${createdCount} created, ${failCount} failed`);
}

/**
 * Triggers DRS (Data Retrieval Service) scraping jobs for the collected URLs.
 * For each domain, one job is created per dataset_id defined in OFFSITE_DOMAINS
 * (e.g. YouTube gets youtube_videos + youtube_comments).
 *
 * @param {object} urlsByDomain - Map of domain to array of URL strings
 * @param {string} imsOrgId - The IMS org ID for metadata
 * @param {string} baseURL - The base URL of the site
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<Array>} Results of DRS job creation
 */
async function triggerDrsScraping(urlsByDomain, imsOrgId, baseURL, env, log) {
  const { DRS_API_URL: drsApiUrl, DRS_API_KEY: drsApiKey } = env;

  if (!drsApiUrl || !drsApiKey) {
    log.error(`${LOG_PREFIX} DRS_API_URL or DRS_API_KEY not configured, skipping DRS scraping`);
    return [];
  }

  // Build all job payloads first
  const jobs = [];
  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    const urlList = Array.from(urls);

    if (urlList.length === 0) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const { datasetIds } = OFFSITE_DOMAINS[domain];

    for (const datasetId of datasetIds) {
      const parameters = {
        dataset_id: datasetId,
        urls: urlList,
        metadata: {
          imsOrgId: imsOrgId || '',
          brand: baseURL || '',
          site: domain,
        },
      };

      if (datasetId === 'reddit_comments') {
        parameters.days_back = REDDIT_COMMENTS_DAYS_BACK;
      }

      if (datasetId === 'wikipedia') {
        parameters.mode = datasetId;
        parameters.metadata.siteBaseUrl = baseURL;
      }

      jobs.push({
        domain,
        datasetId,
        payload: {
          provider_id: 'brightdata',
          priority: 'LOW',
          parameters,
        },
      });
    }
  }

  log.info(`${LOG_PREFIX} Submitting ${jobs.length} DRS jobs in parallel`);

  // Submit all jobs in parallel
  const settled = await Promise.allSettled(
    jobs.map(async ({ domain, datasetId, payload }) => {
      const response = await fetch(`${drsApiUrl}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': drsApiKey,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await response.json();
        log.info(`${LOG_PREFIX} DRS job created for ${domain}/${datasetId}: jobId=${result.job_id}`);
        return {
          domain, datasetId, status: 'success', response: result,
        };
      }

      const text = await response.text();
      log.error(`${LOG_PREFIX} DRS job failed for ${domain}/${datasetId}: ${response.status} - ${text}`);
      return {
        domain, datasetId, status: 'error', statusCode: response.status,
      };
    }),
  );

  return settled.map(({ status, value, reason }, index) => {
    if (status === 'fulfilled') {
      return value;
    }
    const { domain, datasetId } = jobs[index];
    log.error(`${LOG_PREFIX} DRS request error for ${domain}/${datasetId}: ${reason.message}`);
    return {
      domain, datasetId, status: 'error', error: reason.message,
    };
  });
}

/**
 * Fetches matched brand presence files in batches and aggregates
 * the offsite URLs found across all files into a single map.
 * Tracks occurrence counts across all providers/files.
 * Limits concurrency to avoid overwhelming the API with parallel requests.
 *
 * @param {string} siteId - The site ID
 * @param {string[]} matchedFiles - File paths to fetch
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Map of domain to Map<url, count>
 */
async function fetchAndAggregateUrls(siteId, matchedFiles, env, log) {
  const aggregatedUrls = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    aggregatedUrls[domain] = new Map();
  }

  for (let i = 0; i < matchedFiles.length; i += FETCH_CONCURRENCY) {
    const batch = matchedFiles.slice(i, i + FETCH_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const fetchResults = await Promise.allSettled(
      batch.map((filePath) => fetchBrandPresenceData(siteId, filePath, env, log)),
    );

    for (let j = 0; j < fetchResults.length; j += 1) {
      const entry = fetchResults[j];
      const filePath = batch[j];
      if (entry.status === 'rejected') {
        log.error(`${LOG_PREFIX} Error fetching brand presence file ${filePath}: ${entry.reason.message}`);
      }
      if (entry.status !== 'fulfilled' || !entry.value) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const urlsByDomain = extractOffsiteUrls(entry.value, log);
      for (const [domain, urlCounts] of Object.entries(urlsByDomain)) {
        const target = aggregatedUrls[domain];
        for (const [url, count] of urlCounts) {
          target.set(url, (target.get(url) || 0) + count);
        }
      }
    }
  }

  return aggregatedUrls;
}

/**
 * Selects the top N most frequently occurring URLs per domain
 * and returns them grouped by domain as arrays.
 *
 * @param {object} aggregatedUrls - Map of domain to Map<url, count>
 * @param {number} limitPerDomain - Maximum number of URLs per domain
 * @param {object} log - Logger instance
 * @returns {object} Map of domain to array of top URL strings
 */
function getTopUrlsByDomain(aggregatedUrls, limitPerDomain, log) {
  const topByDomain = {};

  for (const [domain, urlCounts] of Object.entries(aggregatedUrls)) {
    const sorted = [...urlCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limitPerDomain)
      .map(([url]) => url);

    topByDomain[domain] = sorted;
    log.info(
      `${LOG_PREFIX} Selected top ${topByDomain[domain].length} ${domain} URLs (limit ${limitPerDomain})`,
    );
  }

  return topByDomain;
}

/**
 * Main runner for the offsite-brand-presence audit.
 *
 * Workflow:
 * 1. Fetches query-index.json from the Spacecat API
 * 2. Fetches brand presence data for each provider from the Spacecat API
 * 3. Extracts URLs matching offsite domains (e.g. youtube.com, reddit.com)
 * 4. Selects the top N most frequent URLs per domain
 * 5. Adds the top URLs to the URL store and triggers DRS scraping jobs
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
  const imsOrgId = await getImsOrgId(site, dataAccess, log);

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

  // Fetch all matched files in parallel and extract offsite URLs
  const aggregatedUrls = await fetchAndAggregateUrls(siteId, matchedFiles, env, log);

  const totalUrls = Object.values(aggregatedUrls).reduce((sum, urls) => sum + urls.size, 0);
  log.info(`${LOG_PREFIX} Total unique offsite URLs found: ${totalUrls}`);

  const urlCounts = Object.fromEntries(
    Object.entries(aggregatedUrls).map(([d, u]) => [d, u.size]),
  );

  if (totalUrls === 0) {
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

  // Select top URLs by frequency for DRS scraping
  const topUrlsByDomain = getTopUrlsByDomain(aggregatedUrls, DRS_TOP_URLS_LIMIT, log);

  // Send top URLs to both URL store and DRS for scraping
  const [, drsResults] = await Promise.all([
    addUrlsToUrlStore(siteId, topUrlsByDomain, dataAccess, log),
    triggerDrsScraping(topUrlsByDomain, imsOrgId, baseURL, env, log),
  ]);

  log.info(`${LOG_PREFIX} Audit complete for site ${siteId}: ${totalUrls} URLs processed, ${drsResults.length} DRS jobs triggered`);

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
