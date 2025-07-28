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
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { API_BASE_URL, LLM_404_BLOCKED_AUDIT } from './constants.js';
import { sleep } from '../support/utils.js';

/**
 * Convert URL paths to full URLs using site base URL
 * @param {Array} urlPaths - Array of URL paths (e.g., ["/404.html", "/page"])
 * @param {string} siteBaseUrl - Site base URL
 * @param {Object} log - Logger instance
 * @returns {Array} Array of full URLs
 */
export function convertPathsToFullUrls(urlPaths, siteBaseUrl, log) {
  const fullUrls = [];

  for (const path of urlPaths) {
    try {
      const fullUrl = new URL(path, siteBaseUrl).href;
      fullUrls.push(fullUrl);
    } catch {
      log.warn(`[${LLM_404_BLOCKED_AUDIT}] Invalid URL path: ${path}, skipping`);
    }
  }

  return fullUrls;
}

// Moved after function definitions below

export function buildApiUrl(outputLocation, weekPeriod) {
  return `${API_BASE_URL}/${outputLocation}/agentictraffic-chatgpt-${weekPeriod}.json`;
}

// Excel generation utilities
const EXCEL_CONFIG = {
  DEFAULT_COLUMN_WIDTH: 30,
  NUMBER_FORMAT: '#,##0',
  FONT: {
    bold: true,
    size: 11,
    color: { argb: 'FF000000' },
  },
};

function styleHeaders(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = EXCEL_CONFIG.FONT;
}

function formatColumns(worksheet) {
  worksheet.columns.forEach((column, index) => {
    let maxLength = 0;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const cellLength = cell.value ? cell.value.toString().length : 10;
      if (cellLength > maxLength) {
        maxLength = cellLength;
      }
    });
    // eslint-disable-next-line no-param-reassign
    column.width = Math.min(Math.max(maxLength, 15), 60);

    if (index === 1) { // 'Number of 404s' column
      // eslint-disable-next-line no-param-reassign
      column.numFmt = EXCEL_CONFIG.NUMBER_FORMAT;
    }
  });
}

export async function createExcelReport(reportData) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SpaceCat';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('LLM-404-Blocked-Suggestions');

  worksheet.columns = [
    { header: 'URL', key: 'url', width: 60 },
    { header: 'Number of 404s', key: 'count404s', width: 20 },
    { header: 'Suggestions', key: 'suggestions', width: 60 },
  ];

  styleHeaders(worksheet);

  reportData.forEach((row) => {
    worksheet.addRow({
      url: row.url,
      count404s: row.count_404s,
      suggestions: row.suggestions.join(', '),
    });
  });

  formatColumns(worksheet);

  return workbook;
}

const TIME_CONSTANTS = {
  ISO_MONDAY: 1,
  ISO_SUNDAY: 0,
  DAYS_PER_WEEK: 7,
};

export function formatDateString(date) {
  return date.toISOString().split('T')[0];
}

function getWeekNumber(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export function getWeekRange(offsetWeeks = 0, referenceDate = new Date()) {
  const refDate = new Date(referenceDate);
  const isSunday = refDate.getUTCDay() === TIME_CONSTANTS.ISO_SUNDAY;
  const daysToMonday = isSunday ? 6 : refDate.getUTCDay() - TIME_CONSTANTS.ISO_MONDAY;

  const weekStart = new Date(refDate);
  const totalOffset = daysToMonday - (offsetWeeks * TIME_CONSTANTS.DAYS_PER_WEEK);
  weekStart.setUTCDate(refDate.getUTCDate() - totalOffset);
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

export function generatePeriodIdentifier(startDate, endDate) {
  const start = formatDateString(startDate);
  const end = formatDateString(endDate);

  const diffDays = Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));
  if (diffDays === 7) {
    const year = startDate.getUTCFullYear();
    const weekNum = getWeekNumber(startDate);
    return `w${String(weekNum).padStart(2, '0')}-${year}`;
  }

  return `${start}_to_${end}`;
}

export function calculateCurrentWeek() {
  // Get last week's range (offset -1)
  const { weekStart, weekEnd } = getWeekRange(-1);

  // Generate period identifier in format "w28-2025"
  return generatePeriodIdentifier(weekStart, weekEnd);
}

// Report upload functions
async function publishToAdminHlx(filename, outputLocation, log) {
  try {
    const org = 'adobe';
    const site = 'project-elmo-ui-data';
    const ref = 'main';
    const jsonFilename = `${filename.replace(/\.[^/.]+$/, '')}.json`;
    const path = `${outputLocation}/${jsonFilename}`;
    const headers = { Cookie: `auth_token=${process.env.ADMIN_HLX_API_KEY}` };

    const baseUrl = 'https://admin.hlx.page';
    const endpoints = [
      { name: 'preview', url: `${baseUrl}/preview/${org}/${site}/${ref}/${path}` },
      { name: 'live', url: `${baseUrl}/live/${org}/${site}/${ref}/${path}` },
    ];

    for (const [index, endpoint] of endpoints.entries()) {
      log.info(`Publishing Excel report via admin API (${endpoint.name}): ${endpoint.url}`);

      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(endpoint.url, { method: 'POST', headers });

      if (!response.ok) {
        throw new Error(`${endpoint.name} failed: ${response.status} ${response.statusText}`);
      }

      log.info(`Excel report successfully published to ${endpoint.name}`);

      if (index === 0) {
        log.info('Waiting 2 seconds before publishing to live...');
        // eslint-disable-next-line no-await-in-loop
        await sleep(2000);
      }
    }
  } catch (publishError) {
    log.error(`Failed to publish via admin.hlx.page: ${publishError.message}`);
  }
}

async function uploadToSharePoint(buffer, filename, outputLocation, sharepointClient, log) {
  try {
    const documentPath = `/sites/elmo-ui-data/${outputLocation}/${filename}`;
    const sharepointDoc = sharepointClient.getDocument(documentPath);
    await sharepointDoc.uploadRawDocument(buffer);
    log.info(`Excel report successfully uploaded to SharePoint: ${documentPath}`);
  } catch (error) {
    log.error(`Failed to upload to SharePoint: ${error.message}`);
    throw error;
  }
}

export async function saveExcelReport({
  workbook,
  outputLocation,
  log,
  sharepointClient,
  filename,
}) {
  try {
    const buffer = await workbook.xlsx.writeBuffer();
    if (sharepointClient) {
      await uploadToSharePoint(buffer, filename, outputLocation, sharepointClient, log);
      await publishToAdminHlx(filename, outputLocation, log);
    }
  } catch (error) {
    log.error(`Failed to save Excel report: ${error.message}`);
    throw error;
  }
}
