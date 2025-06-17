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

const buildDateRangeFilter = (startDate, endDate) => `CONCAT(year, '-', LPAD(month, 2, '0'), '-', LPAD(day, 2, '0')) >= '${startDate}' 
    AND CONCAT(year, '-', LPAD(month, 2, '0'), '-', LPAD(day, 2, '0')) <= '${endDate}'`;

const buildLastWeekFilter = (periods) => {
  const { dateRange } = periods.weeks[periods.weeks.length - 1];
  return buildDateRangeFilter(dateRange.start, dateRange.end);
};

const buildWhereClause = (conditions) => {
  const validConditions = conditions.filter(Boolean);
  return validConditions.length > 0 ? `WHERE ${validConditions.join(' AND ')}` : '';
};

const buildWeekFilters = (periods, countColumn) => periods.weeks.map((week) => {
  const { start, end } = week.dateRange;
  const weekKey = week.weekLabel.replace(' ', '_').toLowerCase();

  return `SUM(CASE 
      WHEN ${buildDateRangeFilter(start, end)}
      THEN ${countColumn} ELSE 0 
    END) as ${weekKey}`;
}).join(',\n      ');

function createCountryWeeklyBreakdownQuery(periods, databaseName, provider) {
  const countColumn = provider ? `${provider}_requests` : COLUMN_MAPPINGS.COUNTRY;
  const weekFilters = buildWeekFilters(periods, countColumn);
  const whereClause = buildWhereClause([provider ? `${provider}_requests > 0` : null]);

  return `
    SELECT 
      country_code,
      ${weekFilters}
    FROM ${databaseName}.${TABLE_NAMES.COUNTRY}
    ${whereClause}
    GROUP BY country_code
    ORDER BY ${periods.weeks.map((week) => week.weekLabel.replace(' ', '_').toLowerCase()).join(' + ')} DESC
  `;
}

function createUserAgentWeeklyBreakdownQuery(periods, databaseName, provider) {
  const whereClause = buildWhereClause([
    buildLastWeekFilter(periods),
    provider ? `agentic_type = '${provider}'` : null,
  ]);

  return `
    SELECT 
      user_agent,
      status_code,
      SUM(${COLUMN_MAPPINGS.USER_AGENT}) as total_requests
    FROM ${databaseName}.${TABLE_NAMES.USER_AGENT}
    ${whereClause}
    GROUP BY user_agent, status_code
    ORDER BY total_requests DESC
  `;
}

function createUrlStatusWeeklyBreakdownQuery(
  periods,
  databaseName,
  provider,
  pageTypePatterns,
) {
  const countColumn = provider ? `${provider}_requests` : COLUMN_MAPPINGS.URL_STATUS;
  const weekFilters = buildWeekFilters(periods, countColumn);
  const whereClause = buildWhereClause([provider ? `${provider}_requests > 0` : null]);
  const pageTypeCase = generatePageTypeCaseStatement(pageTypePatterns);

  return `
    SELECT 
      ${pageTypeCase} as page_type,
      ${weekFilters}
    FROM ${databaseName}.${TABLE_NAMES.URL_STATUS}
    ${whereClause}
    GROUP BY ${pageTypeCase}
    ORDER BY ${periods.weeks.map((week) => week.weekLabel.replace(' ', '_').toLowerCase()).join(' + ')} DESC
  `;
}

function createUrlUserAgentStatusBreakdownQuery(periods, databaseName, provider) {
  const whereClause = buildWhereClause([
    buildLastWeekFilter(periods),
    provider ? `agentic_type = '${provider}'` : null,
  ]);

  return `
    SELECT 
      url,
      user_agent,
      status_code,
      SUM(${COLUMN_MAPPINGS.URL_USER_AGENT_STATUS}) as total_requests
    FROM ${databaseName}.${TABLE_NAMES.URL_USER_AGENT_STATUS}
    ${whereClause}
    GROUP BY url, user_agent, status_code
    ORDER BY total_requests DESC
  `;
}

function createTopBottomUrlsByStatusQuery(periods, databaseName, provider) {
  const countColumn = provider ? `${provider}_requests` : COLUMN_MAPPINGS.URL_STATUS;
  const whereClause = buildWhereClause([
    buildLastWeekFilter(periods),
    provider ? `${provider}_requests > 0` : null,
  ]);

  return `
    SELECT 
      url,
      status_code,
      SUM(${countColumn}) as total_requests
    FROM ${databaseName}.${TABLE_NAMES.URL_STATUS}
    ${whereClause}
    GROUP BY url, status_code
    ORDER BY status_code, total_requests DESC
  `;
}

export const weeklyBreakdownQueries = {
  createCountryWeeklyBreakdown: createCountryWeeklyBreakdownQuery,
  createUserAgentWeeklyBreakdown: createUserAgentWeeklyBreakdownQuery,
  createUrlStatusWeeklyBreakdown: createUrlStatusWeeklyBreakdownQuery,
  createUrlUserAgentStatusBreakdown: createUrlUserAgentStatusBreakdownQuery,
  createTopBottomUrlsByStatus: createTopBottomUrlsByStatusQuery,
};
/* c8 ignore end */
