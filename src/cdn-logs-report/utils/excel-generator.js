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
import ExcelJS from 'exceljs';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { generateReportingPeriods } from './date-utils.js';
import {
  SHEET_COLORS, STATUS_CODES, EXCEL_CONFIG, ERROR_MESSAGES,
} from '../constants/index.js';

const WEEK_KEY_TRANSFORMER = (weekLabel) => weekLabel.replace(' ', '_').toLowerCase();

const processWeekData = (data, periods, valueExtractor) => data?.map((row) => {
  const result = [valueExtractor(row)];
  periods.weeks.forEach((week) => {
    const weekKey = WEEK_KEY_TRANSFORMER(week.weekLabel);
    result.push(Number(row[weekKey]) || 0);
  });
  result.push(Number(row.last_30d) || 0);
  return result;
}) || [];

const filterByStatusCodes = (data, statusCodes) => (
  data?.filter((row) => statusCodes.includes(row.status_code)) || []
);

function analyzeTopBottomByStatus(data) {
  if (!data?.length) return {};

  const statusAnalysis = {};

  data.forEach((row) => {
    const status = row.status_code || 'Unknown';
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
    getHeaders: (periods) => [
      'Request User Agent',
      'Status',
      'Number of Hits',
      `Interval: 30d (${periods.last30Days.dateRange.start} - ${periods.last30Days.dateRange.end})`,
    ],
    headerColor: SHEET_COLORS.DEFAULT,
    numberColumns: [2],
    processData: (data) => data?.map((row) => [
      row.user_agent || 'Unknown',
      Number(row.status_code) || 'All',
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
    processData: (data, reportPeriods) => (
      processWeekData(data, reportPeriods, (row) => row.country_code || 'Unknown')
    ),
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
      return [['No data', ...reportPeriods.weeks.map(() => 0), 0]];
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
        const maxRows = Math.max(analysis.top.length, analysis.bottom.length);
        for (let i = 0; i < Math.min(maxRows, 5); i += 1) {
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
    processData: (data) => {
      const urls404 = filterByStatusCodes(data, STATUS_CODES.NOT_FOUND);
      return urls404.map((row) => [row.url || '', Number(row.total_requests) || 0]);
    },
  },

  error503: {
    getHeaders: () => ['URL', 'Number of 503s'],
    headerColor: SHEET_COLORS.ERROR,
    numberColumns: [1],
    processData: (data) => {
      const urls503 = filterByStatusCodes(data, STATUS_CODES.SERVER_ERROR);
      return urls503.map((row) => [row.url || '', Number(row.total_requests) || 0]);
    },
  },

  category: {
    getHeaders: () => ['Category', 'Number of Hits'],
    headerColor: SHEET_COLORS.SUCCESS,
    numberColumns: [1],
    processData: (data) => {
      const urls200 = filterByStatusCodes(data, STATUS_CODES.OK);
      if (urls200.length > 0) {
        return urls200.map((row) => [row.url || 'Other', Number(row.total_requests) || 0]);
      }
      return [['No data', 0]];
    },
  },
};

function getSheetConfig(type, periods) {
  const config = SHEET_CONFIGS[type];
  if (!config) {
    throw new Error(`${ERROR_MESSAGES.UNKNOWN_SHEET_TYPE}: ${type}`);
  }

  return {
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
  const { referenceDate, customEndDate } = options;

  const periods = customEndDate
    ? generateReportingPeriods(new Date(customEndDate))
    : generateReportingPeriods(referenceDate);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Spacecat CDN Logs Report';
  workbook.created = new Date();

  const sheets = [
    { name: 'shared-hits_by_user_agents', data: reportData.reqcountbyuseragent, type: 'userAgents' },
    { name: 'shared-hits_by_country', data: reportData.reqcountbycountry, type: 'country' },
    { name: 'shared-hits_by_page_type', data: reportData.reqcountbyurlstatus, type: 'pageType' },
    { name: 'shared-top_bottom_5_by_status', data: reportData.individual_urls_by_status, type: 'topBottom' },
    { name: 'shared-404_all_urls', data: reportData.individual_urls_by_status, type: 'error404' },
    { name: 'shared-503_all_urls', data: reportData.individual_urls_by_status, type: 'error503' },
    { name: 'shared-200s_by_category', data: reportData.individual_urls_by_status, type: 'category' },
  ];

  for (const sheet of sheets) {
    createSheet(workbook, sheet.name, sheet.data, sheet.type, periods);
  }

  return workbook;
}

export async function saveExcelReport(workbook, bucket, key, s3Client, log) {
  try {
    log.info(`Saving Excel report to S3: s3://${bucket}/${key}`);

    const buffer = await workbook.xlsx.writeBuffer();
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: EXCEL_CONFIG.CONTENT_TYPE,
      ContentDisposition: `attachment; filename="${key.split('/').pop()}"`,
    }));

    const outputPath = `s3://${bucket}/${key}`;
    log.info(`Excel report successfully uploaded to S3: ${outputPath}`);
    return {
      success: true,
      path: outputPath,
      size: buffer.length,
      bucket,
      key,
    };
  } catch (error) {
    log.error(`Failed to save Excel report: ${error.message}`);
    throw error;
  }
}

/* c8 ignore end */
