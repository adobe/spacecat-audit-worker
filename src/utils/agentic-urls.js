/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  getS3Config,
  getCdnAwsRuntime,
} from './cdn-utils.js';
import { generateReportingPeriods } from '../cdn-logs-report/utils/report-utils.js';
import { weeklyBreakdownQueries } from '../cdn-logs-report/utils/query-builder.js';

const DEFAULT_TOP_AGENTIC_URLS_LIMIT = 200;

export function getPreferredBaseUrl(site, context) {
  const overrideBaseURL = site.getConfig?.()?.getFetchConfig?.()?.overrideBaseURL;
  if (overrideBaseURL && /^https?:\/\//.test(overrideBaseURL)) {
    return overrideBaseURL;
  }
  return context.finalUrl && !/^https?:\/\//.test(context.finalUrl)
    ? `https://${context.finalUrl}`
    : context.finalUrl || site.getBaseURL();
}

// URL suffixes to exclude from agentic URL results
export const EXCLUDED_URL_SUFFIXES = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/robots.txt',
  '.ico',
  '.ps',
  '.dwf',
  '.kml',
  '.kmz',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.doc',
  '.docx',
  '.rtf',
  '.swf',
  '.pdf',
  '.jsp',
];

/**
 * Shared Athena setup and execution. Handles configuration guards, AWS client
 * creation, query execution, empty-result detection, and error handling.
 *
 * @param {Object} site
 * @param {Object} context
 * @param {Object} options
 * @param {function} options.buildQuery - (s3Config, athenaClient) => Promise<string>
 * @param {function} options.parseResults - (rows, baseUrl) => T
 * @param {*} options.emptyValue - Value returned on early exit or error
 * @param {string} options.label - Log label for this query type
 * @returns {Promise<T>}
 */
async function runAthenaQuery(site, context, {
  buildQuery, parseResults, emptyValue, label,
}) {
  const { log } = context;
  const baseUrl = getPreferredBaseUrl(site, context);

  try {
    const configuration = await context.dataAccess.Configuration.findLatest();
    if (!configuration) {
      log.warn(`Agentic URLs - Skipping ${label} because no configuration was found for site ${site.getId()}`);
      return emptyValue;
    }
    if (!configuration.isHandlerEnabledForSite('cdn-logs-analysis', site)) {
      log.info(`Agentic URLs - Skipping ${label} because cdn-logs-analysis is disabled for site ${site.getId()}`);
      return emptyValue;
    }

    const awsRuntime = getCdnAwsRuntime(site, context);
    const s3Config = getS3Config(site, context);
    const athenaClient = awsRuntime.createAthenaClient(s3Config.getAthenaTempLocation());
    const query = await buildQuery(s3Config);

    log.info(`Agentic URLs - Executing ${label}... baseUrl=${baseUrl}`);
    const results = await athenaClient.query(
      query,
      s3Config.databaseName,
      `[Athena Query] ${label}`,
    );

    if (!Array.isArray(results) || results.length === 0) {
      log.warn(`Agentic URLs - Athena returned no rows for ${label}. baseUrl=${baseUrl}`);
      return emptyValue;
    }

    return parseResults(results, baseUrl);
  } catch (e) {
    log?.warn?.(`Agentic URLs - ${label} failed: ${e.message}. baseUrl=${baseUrl}`);
    return emptyValue;
  }
}

/**
 * Shared Athena execution logic for top agentic URL queries.
 * @param {Object} site
 * @param {Object} context
 * @param {number} limit
 * @param {number[]} statuses - Optional HTTP status codes to filter by (e.g. [200])
 * @returns {Promise<Array<string>>}
 */
