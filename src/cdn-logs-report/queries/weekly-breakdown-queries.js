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
import { generatePageTypeCaseStatement } from '../utils/page-type-classifier.js';
import { DEFAULT_COUNTRY_PATTERNS } from '../constants/country-patterns.js';

function getDateFilter(startDate, endDate) {
  const startYear = startDate.getUTCFullYear().toString();
  const startMonth = (startDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const startDay = startDate.getUTCDate().toString().padStart(2, '0');

  const endYear = endDate.getUTCFullYear().toString();
  const endMonth = (endDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const endDay = endDate.getUTCDate().toString().padStart(2, '0');

  if (startYear === endYear && startMonth === endMonth) {
    return `(year = '${startYear}' AND month = '${startMonth}' AND day >= '${startDay}' AND day <= '${endDay}')`;
  }

  return `(
    (year = '${startYear}' AND month = '${startMonth}' AND day >= '${startDay}')
    AND
    (year = '${endYear}' AND month = '${endMonth}' AND day <= '${endDay}')
  )`;
}

function getLastWeekFilter(periods) {
  const lastWeek = periods.weeks[periods.weeks.length - 1];
  return getDateFilter(lastWeek.startDate, lastWeek.endDate);
}

function getFullDateRangeFilter(periods) {
  const firstWeek = periods.weeks[0];
  const lastWeek = periods.weeks[periods.weeks.length - 1];
  return getDateFilter(firstWeek.startDate, lastWeek.endDate);
}

function buildWhereClause(baseConditions = [], provider = null) {
  const conditions = [...baseConditions];

  if (provider) {
    conditions.push(`LOWER(user_agent) LIKE '%${provider.toLowerCase()}%'`);
  }

  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

function buildCountryExtractionSQL() {
  const cases = DEFAULT_COUNTRY_PATTERNS
    .map(({ regex }) => `WHEN REGEXP_EXTRACT(url, '${regex}', 1) != '' THEN UPPER(REGEXP_EXTRACT(url, '${regex}', 1))`)
    .join('\n          ');

  return `
        CASE 
          ${cases}
          ELSE 'GLOBAL'
        END`;
}

function createCountryWeeklyBreakdownQuery(periods, databaseName, tableName, provider) {
  const dateRangeFilter = getFullDateRangeFilter(periods);
  const whereClause = buildWhereClause([dateRangeFilter], provider);
  const countryExtraction = buildCountryExtractionSQL();

  const weekColumns = periods.weeks.map((week) => {
    const weekKey = week.weekLabel.replace(' ', '_').toLowerCase();
    const dateFilter = getDateFilter(week.startDate, week.endDate);

    return `SUM(CASE WHEN ${dateFilter} THEN count ELSE 0 END) as ${weekKey}`;
  }).join(',\n      ');

  const orderBy = periods.weeks
    .map((week) => week.weekLabel.replace(' ', '_').toLowerCase())
    .join(' + ');

  return `
    SELECT 
      ${countryExtraction} as country_code,
      ${weekColumns}
    FROM ${databaseName}.${tableName}
    ${whereClause}
    GROUP BY ${countryExtraction}
    ORDER BY ${orderBy} DESC
  `;
}

function createUserAgentWeeklyBreakdownQuery(periods, databaseName, tableName, provider) {
  const dateRangeFilter = getLastWeekFilter(periods);
  const whereClause = buildWhereClause([dateRangeFilter], provider);

  return `
    SELECT 
      user_agent,
      status,
      SUM(count) as total_requests
    FROM ${databaseName}.${tableName}
    ${whereClause}
    GROUP BY user_agent, status
    ORDER BY total_requests DESC
  `;
}

function createUrlStatusWeeklyBreakdownQuery(
  periods,
  databaseName,
  tableName,
  provider,
  pageTypePatterns,
) {
  const dateRangeFilter = getFullDateRangeFilter(periods);
  const whereClause = buildWhereClause([dateRangeFilter], provider);
  const pageTypeCase = generatePageTypeCaseStatement(pageTypePatterns);

  const weekColumns = periods.weeks.map((week) => {
    const weekKey = week.weekLabel.replace(' ', '_').toLowerCase();
    const dateFilter = getDateFilter(week.startDate, week.endDate);

    return `SUM(CASE WHEN ${dateFilter} THEN count ELSE 0 END) as ${weekKey}`;
  }).join(',\n      ');

  const orderBy = periods.weeks
    .map((week) => week.weekLabel.replace(' ', '_').toLowerCase())
    .join(' + ');

  return `
    SELECT 
      ${pageTypeCase} as page_type,
      ${weekColumns}
    FROM ${databaseName}.${tableName}
    ${whereClause}
    GROUP BY ${pageTypeCase}
    ORDER BY ${orderBy} DESC
  `;
}

function createTopBottomUrlsByStatusQuery(periods, databaseName, tableName, provider) {
  const dateRangeFilter = getLastWeekFilter(periods);
  const whereClause = buildWhereClause([dateRangeFilter], provider);

  return `
    SELECT 
      url,
      status,
      SUM(count) as total_requests
    FROM ${databaseName}.${tableName}
    ${whereClause}
    GROUP BY url, status
    ORDER BY status, total_requests DESC
  `;
}

export const weeklyBreakdownQueries = {
  createCountryWeeklyBreakdown: createCountryWeeklyBreakdownQuery,
  createUserAgentWeeklyBreakdown: createUserAgentWeeklyBreakdownQuery,
  createUrlStatusWeeklyBreakdown: createUrlStatusWeeklyBreakdownQuery,
  createTopBottomUrlsByStatus: createTopBottomUrlsByStatusQuery,
};
/* c8 ignore end */
