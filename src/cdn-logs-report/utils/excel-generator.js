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

import ExcelJS from 'exceljs';
import { generateReportingPeriods, validateCountryCode } from './report-utils.js';

const WEEK_KEY_TRANSFORMER = (weekLabel) => weekLabel.replace(' ', '_').toLowerCase();
const SHEET_COLORS = {
  DEFAULT: 'FFE6E6FA',
  ERROR: 'FFFFE6E6',
  SUCCESS: 'FFE6F6E6',
};
const EXCEL_CONFIG = {
  DEFAULT_COLUMN_WIDTH: 15,
  NUMBER_FORMAT: '#,##0',
  FONT: {
    bold: true,
    size: 11,
    color: { argb: 'FF000000' },
  },
  CONTENT_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

  // Sort and slice in single operation
  Object.keys(statusAnalysis).forEach((status) => {
    const urls = statusAnalysis[status].urls.sort((a, b) => b.hits - a.hits);
    statusAnalysis[status] = {
      top: urls.slice(0, 5),
      bottom: urls.slice(-5).reverse(),
    };
  });

  return statusAnalysis;
}

const SHEET_CONFIGS = {
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
      if (!data?.length) return [];

      const countryMap = data.reduce((map, row) => {
        const validatedCode = validateCountryCode(row.country_code || '');

        if (!map.has(validatedCode)) {
          const newRow = { country_code: validatedCode };
          reportPeriods.weeks.forEach((week) => {
            const weekKey = WEEK_KEY_TRANSFORMER(week.weekLabel);
            newRow[weekKey] = 0;
          });
          map.set(validatedCode, newRow);
        }

        const aggregatedRow = map.get(validatedCode);
        reportPeriods.weeks.forEach((week) => {
          const weekKey = WEEK_KEY_TRANSFORMER(week.weekLabel);
          aggregatedRow[weekKey] += Number(row[weekKey]) || 0;
        });

        return map;
      }, new Map());

      return processWeekData(
        Array.from(countryMap.values()),
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
};

function getSheetConfig(type, periods) {
  const config = SHEET_CONFIGS[type];
  /* c8 ignore start */
  if (!config) {
    throw new Error(`Unknown sheet type: ${type}`);
  }
  /* c8 ignore stop */

  return {
    /* c8 ignore next */
    headers: typeof config.getHeaders === 'function' ? config.getHeaders(periods) : config.getHeaders(),
    headerColor: config.headerColor,
    numberColumns: typeof config.getNumberColumns === 'function' ? config.getNumberColumns(periods) : config.numberColumns,
    processData: config.processData,
  };
}

function styleHeaders(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = EXCEL_CONFIG.FONT;
}

function formatColumns(worksheet, config) {
  worksheet.columns.forEach((_, index) => {
    const column = worksheet.getColumn(index + 1);

    let maxLength = 0;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const cellValue = cell.value ? cell.value.toString() : '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 10), 60);
  });

  if (config.numberColumns) {
    config.numberColumns.forEach((colIndex) => {
      const column = worksheet.getColumn(colIndex + 1);
      column.numFmt = EXCEL_CONFIG.NUMBER_FORMAT;
    });
  }
}

function createSheet(workbook, name, data, type, periods) {
  const worksheet = workbook.addWorksheet(name);
  const config = getSheetConfig(type, periods);

  worksheet.addRow(config.headers);
  styleHeaders(worksheet);

  const processedData = config.processData(data, periods);
  processedData.forEach((row) => worksheet.addRow(row));

  formatColumns(worksheet, config);

  return worksheet;
}

export async function createCDNLogsExcelReport(reportData, options = {}) {
  const { referenceDate, customEndDate, site } = options;

  const periods = customEndDate
    ? generateReportingPeriods(new Date(customEndDate))
    : generateReportingPeriods(referenceDate);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Spacecat CDN Logs Report';
  workbook.created = new Date();

  const isBulkCom = site && site.getBaseURL().includes('bulk.com');

  const sheets = [
    { name: 'shared-hits_by_user_agents', data: reportData.reqcountbyuseragent, type: 'userAgents' },
    { name: 'shared-hits_by_country', data: reportData.reqcountbycountry, type: 'country' },
    { name: 'shared-hits_by_page_type', data: reportData.reqcountbyurlstatus, type: 'pageType' },
    { name: 'shared-top_bottom_5_by_status', data: reportData.top_bottom_urls_by_status, type: 'topBottom' },
    { name: 'shared-404_all_urls', data: reportData.error_404_urls, type: 'error404' },
    { name: 'shared-503_all_urls', data: reportData.error_503_urls, type: 'error503' },
    { name: 'shared-hits_by_page', data: reportData.top_urls, type: 'topUrls' },
  ];

  if (isBulkCom) {
    sheets.push({ name: 'shared-200s_by_category', data: reportData.success_urls_by_category, type: 'category' });
  }

  for (const sheet of sheets) {
    createSheet(workbook, sheet.name, sheet.data, sheet.type, periods);
  }

  return workbook;
}
