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
import { extractCustomerDomain, loadSql } from './report-utils.js';
import { DEFAULT_PATTERNS, DOMAIN_SPECIFIC_PATTERNS, FALLBACK_CASE_STATEMENT } from '../constants/page-patterns.js';
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

function buildWhereClause(conditions = [], provider = null) {
  if (provider) {
    const pattern = getProviderPattern(provider);
    conditions.push(`REGEXP_LIKE(user_agent, '${pattern}')`);
  }
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
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
  const domain = site ? extractCustomerDomain(site) : 'default';
  const patterns = DOMAIN_SPECIFIC_PATTERNS[domain] || DEFAULT_PATTERNS;

  if (!patterns?.length) {
    return FALLBACK_CASE_STATEMENT;
  }

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
async function createCountryWeeklyBreakdownQuery(periods, databaseName, tableName, provider) {
  const dateFilter = buildDateFilter(
    periods.weeks[0].startDate,
    periods.weeks[periods.weeks.length - 1].endDate,
  );
  const whereClause = buildWhereClause([
    dateFilter,
    'url NOT LIKE \'%robots.txt\'',
    'url NOT LIKE \'%sitemap%\'',
  ], provider);

  return loadSql('country-weekly-breakdown', {
    countryExtraction: buildCountryExtractionSQL(),
    weekColumns: buildWeeklyColumns(periods),
    databaseName,
    tableName,
    whereClause,
    orderBy: buildOrderBy(periods),
  });
}

async function createUserAgentWeeklyBreakdownQuery(periods, databaseName, tableName, provider) {
  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    provider,
  );

  return loadSql('user-agent-breakdown', {
    databaseName,
    tableName,
    whereClause,
  });
}

async function createUrlStatusWeeklyBreakdownQuery(
  periods,
  databaseName,
  tableName,
  provider,
  site,
) {
  const dateFilter = buildDateFilter(
    periods.weeks[0].startDate,
    periods.weeks[periods.weeks.length - 1].endDate,
  );
  const whereClause = buildWhereClause([dateFilter], provider);

  return loadSql('url-status-weekly-breakdown', {
    pageTypeCase: generatePageTypeClassification(site),
    weekColumns: buildWeeklyColumns(periods),
    databaseName,
    tableName,
    whereClause,
    orderBy: buildOrderBy(periods),
  });
}

async function createTopBottomUrlsByStatusQuery(periods, databaseName, tableName, provider) {
  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    provider,
  );

  return loadSql('top-bottom-urls-by-status', {
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
};
/* c8 ignore end */