async function runTopAgenticUrlsQuery(site, context, limit, statuses = []) {
  const { log } = context;
  const baseUrl = getPreferredBaseUrl(site, context);

  return runAthenaQuery(site, context, {
    label: 'Top Agentic URLs',
    emptyValue: [],
    buildQuery: async (s3Config) => {
      const periods = generateReportingPeriods();
      const oneWeekPeriods = { weeks: [periods.weeks[0]] };
      return weeklyBreakdownQueries.createTopUrlsQueryWithLimit({
        periods: oneWeekPeriods,
        databaseName: s3Config.databaseName,
        tableName: s3Config.tableName,
        site,
        limit,
        excludedUrlSuffixes: EXCLUDED_URL_SUFFIXES,
        statuses,
      });
    },
    parseResults: (results) => {
      let resolvedBaseUrl = baseUrl;
      try {
        // eslint-disable-next-line no-new
        new URL(baseUrl);
      } catch {
        log.warn(`Agentic URLs - Invalid baseUrl: ${baseUrl}, cannot construct absolute URLs`);
        resolvedBaseUrl = null;
      }

      const topUrls = results
        .filter((row) => typeof row?.url === 'string' && row.url.length > 0)
        .map((row) => {
          const path = row.url;
          if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
          }
          if (resolvedBaseUrl) {
            return new URL(path, resolvedBaseUrl).toString();
          }
          return null;
        })
        .filter((url) => url !== null);

      log.info(`Agentic URLs - Selected ${topUrls.length} top agentic URLs via Athena. baseUrl=${baseUrl}`);
      log.info(`Agentic URLs - Top #1 URL: ${topUrls[0]}`);
      return topUrls;
    },
  });
}

/**
 * Fetch top Agentic URLs using Athena.
 * Find last week's top agentic URLs, filters out pooled 'Other',
 * groups by URL, and returns the top URLs by total hits.
 * @param {Object} site - Site object
 * @param {Object} context - Context with log, env, etc.
 * @param {number} limit - Maximum number of URLs to return
 * @param {number[]} statuses - Optional HTTP status codes to filter by (e.g. [200])
 * @returns {Promise<Array<string>>} Array of top agentic URLs
 */
export async function getTopAgenticUrlsFromAthena(
  site,
  context,
  limit = DEFAULT_TOP_AGENTIC_URLS_LIMIT,
  statuses = [],
) {
  return runTopAgenticUrlsQuery(site, context, limit, statuses);
}

/**
 * Like getTopAgenticUrlsFromAthena but restricted to URLs that returned HTTP 200
 * during the period — excludes 404s, 410s, and other error responses.
 * @param {Object} site - Site object
 * @param {Object} context - Context with log, env, etc.
 * @param {number} limit - Maximum number of URLs to return
 * @returns {Promise<Array<string>>} Array of top live agentic URLs
 */
export async function getTopAgenticLiveUrlsFromAthena(
  site,
  context,
  limit = DEFAULT_TOP_AGENTIC_URLS_LIMIT,
) {
  return getTopAgenticUrlsFromAthena(site, context, limit, [200]);
}

/**
 * Returns a Map of pathname → total agentic hits over a 4-week window.
 * Used for path-level suggestion scoring.
 *
 * @param {Object} site
 * @param {Object} context
 * @param {number} [limit]
 * @returns {Promise<Map<string, number>>}
 */
export async function getAgenticHitsMapFromAthena(
  site,
  context,
  limit = DEFAULT_TOP_AGENTIC_URLS_LIMIT,
) {
  const { log } = context;

  return runAthenaQuery(site, context, {
    label: 'Agentic Hits Map',
    emptyValue: new Map(),
    buildQuery: async (s3Config) => {
      const weekPeriods = [-1, -2, -3, -4].map((offset) => {
        const { weeks } = generateReportingPeriods(new Date(), offset);
        return weeks[0];
      });
      const { startDate } = weekPeriods[weekPeriods.length - 1];
      const { endDate } = weekPeriods[0];

      return weeklyBreakdownQueries.createTopUrlsWithHitsQuery({
        startDate,
        endDate,
        databaseName: s3Config.databaseName,
        tableName: s3Config.tableName,
        site,
        limit,
        excludedUrlSuffixes: EXCLUDED_URL_SUFFIXES,
      });
    },
    parseResults: (results, baseUrl) => {
      const hitsMap = new Map();
      for (const row of results) {
        if (typeof row?.url === 'string' && row.url.length > 0) {
          try {
            const rawPath = row.url.startsWith('http://') || row.url.startsWith('https://')
              ? new URL(row.url).pathname
              : row.url;
            const pathname = rawPath.replace(/\/$/, '') || '/';
            const hits = parseInt(row.total_hits, 10) || 0;
            hitsMap.set(pathname, (hitsMap.get(pathname) || 0) + hits);
          } catch {
            // skip unparseable rows
          }
        }
      }
      log.info(`Agentic URLs - Built hits map with ${hitsMap.size} pathnames. baseUrl=${baseUrl}`);
      return hitsMap;
    },
  });
}
