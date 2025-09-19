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

import { getStaticContent } from '@adobe/spacecat-shared-utils';
import {
  format,
  getWeek,
  getYear,
  differenceInDays,
} from 'date-fns';
import {
  extractCustomerDomain,
  resolveCdnBucketName,
} from '../../utils/cdn-utils.js';

export async function getS3Config(site, context) {
  const customerDomain = extractCustomerDomain(site);
  const domainParts = customerDomain.split(/[._]/);
  /* c8 ignore next */
  const customerName = domainParts[0] === 'www' && domainParts.length > 1 ? domainParts[1] : domainParts[0];
  const bucket = await resolveCdnBucketName(site, context);

  return {
    bucket,
    customerName,
    customerDomain,
    databaseName: `cdn_logs_${customerDomain}`,
    getAthenaTempLocation: () => `s3://${bucket}/temp/athena-results/`,
  };
}

export async function loadSql(filename, variables) {
  return getStaticContent(variables, `./src/cdn-logs-report/sql/${filename}.sql`);
}

export function validateCountryCode(code) {
  const DEFAULT_COUNTRY_CODE = 'GLOBAL';
  if (!code || typeof code !== 'string') return DEFAULT_COUNTRY_CODE;

  const upperCode = code.toUpperCase();

  if (upperCode === DEFAULT_COUNTRY_CODE) return DEFAULT_COUNTRY_CODE;

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const countryName = displayNames.of(upperCode);

    if (countryName && countryName !== upperCode) {
      return upperCode;
    }
    /* c8 ignore next 3 */
  } catch {
    // Invalid country code
  }

  return DEFAULT_COUNTRY_CODE;
}

export async function ensureTableExists(athenaClient, databaseName, reportConfig, log) {
  const {
    createTableSql, tableName, aggregatedLocation,
  } = reportConfig;

  try {
    const createTableQuery = await loadSql(createTableSql, {
      databaseName,
      tableName,
      aggregatedLocation,
    });

    log.debug(`Creating or checking table: ${tableName}`);
    const sqlCreateTableDescription = `[Athena Query] Create table ${databaseName}.${tableName}`;
    await athenaClient.execute(createTableQuery, databaseName, sqlCreateTableDescription);

    log.debug(`Table ${tableName} is ready`);
  } catch (error) {
    log.error(`Failed to ensure table exists: ${error.message}`);
    throw error;
  }
}

/**
 * Generates period identifier. 7-day periods return week format (w01-2024).
 * @param {Date} startDate - Period start date
 * @param {Date} endDate - Period end date
 * @returns {string} Period identifier
 * @example generatePeriodIdentifier(new Date('2024-12-16'), new Date('2024-12-22')) // 'w51-2024'
 */
export function generatePeriodIdentifier(startDate, endDate) {
  if (differenceInDays(endDate, startDate) + 1 === 7) {
    const weekNum = getWeek(startDate, { weekStartsOn: 1 });
    const year = getYear(startDate);
    return `w${String(weekNum).padStart(2, '0')}-${year}`;
  }

  return `${format(startDate, 'yyyy-MM-dd')}_to_${format(endDate, 'yyyy-MM-dd')}`;
}

/**
 * Generates reporting periods data for past weeks
 * @param {number|Date} [offsetOrDate=-1] - If number: weeks offset. If Date: reference date
 * @param {Date} [referenceDate=new Date()] - Reference date (when first param is number)
 * @returns {Object} Object with weeks array and columns
 */
export function generateReportingPeriods(refDate = new Date(), offsetWeeks = -1) {
  const refUTC = new Date(Date.UTC(
    refDate.getUTCFullYear(),
    refDate.getUTCMonth(),
    refDate.getUTCDate(),
  ));

  const dayOfWeek = refUTC.getUTCDay();
  /* c8 ignore next */
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(refUTC);
  weekStart.setUTCDate(refUTC.getUTCDate() - daysToMonday - (Math.abs(offsetWeeks) * 7));
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  const weekNumber = getWeek(weekStart, { weekStartsOn: 1 });
  const year = getYear(weekStart);

  return {
    weeks: [{
      startDate: weekStart, endDate: weekEnd, weekNumber, year, weekLabel: `Week ${weekNumber}`,
    }],
    columns: [`Week ${weekNumber}`],
  };
}

export function buildSiteFilters(filters = []) {
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
 * Fetches remote patterns for a site
 */
export async function fetchRemotePatterns(site) {
  const dataFolder = site.getConfig()?.getLlmoDataFolder();

  if (!dataFolder) {
    return null;
  }

  try {
    const url = `https://main--project-elmo-ui-data--adobe.aem.live/${dataFolder}/agentic-traffic/patterns/patterns.json`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'spacecat-audit-worker',
        Authorization: `token ${process.env.LLMO_HLX_API_KEY}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch pattern data from ${url}: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    return {
      pagePatterns: data.pagetype?.data || [],
      topicPatterns: data.products?.data || [],
    };
  } catch {
    return null;
  }
}
