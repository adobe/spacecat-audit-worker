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

import { DEFAULT_COUNTRY_PATTERNS } from '../../common/country-patterns.js';
import { fetchAgenticUrlClassificationRules } from '../../common/agentic-url-classification-rules.js';
import { loadSql } from './report-utils.js';
import { buildAgentTypeClassificationSQL, buildUserAgentDisplaySQL } from '../../common/user-agent-classification.js';
import { buildDateFilter, buildUserAgentFilter, buildSiteFilters } from '../../utils/cdn-utils.js';

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function buildWhereClause(conditions = [], siteFilters = []) {
  const allConditions = [...conditions];

  allConditions.push(buildUserAgentFilter());

  if (siteFilters && siteFilters.length > 0) {
    allConditions.push(siteFilters);
  }

  /* c8 ignore next */
  return allConditions.length > 0 ? `WHERE ${allConditions.join(' AND ')}` : '';
}

// Page Type Classification
function generatePageTypeClassification(remotePatterns = null) {
  const patterns = remotePatterns?.pagePatterns || [];

  if (patterns.length === 0) {
    return "'Other'";
  }

  const caseConditions = patterns
    .map((pattern) => `      WHEN REGEXP_LIKE(url, '${sqlEscape(pattern.regex)}') THEN '${sqlEscape(pattern.name)}'`)
    .join('\n');

  return `CASE\n${caseConditions}\n      ELSE 'Other'\n    END`;
}

// Country Classification
function buildCountryExtractionSQL() {
  const extracts = DEFAULT_COUNTRY_PATTERNS
    .map(({ regex }) => `NULLIF(UPPER(REGEXP_EXTRACT(url, '${regex}', 1)), '')`)
    .join(',\n    ');

  return `COALESCE(\n    ${extracts},\n    'GLOBAL'\n  )`;
}

// Topic Classification
function buildTopicExtractionSQL(remotePatterns = null) {
  const patterns = remotePatterns?.topicPatterns || [];

  if (Array.isArray(patterns) && patterns.length > 0) {
    const namedPatterns = [];
    const extractPatterns = [];

    patterns.forEach(({ regex, name }) => {
      if (name) {
        namedPatterns.push(`WHEN REGEXP_LIKE(url, '${sqlEscape(regex)}') THEN '${sqlEscape(name)}'`);
      } else {
        extractPatterns.push(`NULLIF(REGEXP_EXTRACT(url, '${sqlEscape(regex)}', 1), '')`);
      }
    });

    if (namedPatterns.length > 0 && extractPatterns.length > 0) {
      const caseClause = `CASE\n          ${namedPatterns.join('\n          ')}\n          ELSE NULL\n        END`;
      const coalesceClause = extractPatterns.join(',\n    ');
      return `COALESCE(\n    ${caseClause},\n    ${coalesceClause},\n    'Other'\n  )`;
    } else if (namedPatterns.length > 0) {
      return `CASE\n          ${namedPatterns.join('\n          ')}\n          ELSE 'Other'\n        END`;
    } else {
      return `COALESCE(\n    ${extractPatterns.join(',\n    ')},\n    'Other'\n  )`;
    }
  }
  return "CASE WHEN url IS NOT NULL THEN 'Other' END";
}

