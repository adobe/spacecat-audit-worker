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
import { TABLE_NAMES, COLUMN_MAPPINGS } from '../constants/index.js';
import { formatDateString } from '../utils/date-utils.js';

function getDateFilter(startDate, endDate) {
  return `CONCAT(year, '-', LPAD(month, 2, '0'), '-', LPAD(day, 2, '0')) 
    BETWEEN '${formatDateString(startDate)}' AND '${formatDateString(endDate)}'`;
}

function getLastWeekFilter(periods) {
  const lastWeek = periods.weeks[periods.weeks.length - 1];
  return getDateFilter(lastWeek.startDate, lastWeek.endDate);
}

function createCountryWeeklyBreakdownQuery(periods, databaseName, provider) {
  const countColumn = provider ? `${provider}_requests` : COLUMN_MAPPINGS.COUNTRY;
  const whereClause = provider ? `WHERE ${provider}_requests > 0` : '';

  const weekColumns = periods.weeks.map((week) => {
    const weekKey = week.weekLabel.replace(' ', '_').toLowerCase();
    const dateFilter = getDateFilter(week.startDate, week.endDate);

    return `SUM(CASE WHEN ${dateFilter} THEN ${countColumn} ELSE 0 END) as ${weekKey}`;
  }).join(',\n      ');

  const orderBy = periods.weeks
    .map((week) => week.weekLabel.replace(' ', '_').toLowerCase())
    .join(' + ');

  return `
    SELECT 
      country_code,
      ${weekColumns}
    FROM ${databaseName}.${TABLE_NAMES.COUNTRY}
    ${whereClause}
    GROUP BY country_code
    ORDER BY ${orderBy} DESC
  `;
}

function createUserAgentWeeklyBreakdownQuery(periods, databaseName, provider) {
  const lastWeekFilter = getLastWeekFilter(periods);
  const providerFilter = provider ? `AND agentic_type = '${provider}'` : '';

  return `
    SELECT 
      user_agent,
      status_code,
      SUM(${COLUMN_MAPPINGS.USER_AGENT}) as total_requests
    FROM ${databaseName}.${TABLE_NAMES.USER_AGENT}
    WHERE ${lastWeekFilter} ${providerFilter}
    GROUP BY user_agent, status_code
    ORDER BY total_requests DESC
  `;
}

function createUrlStatusWeeklyBreakdownQuery(periods, databaseName, provider, pageTypePatterns) {
  const countColumn = provider ? `${provider}_requests` : COLUMN_MAPPINGS.URL_STATUS;
  const whereClause = provider ? `WHERE ${provider}_requests > 0` : '';
  const pageTypeCase = generatePageTypeCaseStatement(pageTypePatterns);

  const weekColumns = periods.weeks.map((week) => {
    const weekKey = week.weekLabel.replace(' ', '_').toLowerCase();
    const dateFilter = getDateFilter(week.startDate, week.endDate);

    return `SUM(CASE WHEN ${dateFilter} THEN ${countColumn} ELSE 0 END) as ${weekKey}`;
  }).join(',\n      ');

  const orderBy = periods.weeks
    .map((week) => week.weekLabel.replace(' ', '_').toLowerCase())
    .join(' + ');

  return `
    SELECT 
      ${pageTypeCase} as page_type,
      ${weekColumns}
    FROM ${databaseName}.${TABLE_NAMES.URL_STATUS}
    ${whereClause}
    GROUP BY ${pageTypeCase}
    ORDER BY ${orderBy} DESC
  `;
}

function createTopBottomUrlsByStatusQuery(periods, databaseName, provider) {
  const countColumn = provider ? `${provider}_requests` : COLUMN_MAPPINGS.URL_STATUS;
  const lastWeekFilter = getLastWeekFilter(periods);
  const providerFilter = provider ? `AND ${provider}_requests > 0` : '';

  return `
    SELECT 
      url,
      status_code,
      SUM(${countColumn}) as total_requests
    FROM ${databaseName}.${TABLE_NAMES.URL_STATUS}
    WHERE ${lastWeekFilter} ${providerFilter}
    GROUP BY url, status_code
    ORDER BY status_code, total_requests DESC
  `;
}

export const weeklyBreakdownQueries = {
  createCountryWeeklyBreakdown: createCountryWeeklyBreakdownQuery,
  createUserAgentWeeklyBreakdown: createUserAgentWeeklyBreakdownQuery,
  createUrlStatusWeeklyBreakdown: createUrlStatusWeeklyBreakdownQuery,
  createTopBottomUrlsByStatus: createTopBottomUrlsByStatusQuery,
};
/* c8 ignore end */
