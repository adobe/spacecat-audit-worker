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

const TIME_CONSTANTS = {
  ISO_MONDAY: 1,
  ISO_SUNDAY: 0,
  DAYS_PER_WEEK: 7,
};

const REGEX_PATTERNS = {
  URL_SANITIZATION: /[^a-zA-Z0-9]/g,
  BUCKET_SANITIZATION: /[._]/g,
};

const CDN_LOGS_PREFIX = 'cdn-logs-';

export function extractCustomerDomain(site) {
  return new URL(site.getBaseURL()).host
    .replace(REGEX_PATTERNS.URL_SANITIZATION, '_')
    .toLowerCase();
}

export function getAnalysisBucket(customerDomain) {
  const bucketCustomer = customerDomain.replace(REGEX_PATTERNS.BUCKET_SANITIZATION, '-');
  return `${CDN_LOGS_PREFIX}${bucketCustomer}`;
}

export function getS3Config(site) {
  const customerDomain = extractCustomerDomain(site);
  const customerName = customerDomain.split(/[._]/)[0];
  const { bucketName: bucket } = site.getConfig().getCdnLogsConfig()
    || { bucketName: getAnalysisBucket(customerDomain) };

  return {
    bucket,
    customerName,
    customerDomain,
    aggregatedLocation: `s3://${bucket}/aggregated/`,
    databaseName: `cdn_logs_${customerDomain}`,
    tableName: `aggregated_logs_${customerDomain}`,
    getAthenaTempLocation: () => `s3://${bucket}/temp/athena-results/`,
  };
}

export async function validateDatabaseAndTable(athenaClient, s3Config, log) {
  const { tableName, databaseName } = s3Config;

  try {
    const validationQuery = `SELECT 1 FROM ${databaseName}.${tableName} LIMIT 1`;
    log.info(`Validating database and table: ${databaseName}.${tableName}`);

    await athenaClient.query(validationQuery, databaseName, `[Athena Query] Validate ${databaseName}.${tableName}`);
    log.info('Database and table validated successfully');
  } catch (error) {
    const errorMessage = `Database '${databaseName}' or table '${tableName}' does not exist: ${error.message}`;
    log.error(errorMessage);
    throw new Error(errorMessage);
  }
}

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

export function createDateRange(startInput, endInput) {
  const startDate = new Date(startInput);
  const endDate = new Date(endInput);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid date format provided');
  }

  if (startDate >= endDate) {
    throw new Error('Start date must be before end date');
  }

  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);

  return { startDate, endDate };
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

export function generateReportingPeriods(referenceDate = new Date()) {
  const { weekStart, weekEnd } = getWeekRange(-1, referenceDate);

  const weekNumber = getWeekNumber(weekStart);
  const year = weekStart.getUTCFullYear();

  const weeks = [{
    weekNumber,
    year,
    weekLabel: `Week ${weekNumber}`,
    startDate: weekStart,
    endDate: weekEnd,
    dateRange: {
      start: formatDateString(weekStart),
      end: formatDateString(weekEnd),
    },
  }];

  return {
    weeks,
    referenceDate: referenceDate.toISOString(),
    columns: [`Week ${weekNumber}`],
  };
}

export function buildSiteFilters(filters) {
  if (!filters || filters.length === 0) return '';

  const clauses = filters.map(({ key, value, type }) => {
    const regexPattern = value.join('|');
    if (type === 'exclude') {
      return `NOT REGEXP_LIKE(${key}, '(?i)(${regexPattern})')`;
    }
    return `REGEXP_LIKE(${key}, '(?i)(${regexPattern})')`;
  });

  const filterConditions = clauses.length > 1 ? clauses.join(' AND ') : clauses[0];
  return `(${filterConditions})`;
}

/**
 * Processes raw query results for LLM error pages audit
 * @param {Array} results - Raw results from Athena query
 * @returns {Object} Processed results with summary statistics
 */
export function processLlmErrorPagesResults(results) {
  if (!results || results.length === 0) {
    return {
      totalErrors: 0,
      errorPages: [],
      summary: {
        uniqueUrls: 0,
        uniqueUserAgents: 0,
        statusCodes: {},
      },
    };
  }

  const statusCodes = {};
  const uniqueUrls = new Set();
  const uniqueUserAgents = new Set();

  results.forEach((row) => {
    const status = row.status || 'Unknown';
    statusCodes[status] = (statusCodes[status] || 0) + (row.total_requests || 0);
    uniqueUrls.add(row.url);
    uniqueUserAgents.add(row.user_agent);
  });

  const totalErrors = Object.values(statusCodes).reduce((sum, count) => sum + count, 0);

  return {
    totalErrors,
    errorPages: results,
    summary: {
      uniqueUrls: uniqueUrls.size,
      uniqueUserAgents: uniqueUserAgents.size,
      statusCodes,
    },
  };
}
