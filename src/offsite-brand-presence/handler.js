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

const HELIX_BASE_URL = 'https://main--project-elmo-ui-data--adobe.aem.live';

const PROVIDERS = Object.freeze([
  'ai-mode',
  'all',
  'chatgpt',
  'copilot',
  'gemini',
  'google-ai-overview',
  'perplexity',
]);

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
 * Fetches brand presence JSON data for a specific provider and week
 * from the Helix data source.
 *
 * @param {string} dataFolder - The LLMO data folder for the site
 * @param {string} providerId - The provider ID (e.g., 'copilot', 'chatgpt')
 * @param {string} weekIndex - The zero-padded week number (e.g., '07')
 * @param {object} env - Environment variables
 * @param {object} log - Logger instance
 * @returns {Promise<object|null>} Parsed JSON data or null if not found
 */
async function fetchBrandPresenceData(dataFolder, providerId, weekIndex, env, log) {
  // TODO WRONG FKING API
  const url = `${HELIX_BASE_URL}/${dataFolder}/brand-presence/brandpresence-${providerId}-w${weekIndex}.json`;

  log.info(`${LOG_PREFIX} Fetching brand presence data from: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'spacecat-audit-worker',
      Authorization: `token ${env.LLMO_HLX_API_KEY}`,
    },
  });

  if (!response.ok) {
    log.warn(`${LOG_PREFIX} Failed to fetch data for provider ${providerId}: ${response.status}`);
    return null;
  }

  return response.json();
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
 * Classifies a single URL into its matching offsite domain, if any.
 *
 * @param {string} url - The URL to classify
 * @returns {{ domain: string, url: string } | null} The matched domain and URL, or null
 */
function classifyUrl(url) {
  try {
    const { hostname } = new URL(url);
    const lowerHostname = hostname.toLowerCase();
    for (const domain of Object.keys(OFFSITE_DOMAINS)) {
      if (matchesDomain(lowerHostname, domain)) {
        return { domain, url };
      }
    }
  } catch {
    // Skip invalid URLs
  }
  return null;
}

/**
 * Extracts URLs matching offsite domains (youtube.com, reddit.com, wikipedia.com)
 * from brand presence data. Sources are semicolon-separated URL lists.
 *
 * @param {object} data - Brand presence JSON data
 * @param {object} log - Logger instance
 * @returns {object} Map of domain to Set of matching URLs
 */
function extractOffsiteUrls(data, log) {
  const urlsByDomain = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    urlsByDomain[domain] = new Set();
  }

  const sheets = Object.values(data);
  for (const sheet of sheets) {
    const rows = sheet?.data || [];

    for (const row of rows) {
      const sources = row.Sources || '';
      const urls = sources.split(';').map((u) => u.trim()).filter(Boolean);

      urls.forEach((url) => {
        const match = classifyUrl(url);

        if (match) {
          urlsByDomain[match.domain].add(match.url);
        }
      });
    }
  }

  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    if (urls.size > 0) {
      log.info(`${LOG_PREFIX} Found ${urls.size} unique ${domain} URLs`);
    }
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
  const apiBase = env.SPACECAT_API_URI;
  const apiKey = env.SPACECAT_API_KEY;

  if (!apiBase || !apiKey) {
    log.error(`${LOG_PREFIX} SPACECAT_API_URI or SPACECAT_API_KEY not configured, skipping URL store update`);
    return;
  }

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

  if (urlEntries.length === 0) {
    log.info(`${LOG_PREFIX} No offsite URLs to add to URL store`);
    return;
  }

  const endpoint = `${apiBase}/sites/${siteId}/url-store`;
  log.info(`${LOG_PREFIX} Adding ${urlEntries.length} URLs to URL store at ${endpoint}`);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
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
  const drsApiUrl = env.DRS_API_URL;
  const drsApiKey = env.DRS_API_KEY;

  if (!drsApiUrl || !drsApiKey) {
    log.error(`${LOG_PREFIX} DRS_API_URL or DRS_API_KEY not configured, skipping DRS scraping`);
    return [];
  }

  const results = [];

  for (const [domain, urls] of Object.entries(urlsByDomain)) {
    const urlList = Array.from(urls);
    if (urlList.length === 0) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const { datasetIds } = OFFSITE_DOMAINS[domain];

    for (const datasetId of datasetIds) {
      const payload = {
        provider_id: 'brightdata',
        priority: 'LOW',
        parameters: {
          dataset_id: datasetId,
          urls: urlList,
          days_back: 30,
          metadata: {
            imsOrgId: imsOrgId || '',
            brand: brand || '',
            site: domain,
          },
        },
      };

      log.info(
        `${LOG_PREFIX} Triggering DRS job: domain=${domain}, dataset=${datasetId}, urls=${urlList.length}`,
      );

      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`${drsApiUrl}/jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': drsApiKey,
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          // eslint-disable-next-line no-await-in-loop
          const result = await response.json();
          log.info(`${LOG_PREFIX} DRS job created for ${domain}/${datasetId}: ${JSON.stringify(result)}`);
          results.push({
            domain, datasetId, status: 'success', response: result,
          });
        } else {
          // eslint-disable-next-line no-await-in-loop
          const text = await response.text();
          log.error(`${LOG_PREFIX} DRS job failed for ${domain}/${datasetId}: ${response.status} - ${text}`);
          results.push({
            domain, datasetId, status: 'error', statusCode: response.status,
          });
        }
      } catch (error) {
        log.error(`${LOG_PREFIX} DRS request error for ${domain}/${datasetId}: ${error.message}`);
        results.push({
          domain, datasetId, status: 'error', error: error.message,
        });
      }
    }
  }

  return results;
}

