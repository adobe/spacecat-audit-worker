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

/* c8 ignore start */
import { DEFAULT_COUNTRY_PATTERNS } from '../constants/country-patterns.js';
import { loadSql } from './report-utils.js';
import { DEFAULT_PATTERNS } from '../constants/page-patterns.js';
import { getProviderPattern } from '../constants/user-agent-patterns.js';

function buildDateFilter(startDate, endDate) {
  const formatPart = (date) => ({
    year: date.getUTCFullYear().toString(),
    month: (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    day: date.getUTCDate().toString().padStart(2, '0'),
  });

  const start = formatPart(startDate);
  const end = formatPart(endDate);

  return start.year === end.year && start.month === end.month
    ? `(year = '${start.year}' AND month = '${start.month}' AND day >= '${start.day}' AND day <= '${end.day}')`
    : `((year = '${start.year}' AND month = '${start.month}' AND day >= '${start.day}')
       OR (year = '${end.year}' AND month = '${end.month}' AND day <= '${end.day}'))`;
}

function buildWhereClause(conditions = [], provider = null, siteFilters = []) {
  const allConditions = [...conditions];

  if (provider) {
    const pattern = getProviderPattern(provider);
    allConditions.push(`REGEXP_LIKE(user_agent, '${pattern}')`);
  }

  if (siteFilters && siteFilters.length > 0) {
    allConditions.push(...siteFilters);
  }

  return allConditions.length > 0 ? `WHERE ${allConditions.join(' AND ')}` : '';
}

function buildWeeklyColumns(periods) {
  return periods.weeks.map((week) => {
    const weekKey = week.weekLabel.replace(' ', '_').toLowerCase();
    const dateFilter = buildDateFilter(week.startDate, week.endDate);
    return `SUM(CASE WHEN ${dateFilter} THEN count ELSE 0 END) as ${weekKey}`;
  }).join(',\n      ');
}

function buildOrderBy(periods) {
  return periods.weeks
    .map((week) => week.weekLabel.replace(' ', '_').toLowerCase())
    .join(' + ');
}

// Page Type Classification
function generatePageTypeClassification(site) {
  const patterns = site?.getConfig()?.getGroupedURLs('cdn-analysis') || DEFAULT_PATTERNS;

  const caseConditions = patterns
    .map((pattern) => `      WHEN REGEXP_LIKE(url, '${pattern.pattern}') THEN '${pattern.name}'`)
    .join('\n');

  return `CASE\n${caseConditions}\n      ELSE 'Uncategorized'\n    END`;
}

// Country Classification
function buildCountryExtractionSQL() {
  const cases = DEFAULT_COUNTRY_PATTERNS
    .map(({ regex }) => `WHEN REGEXP_EXTRACT(url, '${regex}', 1) != '' THEN UPPER(REGEXP_EXTRACT(url, '${regex}', 1))`)
    .join('\n          ');

  return `CASE\n          ${cases}\n          ELSE 'GLOBAL'\n        END`;
}

// Query Builders
async function createCountryWeeklyBreakdownQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const dateFilter = buildDateFilter(
    periods.weeks[0].startDate,
    periods.weeks[periods.weeks.length - 1].endDate,
  );
  const whereClause = buildWhereClause([
    dateFilter,
    'url NOT LIKE \'%robots.txt\'',
    'url NOT LIKE \'%sitemap%\'',
  ], provider, siteFilters);

  return loadSql('country-weekly-breakdown', {
    countryExtraction: buildCountryExtractionSQL(),
    weekColumns: buildWeeklyColumns(periods),
    databaseName,
    tableName,
    whereClause,
    orderBy: buildOrderBy(periods),
  });
}

async function createUserAgentWeeklyBreakdownQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    provider,
    siteFilters,
  );

  return loadSql('user-agent-breakdown', {
    databaseName,
    tableName,
    whereClause,
  });
}

async function createUrlStatusWeeklyBreakdownQuery(options) {
  const {
    periods, databaseName, tableName, provider, site, siteFilters = [],
  } = options;

  const dateFilter = buildDateFilter(
    periods.weeks[0].startDate,
    periods.weeks[periods.weeks.length - 1].endDate,
  );
  const whereClause = buildWhereClause([dateFilter], provider, siteFilters);

  return loadSql('page-type-weekly-breakdown', {
    pageTypeCase: generatePageTypeClassification(site),
    weekColumns: buildWeeklyColumns(periods),
    databaseName,
    tableName,
    whereClause,
    orderBy: buildOrderBy(periods),
  });
}

async function createTopBottomUrlsByStatusQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    provider,
    siteFilters,
  );

  return loadSql('top-bottom-urls-by-status', {
    databaseName,
    tableName,
    whereClause,
  });
}

async function createError404UrlsQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate), 'status = 404'],
    provider,
    siteFilters,
  );

  return loadSql('individual-urls-by-status', {
    databaseName,
    tableName,
    whereClause,
  });
}

async function createError503UrlsQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate), 'status = 503'],
    provider,
    siteFilters,
  );

  return loadSql('individual-urls-by-status', {
    databaseName,
    tableName,
    whereClause,
  });
}

async function createSuccessUrlsByCategoryQuery(options) {
  const {
    periods, databaseName, tableName, provider, site, siteFilters = [],
  } = options;

  if (!site || !site.getBaseURL().includes('bulk.com')) {
    return null;
  }

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate), 'status = 200', "url LIKE '%/products%'"],
    provider,
    siteFilters,
  );

  return loadSql('individual-urls-by-status', {
    databaseName,
    tableName,
    whereClause,
  });
}

async function createTopUrlsQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate), 'url NOT LIKE \'%robots.txt\'', 'url NOT LIKE \'%sitemap%\''],
    provider,
    siteFilters,
  );

  return loadSql('top-urls-by-traffic', {
    databaseName,
    tableName,
    whereClause,
  });
}

export const weeklyBreakdownQueries = {
  createCountryWeeklyBreakdown: createCountryWeeklyBreakdownQuery,
  createUserAgentWeeklyBreakdown: createUserAgentWeeklyBreakdownQuery,
  createUrlStatusWeeklyBreakdown: createUrlStatusWeeklyBreakdownQuery,
  createTopBottomUrlsByStatus: createTopBottomUrlsByStatusQuery,
  createError404Urls: createError404UrlsQuery,
  createError503Urls: createError503UrlsQuery,
  createSuccessUrlsByCategory: createSuccessUrlsByCategoryQuery,
  createTopUrls: createTopUrlsQuery,
};
/* c8 ignore end */
