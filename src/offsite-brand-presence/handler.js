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

const OFFSITE_DOMAINS = Object.freeze({
  'youtube.com': {
    auditType: 'youtube-analysis',
    datasetIds: ['youtube_videos', 'youtube_comments'],
  },
  'reddit.com': {
    auditType: 'reddit-analysis',
    datasetIds: ['reddit_posts', 'reddit_comments'],
  },
  'wikipedia.com': {
    auditType: 'wikipedia-analysis',
    datasetIds: ['wikipedia_placeholder'], // TODO: Update this to the actual dataset ID
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
 * Builds the standard headers for Spacecat API requests.
 *
 * @param {string} apiKey - The Spacecat API key
 * @returns {object} Headers object
 */
function buildSpacecatHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };
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
    const response = await fetch(url, { headers: buildSpacecatHeaders(apiKey) });

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
  const url = `${apiBase}/sites/${siteId}/llmo/data/${fileName}`;

  log.info(`${LOG_PREFIX} Fetching brand presence data from: ${url}`);

  const response = await fetch(url, { headers: buildSpacecatHeaders(apiKey) });

  if (!response.ok) {
    log.warn(`${LOG_PREFIX} Failed to fetch data for ${fileName}: ${response.status}`);
    return null;
  }

  return response.json();
}

/**
 * Attempts to extract a matching brand presence file path from a query-index entry.
 * Returns the relative file path if it matches the target week and a known provider,
 * or null otherwise.
 *
 * @param {object} entry - A single query-index entry
 * @param {number} targetWeek - The target week number to match
 * @returns {string|null} The matched file path, or null
 */
function matchBrandPresenceEntry(entry, targetWeek) {
  if (!entry?.path) return null;

  const bpIdx = entry.path.indexOf('brand-presence/');
  if (bpIdx === -1) return null;

  const filePath = entry.path.substring(bpIdx);
  const match = filePath.match(BRAND_PRESENCE_REGEX);
  if (!match) return null;

  const [, providerId, weekStr] = match;
  const fileWeek = Number.parseInt(weekStr, 10);

  if (fileWeek === targetWeek && PROVIDERS_SET.has(providerId)) {
    return filePath;
  }
  return null;
}

/**
 * Filters brand presence file paths from the query-index response.
 * Only returns files matching the pattern brandpresence-{provider}-w{week}-{year}-*.json
 * where the provider is in PROVIDERS and the week matches the target week.
 *
 * @param {object} queryIndex - The parsed query-index response
 * @param {number} targetWeek - The target week number to match
 * @returns {string[]} Matched file paths relative to the llmo data directory
 */
export function filterBrandPresenceFiles(queryIndex, targetWeek) {
  const entries = queryIndex?.data || [];
  const matched = [];
  for (const entry of entries) {
    const filePath = matchBrandPresenceEntry(entry, targetWeek);
    if (filePath) {
      matched.push(filePath);
    }
  }
  return matched;
}

/**
 * Checks if a hostname matches one of the offsite domains.
 *
 * @param {string} hostname - The hostname to check
 * @param {string} domain - The target domain to match against
 * @returns {boolean} True if the hostname matches the domain
 */
function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Extracts the hostname from a URL string using lightweight string parsing.
 * Avoids the overhead of `new URL()` for high-volume classification.
 *
 * @param {string} url - The URL to parse
 * @returns {string|null} The lowercase hostname, or null if unparseable
 */
function extractHostname(url) {
  const protoEnd = url.indexOf('://');
  if (protoEnd === -1) return null;

  const afterProto = url.substring(protoEnd + 3);
  // Hostname ends at the first '/', '?', '#', or ':' (port), or end of string
  const endIdx = afterProto.search(/[/:?#]/);
  const hostname = endIdx === -1 ? afterProto : afterProto.substring(0, endIdx);

  return hostname.length > 0 ? hostname.toLowerCase() : null;
}

/**
 * Classifies a single URL into its matching offsite domain, if any.
 *
 * @param {string} url - The URL to classify
 * @returns {{ domain: string, url: string } | null} The matched domain and URL, or null
 */
function classifyUrl(url) {
  const hostname = extractHostname(url);
  if (!hostname) return null;

  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    if (matchesDomain(hostname, domain)) {
      return { domain, url };
    }
  }
  return null;
}

/**
 * Classifies all URLs from a semicolon-separated sources string
 * and adds matching ones to the urlsByDomain map.
 *
 * @param {string} sources - Semicolon-separated URL string
 * @param {object} urlsByDomain - Map of domain to Set of URLs (mutated in place)
 */
function classifySources(sources, urlsByDomain) {
  for (const raw of sources.split(';')) {
    const url = raw.trim();
    if (!url) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const match = classifyUrl(url);
    if (match) {
      urlsByDomain[match.domain].add(match.url);
    }
  }
}

/**
 * Extracts URLs matching offsite domains (youtube.com, reddit.com, wikipedia.com)
 * from the "all" sheet of brand presence data. Sources are semicolon-separated URL lists.
 *
 * @param {object} data - Brand presence JSON data (expects an "all" key)
 * @param {object} log - Logger instance
 * @returns {object} Map of domain to Set of matching URLs
 */
function extractOffsiteUrls(data, log) {
  const urlsByDomain = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    urlsByDomain[domain] = new Set();
  }

  const rows = data?.all?.data || [];
  for (const row of rows) {
    classifySources(row.Sources || '', urlsByDomain);
  }

  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    log.info(`${LOG_PREFIX} Found ${urls.size} unique ${domain} URLs`);
  }

  return urlsByDomain;
}