async function createAgenticDailyReportQuery(options) {
  const {
    trafficDate, databaseName, tableName, site, context,
  } = options;

  const filters = site.getConfig().getLlmoCdnlogsFilter();
  const siteFilters = buildSiteFilters(filters, site);
  const year = trafficDate.getUTCFullYear().toString();
  const month = String(trafficDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(trafficDate.getUTCDate()).padStart(2, '0');
  const whereClause = buildWhereClause(
    [`(year = '${year}' AND month = '${month}' AND day = '${day}')`],
    siteFilters,
  );

  const rawPatterns = Object.hasOwn(options, 'remotePatterns')
    ? options.remotePatterns
    : await fetchAgenticUrlClassificationRules(site, context);
  const remotePatterns = rawPatterns?.error ? null : rawPatterns;

  return loadSql('agentic-traffic-daily-report', {
    agentTypeClassification: buildAgentTypeClassificationSQL(),
    userAgentDisplay: buildUserAgentDisplaySQL(),
    countryExtraction: buildCountryExtractionSQL(),
    topicExtraction: buildTopicExtractionSQL(remotePatterns),
    pageCategoryClassification: generatePageTypeClassification(remotePatterns),
    databaseName,
    tableName,
    whereClause,
  });
}

function buildWhereClauseReferral(conditions = [], siteFilters = []) {
  const allConditions = [...conditions];

  if (siteFilters && siteFilters.length > 0) {
    allConditions.push(siteFilters);
  }

  /* c8 ignore next */
  return allConditions.length > 0 ? `WHERE ${allConditions.join(' AND ')}` : '';
}

async function createReferralDailyReportQuery(options) {
  const {
    trafficDate, databaseName, tableName, site,
  } = options;

  const filters = site.getConfig().getLlmoCdnlogsFilter();
  const siteFilters = buildSiteFilters(filters, site);
  const year = trafficDate.getUTCFullYear().toString();
  const month = String(trafficDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(trafficDate.getUTCDate()).padStart(2, '0');
  const whereClause = buildWhereClauseReferral(
    [`(year = '${year}' AND month = '${month}' AND day = '${day}')`],
    siteFilters,
  );

  return loadSql('referral-traffic-daily-report', {
    databaseName,
    tableName,
    whereClause,
    countryExtraction: buildCountryExtractionSQL(),
  });
}

async function createTopUrlsQuery(options) {
  const {
    periods, databaseName, tableName, site,
  } = options;

  const filters = site.getConfig().getLlmoCdnlogsFilter();
  const siteFilters = buildSiteFilters(filters, site);
  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    siteFilters,
  );

  return loadSql('top-urls', {
    databaseName,
    tableName,
    whereClause,
  });
}

/**
 * Builds a SQL exclusion filter for URL suffixes.
 * @param {Array<string>} suffixes - Array of URL suffixes to exclude
 * @returns {string} SQL filter clause (e.g., "AND NOT (url LIKE '%.pdf' OR url LIKE '%.docx')")
 */
export function buildExcludedUrlSuffixesFilter(suffixes = []) {
  if (!Array.isArray(suffixes) || suffixes.length === 0) {
    return '';
  }

  const escapedSuffixes = suffixes
    .filter(Boolean)
    .map((suffix) => suffix
      .trim()
      .toLowerCase()
      .replace(/'/g, "''") // SQL escape
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (escapedSuffixes.length === 0) {
    return '';
  }

  const pattern = `(?i)(${escapedSuffixes.join('|')})$`;

  return `AND NOT regexp_like(url, '${pattern}')`;
}

function buildStatusFilter(statuses) {
  const safe = statuses.map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 100 || n > 599) {
      throw new Error(`Invalid HTTP status code for SQL filter: ${s}`);
    }
    return n;
  });
  return `AND status IN (${safe.join(', ')})`;
}

async function createTopUrlsQueryWithLimit(options) {
  const {
    periods, startDate, endDate, databaseName, tableName, site, limit,
    excludedUrlSuffixes = [], statuses = [],
  } = options;

  if (!startDate && !periods?.weeks?.length) {
    throw new Error('createTopUrlsQueryWithLimit: either periods or startDate/endDate is required');
  }

  const filters = site.getConfig().getLlmoCdnlogsFilter();
  const siteFilters = buildSiteFilters(filters, site);
  const start = startDate ?? periods.weeks[periods.weeks.length - 1].startDate;
  const end = endDate ?? periods.weeks[periods.weeks.length - 1].endDate;
  const whereClause = buildWhereClause(
    [buildDateFilter(start, end)],
    siteFilters,
  );

  const excludedUrlSuffixesFilter = buildExcludedUrlSuffixesFilter(excludedUrlSuffixes);

  if (statuses.length > 0) {
    return loadSql('top-agentic-urls-by-status-and-limit', {
      databaseName,
      tableName,
      whereClause,
      limit,
      excludedUrlSuffixesFilter,
      statusFilter: buildStatusFilter(statuses),
    });
  }

  return loadSql('top-agentic-urls-by-limit', {
    databaseName,
    tableName,
    whereClause,
    limit,
    excludedUrlSuffixesFilter,
  });
}

/**
 * Builds a SQL query that returns url + total_hits over a custom date window.
 * Delegates to createTopUrlsQueryWithLimit with explicit startDate/endDate.
 *
 * @param {Object} options
 * @param {Object} options.startDate - Earliest date of the window (inclusive)
 * @param {Object} options.endDate - Latest date of the window (inclusive)
 * @param {string} options.databaseName
 * @param {string} options.tableName
 * @param {Object} options.site
 * @param {number} options.limit
 * @param {Array<string>} [options.excludedUrlSuffixes]
 * @returns {Promise<string>} SQL query string
 */
function createTopUrlsWithHitsQuery(options) {
  return createTopUrlsQueryWithLimit(options);
}

export const weeklyBreakdownQueries = {
  createAgenticDailyReportQuery,
  createReferralDailyReportQuery,
  createTopUrlsQuery,
  createTopUrlsQueryWithLimit,
  createTopUrlsWithHitsQuery,
};
