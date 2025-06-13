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

const buildDateFilter = (periods) => {
  const { start, end } = periods.last30Days.dateRange;
  return `CONCAT(year, '-', LPAD(month, 2, '0'), '-', LPAD(day, 2, '0')) >= '${start}' 
    AND CONCAT(year, '-', LPAD(month, 2, '0'), '-', LPAD(day, 2, '0')) <= '${end}'`;
};

const buildProviderColumnFilter = (provider) => (provider ? `${provider}_requests > 0` : null);

const buildAgenticTypeFilter = (provider) => (provider ? `agentic_type = '${provider}'` : null);

const getCountColumn = (provider, tableType = 'URL_STATUS') => (provider ? `${provider}_requests` : COLUMN_MAPPINGS[tableType]);

const buildWhereClause = (conditions) => {
  const validConditions = conditions.filter(Boolean);
  return validConditions.length > 0 ? `WHERE ${validConditions.join(' AND ')}` : '';
};

const buildWeekFilters = (periods, countColumn) => periods.weeks.map((week) => {
  const startDate = week.startDate.toISOString().split('T')[0];
  const endDate = week.endDate.toISOString().split('T')[0];
  const weekKey = week.weekLabel.replace(' ', '_').toLowerCase();

  return `SUM(CASE 
      WHEN CONCAT(year, '-', LPAD(month, 2, '0'), '-', LPAD(day, 2, '0')) >= '${startDate}' 
       AND CONCAT(year, '-', LPAD(month, 2, '0'), '-', LPAD(day, 2, '0')) <= '${endDate}'
      THEN ${countColumn} ELSE 0 
    END) as ${weekKey}`;
}).join(',\n      ');

function createCountryWeeklyBreakdownQuery(periods, databaseName, provider) {
  const countColumn = getCountColumn(provider, 'COUNTRY');
  const weekFilters = buildWeekFilters(periods, countColumn);
  const whereClause = buildWhereClause([buildProviderColumnFilter(provider)]);

  return `
    SELECT 
      country_code,
      ${weekFilters},
      SUM(CASE 
        WHEN ${buildDateFilter(periods)}
        THEN ${countColumn} ELSE 0 
      END) as last_30d
    FROM ${databaseName}.${TABLE_NAMES.COUNTRY}
    ${whereClause}
    GROUP BY country_code
    ORDER BY last_30d DESC
  `;
}

function createUserAgentWeeklyBreakdownQuery(periods, databaseName, provider) {
  const whereClause = buildWhereClause([
    buildDateFilter(periods),
    buildAgenticTypeFilter(provider),
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
  const countColumn = getCountColumn(provider, 'URL_STATUS');
  const weekFilters = buildWeekFilters(periods, countColumn);
  const whereClause = buildWhereClause([buildProviderColumnFilter(provider)]);
  const pageTypeCase = generatePageTypeCaseStatement(pageTypePatterns);

  return `
    SELECT 
      ${pageTypeCase} as page_type,
      ${weekFilters},
      SUM(CASE 
        WHEN ${buildDateFilter(periods)}
        THEN ${countColumn} ELSE 0 
      END) as last_30d
    FROM ${databaseName}.${TABLE_NAMES.URL_STATUS}
    ${whereClause}
    GROUP BY ${pageTypeCase}
    ORDER BY last_30d DESC
  `;
}

function createUrlUserAgentStatusBreakdownQuery(periods, databaseName, provider) {
  const whereClause = buildWhereClause([
    buildDateFilter(periods),
    buildAgenticTypeFilter(provider),
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
  const countColumn = getCountColumn(provider, 'URL_STATUS');
  const whereClause = buildWhereClause([
    buildDateFilter(periods),
    buildProviderColumnFilter(provider),
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