/**
 * Adds offsite URLs to the URL store via the Spacecat API.
 * Each URL is tagged with the appropriate audit type based on its domain.
 *
 * @param {string} siteId - The site ID
 * @param {object} urlsByDomain - Map of domain to Set of URLs
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 */
async function addUrlsToUrlStore(siteId, urlsByDomain, env, log) {
  const urlEntries = [];
  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    const { auditType } = OFFSITE_DOMAINS[domain];
    for (const url of urls) {
      urlEntries.push({
        url,
        byCustomer: false,
        audits: [auditType],
      });
    }
  }

  const endpoint = `${env.SPACECAT_API_URI}/sites/${siteId}/url-store`;
  log.info(`${LOG_PREFIX} Adding ${urlEntries.length} URLs to URL store at ${endpoint}`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildSpacecatHeaders(env.SPACECAT_API_KEY),
      body: JSON.stringify(urlEntries),
    });

    if (response.ok) {
      log.info(`${LOG_PREFIX} Successfully added ${urlEntries.length} URLs to URL store`);
    } else {
      const text = await response.text();
      log.error(`${LOG_PREFIX} Failed to add URLs to URL store: ${response.status} - ${text}`);
    }
  } catch (error) {
    log.error(`${LOG_PREFIX} Error adding URLs to URL store: ${error.message}`);
  }
}

/**
 * Triggers DRS (Data Retrieval Service) scraping jobs for the collected URLs.
 * For YouTube and Reddit, two jobs are created per domain (one per dataset_id).
 * For Wikipedia, a single job is created.
 *
 * @param {object} urlsByDomain - Map of domain to Set of URLs
 * @param {string} imsOrgId - The IMS org ID for metadata
 * @param {string} brand - The brand name for metadata
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<Array>} Results of DRS job creation
 */
async function triggerDrsScraping(urlsByDomain, imsOrgId, brand, env, log) {
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
          brand: brand || '',
          site: domain,
        },
      };

      if (domain === 'reddit.com') {
        parameters.days_back = 30;
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
      log.info(
        `${LOG_PREFIX} Triggering DRS job: domain=${domain}, dataset=${datasetId}, urls=${payload.parameters.urls.length}`,
      );

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
        log.info(`${LOG_PREFIX} DRS job created for ${domain}/${datasetId}: jobId=${result.jobId || 'unknown'}`);
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
 * Fetches all matched brand presence files in parallel and aggregates
 * the offsite URLs found across all files into a single map.
 *
 * @param {string} siteId - The site ID
 * @param {string[]} matchedFiles - File paths to fetch
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Map of domain to Set of URLs
 */
async function fetchAndAggregateUrls(siteId, matchedFiles, env, log) {
  const aggregatedUrls = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    aggregatedUrls[domain] = new Set();
  }

  const fetchResults = await Promise.allSettled(
    matchedFiles.map((filePath) => fetchBrandPresenceData(siteId, filePath, env, log)),
  );

  for (const entry of fetchResults) {
    if (entry.status === 'rejected') {
      log.error(`${LOG_PREFIX} Error fetching brand presence file: ${entry.reason.message}`);
    }
    if (entry.status !== 'fulfilled' || !entry.value) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const urlsByDomain = extractOffsiteUrls(entry.value, log);
    for (const [domain, urls] of Object.entries(urlsByDomain)) {
      for (const url of urls) {
        aggregatedUrls[domain].add(url);
      }
    }
  }

  return aggregatedUrls;
}

/**
 * Main runner for the offsite-brand-presence audit.
 *
 * Workflow:
 * 1. Fetches query-index.json from the Spacecat API
 * 2. Fetches brand presence data for each provider from the Spacecat API
 * 3. Extracts URLs matching youtube.com, reddit.com, and wikipedia.com
 * 4. Adds these URLs to the URL store with the appropriate audit type
 * 5. Triggers DRS scraping jobs for the collected URLs
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
  const matchedFiles = filterBrandPresenceFiles(queryIndex, week);
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

  // Resolve metadata needed by DRS before launching parallel work
  const imsOrgId = await getImsOrgId(site, dataAccess, log);
  const brand = site.getConfig()?.getCompanyName?.() || baseURL;

  // Add URLs to URL store and trigger DRS scraping in parallel
  const [, drsResults] = await Promise.all([
    addUrlsToUrlStore(siteId, aggregatedUrls, env, log),
    triggerDrsScraping(aggregatedUrls, imsOrgId, brand, env, log),
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
