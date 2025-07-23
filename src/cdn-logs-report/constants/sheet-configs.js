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
  const result = [valueExtractor(row)];
  periods.weeks.forEach((week) => {
    const weekKey = WEEK_KEY_TRANSFORMER(week.weekLabel);
    result.push(Number(row[weekKey]) || 0);
  });
  return result;
  /* c8 ignore next */
}) || [];

const processCountryWeeklyData = (data, reportPeriods) => {
  if (!data?.length) return [];

  const weekKeys = reportPeriods.weeks.map((week) => WEEK_KEY_TRANSFORMER(week.weekLabel));

  return Object.values(
    data.reduce((acc, row) => {
      const country = validateCountryCode(row.country_code || '');

      acc[country] ??= {
        country_code: country,
        ...Object.fromEntries(weekKeys.map((key) => [key, 0])),
      };

      weekKeys.forEach((key) => {
        acc[country][key] += Number(row[key]) || 0;
      });

      return acc;
    }, {}),
  );
};

const processCountryWithFields = (data, additionalFields = []) => {
  if (!data?.length) return [];

  const createKey = (row) => {
    const country = validateCountryCode(row.country || '');
    return additionalFields.length === 0
      /* c8 ignore next */
      ? country
      : [country, ...additionalFields.map((field) => row[field] || 'Other')].join('|');
  };

  return Object.values(
    data.reduce((acc, row) => {
      const country = validateCountryCode(row.country || '');
      const key = createKey(row);

      acc[key] ??= {
        country,
        hits: 0,
        ...Object.fromEntries(additionalFields.map((field) => [field, row[field] || 'Other'])),
      };

      acc[key].hits += Number(row.hits) || 0;
      return acc;
    }, {}),
  ).sort((a, b) => b.hits - a.hits);
};

function analyzeTopBottomByStatus(data) {
  if (!data?.length) return {};

  const statusAnalysis = {};

  data.forEach((row) => {
    const status = row.status || 'Unknown';
    if (!statusAnalysis[status]) {
      statusAnalysis[status] = { urls: [] };
    }
    statusAnalysis[status].urls.push({
      url: row.url || '',
      hits: row.total_requests || 0,
    });
  });

  Object.keys(statusAnalysis).forEach((status) => {
    const urls = statusAnalysis[status].urls.sort((a, b) => b.hits - a.hits);
    statusAnalysis[status] = {
      top: urls.slice(0, 5),
      bottom: urls.slice(-5).reverse(),
    };
  });

  return statusAnalysis;
}

export const SHEET_CONFIGS = {
  userAgents: {
    getHeaders: (periods) => {
      const lastWeek = periods.weeks[periods.weeks.length - 1];
      return [
        'Request User Agent',
        'Status',
        'Number of Hits',
        `Interval: Last Week (${lastWeek.dateRange.start} - ${lastWeek.dateRange.end})`,
      ];
    },
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [2],
    processData: (data) => data?.map((row) => [
      /* c8 ignore next 3 */
      row.user_agent || 'Unknown',
      Number(row.status) || 'All',
      Number(row.total_requests) || 0,
      '',
    ]) || [],
  },

  country: {
    getHeaders: (periods) => ['Country Code', ...periods.columns],
    headerColor: SHEET_COLORS.DEFAULT,
    getNumberColumns: (periods) => (
      Array.from({ length: periods.columns.length - 1 }, (_, i) => i + 1)
    ),
    processData: (data, reportPeriods) => {
      const aggregatedData = processCountryWeeklyData(data, reportPeriods);
      return processWeekData(
        aggregatedData,
        reportPeriods,
        (row) => row.country_code,
      );
    },
  },

  pageType: {
    getHeaders: (periods) => ['Page Type', ...periods.columns],
    headerColor: SHEET_COLORS.DEFAULT,
    getNumberColumns: (periods) => (
      Array.from({ length: periods.columns.length - 1 }, (_, i) => i + 1)
    ),
    processData: (data, reportPeriods) => {
      if (data?.length > 0) {
        return processWeekData(data, reportPeriods, (row) => row.page_type || 'Other');
      }
      return [['No data', ...reportPeriods.weeks.map(() => 0)]];
    },
  },

  topBottom: {
    getHeaders: () => ['Status', 'TOP', '', '', 'BOTTOM', ''],
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [2, 5],
    processData: (data) => {
      const rows = [['', 'URL', 'Hits', '', 'URL', 'Hits']];
      const statusAnalysis = analyzeTopBottomByStatus(data);

      Object.entries(statusAnalysis).forEach(([status, analysis]) => {
        rows.push([status, '', '', '', '', '']);
        for (let i = 0; i < 5; i += 1) {
          const topUrl = analysis.top[i];
          const bottomUrl = analysis.bottom[i];
          rows.push([
            '',
            topUrl?.url || '',
            Number(topUrl?.hits) || '',
            '',
            bottomUrl?.url || '',
            Number(bottomUrl?.hits) || '',
          ]);
        }
      });
      return rows;
    },
  },

  error404: {
    getHeaders: () => ['URL', 'Number of 404s'],
    headerColor: SHEET_COLORS.ERROR,
    numberColumns: [1],
    /* c8 ignore next */
    processData: (data) => data?.map((row) => [row.url || '', Number(row.total_requests) || 0]) || [],
  },

  error503: {
    getHeaders: () => ['URL', 'Number of 503s'],
    headerColor: SHEET_COLORS.ERROR,
    numberColumns: [1],
    /* c8 ignore next */
    processData: (data) => data?.map((row) => [row.url || '', Number(row.total_requests) || 0]) || [],
  },

  category: {
    getHeaders: () => ['Category', 'Number of Hits'],
    headerColor: SHEET_COLORS.SUCCESS,
    numberColumns: [1],
    processData: (data) => {
      const urlCountMap = new Map();

      /* c8 ignore next */
      (data || []).forEach((row) => {
        const url = row.url || '';
        const match = url.match(/\/[a-z]{2}\/products\/([^/]+)/);
        const categoryUrl = match ? `products/${match[1]}` : 'Other';

        urlCountMap.set(
          categoryUrl,
          (urlCountMap.get(categoryUrl) || 0) + (Number(row.total_requests) || 0),
        );
      });

      return Array.from(urlCountMap.entries()).sort((a, b) => b[1] - a[1]);
    },
  },

  topUrls: {
    getHeaders: (periods) => ['URL', ...periods.columns],
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [2],
    processData: (data) => data?.map((row) => [
      /* c8 ignore next 2 */
      row.url || '',
      Number(row.total_requests) || 0,
    ]) || [],
  },

  referralCountryTopic: {
    getHeaders: () => ['Country', 'Topic', 'Hits'],
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [2],
    processData: (data) => {
      const aggregatedData = processCountryWithFields(data, ['topic']);
      return aggregatedData.map((row) => [
        row.country,
        capitalizeFirstLetter(row.topic),
        row.hits,
      ]);
    },
  },

  referralUrlTopic: {
    getHeaders: () => ['URL', 'Topic', 'Hits'],
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [2],
    processData: (data) => data?.map((row) => [
      row.url || '',
      capitalizeFirstLetter(row.topic) || 'Other',
      Number(row.hits) || 0,
    ]) || [],
  },
};
