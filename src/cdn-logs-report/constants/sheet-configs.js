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

import { validateCountryCode } from '../utils/report-utils.js';

const SHEET_COLORS = {
  DEFAULT: 'FFE6E6FA',
  ERROR: 'FFFFE6E6',
  SUCCESS: 'FFE6F6E6',
};

const WEEK_KEY_TRANSFORMER = (weekLabel) => weekLabel.replace(' ', '_').toLowerCase();

const capitalizeFirstLetter = (str) => {
  if (!str || typeof str !== 'string') return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

const processWeekData = (data, periods, valueExtractor) => data?.map((row) => {
  const extractedValue = valueExtractor(row);
  /* c8 ignore next */
  const result = Array.isArray(extractedValue) ? [...extractedValue] : [extractedValue];
  periods.weeks.forEach((week) => {
    const weekKey = WEEK_KEY_TRANSFORMER(week.weekLabel);
    result.push(Number(row[weekKey]) || 0);
  });
  return result;
  /* c8 ignore next */
}) || [];

const processCountryWeekData = (data, periods) => {
  if (!data?.length) return [];

  const aggregatedData = data.reduce((acc, row) => {
    const countryCode = validateCountryCode(row.country_code);
    const agentType = row.agent_type || 'Other';
    const key = `${countryCode}|${agentType}`;

    if (!acc[key]) {
      acc[key] = {
        country_code: countryCode,
        agent_type: agentType,
      };
      periods.weeks.forEach((week) => {
        const weekKey = WEEK_KEY_TRANSFORMER(week.weekLabel);
        acc[key][weekKey] = 0;
      });
    }

    periods.weeks.forEach((week) => {
      const weekKey = WEEK_KEY_TRANSFORMER(week.weekLabel);
      acc[key][weekKey] += Number(row[weekKey]) || 0;
    });

    return acc;
  }, {});

  return Object.values(aggregatedData);
};

export const SHEET_CONFIGS = {
  userAgents: {
    getHeaders: (periods) => {
      const lastWeek = periods.weeks[periods.weeks.length - 1];
      return [
        'Request User Agent',
        'Agent Type',
        'Status',
        'Number of Hits',
        'Avg TTFB (ms)',
        `Interval: Last Week (${lastWeek.dateRange.start} - ${lastWeek.dateRange.end})`,
      ];
    },
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [3, 4],
    processData: (data) => data?.map((row) => [
      /* c8 ignore next 4 */
      row.user_agent || 'Unknown',
      row.agent_type || 'Other',
      Number(row.status) || 'All',
      Number(row.total_requests) || 0,
      Number(row.avg_ttfb_ms) || 0,
      '',
    ]) || [],
  },

  country: {
    getHeaders: (periods) => ['Country Code', 'Agent Type', ...periods.columns],
    headerColor: SHEET_COLORS.DEFAULT,
    getNumberColumns: (periods) => (
      Array.from({ length: periods.columns.length }, (_, i) => i + 2)
    ),
    processData: (data, reportPeriods) => {
      const aggregatedData = processCountryWeekData(data, reportPeriods);
      return processWeekData(
        aggregatedData,
        reportPeriods,
        (row) => [row.country_code, row.agent_type],
      );
    },
  },

  error404: {
    getHeaders: () => ['URL', 'Agent Type', 'Number of 404s'],
    headerColor: SHEET_COLORS.ERROR,
    numberColumns: [2],
    /* c8 ignore next */
    processData: (data) => data?.map((row) => [row.url || '', row.agent_type || 'Other', Number(row.total_requests) || 0]) || [],
  },

  error503: {
    getHeaders: () => ['URL', 'Agent Type', 'Number of 503s'],
    headerColor: SHEET_COLORS.ERROR,
    numberColumns: [2],
    /* c8 ignore next */
    processData: (data) => data?.map((row) => [row.url || '', row.agent_type || 'Other', Number(row.total_requests) || 0]) || [],
  },

  category: {
    getHeaders: () => ['Category', 'Agent Type', 'Number of Hits'],
    headerColor: SHEET_COLORS.SUCCESS,
    numberColumns: [2],
    processData: (data) => {
      const urlCountMap = new Map();

      /* c8 ignore next */
      (data || []).forEach((row) => {
        const url = row.url || '';
        const match = url.match(/\/[a-z]{2}\/products\/([^/]+)/);
        const categoryUrl = match ? `products/${match[1]}` : 'Other';
        const agentType = row.agent_type || 'Other';
        const key = `${categoryUrl}|${agentType}`;

        urlCountMap.set(
          key,
          (urlCountMap.get(key) || 0) + (Number(row.total_requests) || 0),
        );
      });

      return Array.from(urlCountMap.entries())
        .map(([key, hits]) => {
          const [category, agentType] = key.split('|');
          return [category, agentType, hits];
        })
        .sort((a, b) => b[2] - a[2]);
    },
  },

  topUrls: {
    getHeaders: () => ['URL', 'Total Hits', 'Unique Agents', 'Top Agent', 'Top Agent Type', 'Success Rate', 'Avg TTFB (ms)', 'Product'],
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [1, 2, 5, 6],
    processData: (data) => data?.map((row) => [
      /* c8 ignore next 7 */
      row.url || '',
      Number(row.total_hits) || 0,
      Number(row.unique_agents) || 0,
      row.top_agent || 'N/A',
      row.top_agent_type || 'Other',
      Number(row.success_rate) || 0,
      Number(row.avg_ttfb_ms) || 0,
      row.product || 'Other',
    ]) || [],
  },

  hitsByProductAgentType: {
    getHeaders: () => ['Product', 'Agent Type', 'Hits'],
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [2],
    processData: (data) => data?.map((row) => [
      capitalizeFirstLetter(row.product) || 'Other',
      row.agent_type || 'Other',
      Number(row.hits) || 0,
    ]) || [],
  },

  hitsByPageCategoryAgentType: {
    getHeaders: () => ['Category', 'Agent Type', 'Hits'],
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [2],
    processData: (data) => data?.map((row) => [
      /* c8 ignore next 3 */
      row.category || 'Other',
      row.agent_type || 'Other',
      Number(row.hits) || 0,
    ]) || [],
  },
};