/**
 * Main runner for the offsite-brand-presence audit.
 *
 * Workflow:
 * 1. Fetches brand presence data for each provider from the Helix data source
 * 2. Extracts URLs matching youtube.com, reddit.com, and wikipedia.com
 * 3. Adds these URLs to the URL store with the appropriate audit type
 * 4. Triggers DRS scraping jobs for the collected URLs
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

  const dataFolder = site.getConfig()?.getLlmoDataFolder?.();
  if (!dataFolder) {
    log.error(`${LOG_PREFIX} No LLMO data folder configured for site ${siteId}`);
    return {
      auditResult: { success: false, error: 'No LLMO data folder configured' },
      fullAuditRef: finalUrl,
    };
  }

  const { week, year } = getPreviousWeek();
  const weekIndex = String(week).padStart(2, '0');

  log.info(`${LOG_PREFIX} Processing week w${weekIndex} of year ${year} for data folder: ${dataFolder}`);

  // Aggregate offsite URLs across all providers
  const aggregatedUrls = {};
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    aggregatedUrls[domain] = new Set();
  }

  const providerResults = {};

  for (const providerId of PROVIDERS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const data = await fetchBrandPresenceData(dataFolder, providerId, weekIndex, env, log);

      if (!data) {
        providerResults[providerId] = { status: 'no_data' };
        // eslint-disable-next-line no-continue
        continue;
      }

      const urlsByDomain = extractOffsiteUrls(data, log);

      let totalUrls = 0;
      for (const [domain, urls] of Object.entries(urlsByDomain)) {
        for (const url of urls) {
          aggregatedUrls[domain].add(url);
          totalUrls += 1;
        }
      }

      providerResults[providerId] = { status: 'success', urlCount: totalUrls };
    } catch (error) {
      log.error(`${LOG_PREFIX} Error processing provider ${providerId}: ${error.message}`);
      providerResults[providerId] = { status: 'error', error: error.message };
    }
  }

  const totalUrls = Object.values(aggregatedUrls)
    .reduce((sum, urls) => sum + urls.size, 0);
  log.info(`${LOG_PREFIX} Total unique offsite URLs found across all providers: ${totalUrls}`);

  const urlCounts = Object.fromEntries(
    Object.entries(aggregatedUrls).map(([d, u]) => [d, u.size]),
  );

  if (totalUrls === 0) {
    log.info(`${LOG_PREFIX} No offsite URLs found, audit complete`);
    return {
      auditResult: {
        success: true,
        providers: providerResults,
        urlCounts,
        week: weekIndex,
        year,
      },
      fullAuditRef: finalUrl,
    };
  }

  // Step 1: Add URLs to the URL store
  await addUrlsToUrlStore(siteId, aggregatedUrls, env, log);

  // Step 2: Trigger DRS scraping jobs
  const imsOrgId = await getImsOrgId(site, dataAccess, log);
  const brand = site.getConfig()?.getCompanyName?.() || baseURL;
  const drsResults = await triggerDrsScraping(aggregatedUrls, imsOrgId, brand, env, log);

  log.info(`${LOG_PREFIX} Audit complete for site ${siteId}: ${totalUrls} URLs processed, ${drsResults.length} DRS jobs triggered`);

  return {
    auditResult: {
      success: true,
      providers: providerResults,
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
