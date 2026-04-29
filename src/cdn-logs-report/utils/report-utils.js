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

import { getStaticContent, isoCalendarWeek, llmoConfig } from '@adobe/spacecat-shared-utils';
import { uploadToSharePoint } from '../../utils/report-uploader.js';

const ISO_3166_ALPHA2_COUNTRY_CODES = new Set([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
]);

function fetchErrorResult(source, status) {
  return status ? { error: true, status, source } : { error: true, source };
}

function isNotFoundError(error) {
  return error?.status === 404 || error?.statusCode === 404;
}

export async function loadSql(filename, variables) {
  return getStaticContent(variables, `./src/cdn-logs-report/sql/${filename}.sql`);
}

export function validateCountryCode(code, siteIgnoreList = []) {
  const DEFAULT_COUNTRY_CODE = 'GLOBAL';
  // these are codes that are not valid to be regions as these are small islands
  const globalIgnoreCodes = ['TV', 'ST'];
  const countryAliases = {
    UK: 'UK',
  };
  if (!code || typeof code !== 'string') {
    return DEFAULT_COUNTRY_CODE;
  }

  const upperCode = code.toUpperCase();
  const upperSiteIgnoreList = siteIgnoreList.map((c) => c.toUpperCase());
  const ignoreCountryCodes = [...globalIgnoreCodes, ...upperSiteIgnoreList];

  if (upperCode === DEFAULT_COUNTRY_CODE || ignoreCountryCodes.includes(upperCode)) {
    return DEFAULT_COUNTRY_CODE;
  }

  if (countryAliases[upperCode]) {
    return countryAliases[upperCode];
  }

  if (ISO_3166_ALPHA2_COUNTRY_CODES.has(upperCode)) {
    return upperCode;
  }

  return DEFAULT_COUNTRY_CODE;
}

/**
 * Generates reporting periods data for past weeks
 * @param {number|Date} [offsetOrDate=-1] - If number: weeks offset. If Date: reference date
 * @param {Date} [referenceDate=new Date()] - Reference date (when first param is number)
 * @returns {Object} Object with weeks array and periodIdentifier
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

  const { week: weekNumber, year } = isoCalendarWeek(weekStart);

  const periodIdentifier = `w${String(weekNumber).padStart(2, '0')}-${year}`;

  return {
    weeks: [{
      startDate: weekStart, endDate: weekEnd, weekNumber, year, weekLabel: `Week ${weekNumber}`,
    }],
    periodIdentifier,
  };
}
/**
 * Fetches remote patterns for a site
 */
export async function fetchRemotePatterns(site, log = console) {
  const dataFolder = site.getConfig()?.getLlmoDataFolder();

  if (!dataFolder) {
    log.warn('fetchRemotePatterns: no dataFolder configured for site, skipping patterns fetch');
    return null;
  }

  const url = `https://main--project-elmo-ui-data--adobe.aem.live/${dataFolder}/agentic-traffic/patterns/patterns.json`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'spacecat-audit-worker',
        Authorization: `token ${process.env.LLMO_HLX_API_KEY}`,
      },
    });

    if (!res.ok) {
      if (res.status !== 404) {
        log.error(`fetchRemotePatterns: failed to fetch patterns from ${url} — status ${res.status} ${res.statusText}`);
        return fetchErrorResult('patterns', res.status);
      }
      return null;
    }

    const data = await res.json();

    log.info(`fetchRemotePatterns: successfully loaded patterns — ${data.pagetype?.data?.length || 0} page patterns, ${data.products?.data?.length || 0} topic patterns`);

    return {
      pagePatterns: data.pagetype?.data || [],
      topicPatterns: data.products?.data || [],
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    log.error(`fetchRemotePatterns: error fetching patterns from ${url} — ${error.message}`);
    return fetchErrorResult('patterns');
  }
}

function normalizeRuleRows(rows = []) {
  return (rows || []).map((row, index) => ({
    name: row.name,
    regex: row.regex,
    sort_order: Number.isInteger(row.sort_order) ? row.sort_order : index,
  }));
}

/**
 * Reads agentic URL classification rules from Postgres through native
 * PostgREST table endpoints.
 */
export async function fetchAgenticUrlClassificationRules(site, context = {}) {
  const log = context?.log || console;
  const postgrestClient = context?.dataAccess?.services?.postgrestClient;
  const siteId = site.getId();

  if (!postgrestClient?.from) {
    log.warn('fetchAgenticUrlClassificationRules: no PostgREST client available, skipping DB rule fetch');
    return null;
  }

  try {
    const [categoryResult, pageTypeResult] = await Promise.all([
      postgrestClient
        .from('agentic_url_category_rules')
        .select('name,regex,sort_order')
        .eq('site_id', siteId)
        .order('sort_order', { ascending: true }),
      postgrestClient
        .from('agentic_url_page_type_rules')
        .select('name,regex,sort_order')
        .eq('site_id', siteId)
        .order('sort_order', { ascending: true }),
    ]);

    if (categoryResult.error) {
      throw categoryResult.error;
    }
    if (pageTypeResult.error) {
      throw pageTypeResult.error;
    }

    const topicPatterns = normalizeRuleRows(categoryResult.data);
    const pagePatterns = normalizeRuleRows(pageTypeResult.data);

    log.info(`fetchAgenticUrlClassificationRules: loaded ${pagePatterns.length} page patterns, ${topicPatterns.length} topic patterns for site ${siteId}`);

    return {
      pagePatterns,
      topicPatterns,
    };
  } catch (error) {
    log.error(`fetchAgenticUrlClassificationRules: failed to load rules for site ${siteId}: ${error.message}`);
    return {
      error: true,
      source: 'postgres',
    };
  }
}

/**
 * Atomically replaces site-scoped agentic URL classification rules via the
 * writer RPC. Reads continue to use native table endpoints.
 */
export async function replaceAgenticUrlClassificationRules({
  site,
  context,
  categoryRules = [],
  pageTypeRules = [],
  updatedBy = 'audit-worker:agentic-patterns',
}) {
  const siteId = site.getId();
  const postgrestClient = context?.dataAccess?.services?.postgrestClient;

  if (!postgrestClient?.rpc) {
    throw new Error('PostgREST client is required to replace agentic URL classification rules');
  }

  const { data, error } = await postgrestClient.rpc(
    'wrpc_replace_agentic_url_classification_rules',
    {
      p_site_id: siteId,
      p_category_rules: categoryRules,
      p_page_type_rules: pageTypeRules,
      p_updated_by: updatedBy,
    },
  );

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
}

/**
 * Checks query-index.json to confirm whether patterns.json already exists for a site.
 */
export async function queryIndexHasPatternsFile(site, log = console) {
  const dataFolder = site.getConfig()?.getLlmoDataFolder();

  if (!dataFolder) {
    log.warn('queryIndexHasPatternsFile: no dataFolder configured for site, skipping query-index fetch');
    return false;
  }

  const url = `https://main--project-elmo-ui-data--adobe.aem.live/${dataFolder}/query-index.json?limit=5000`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'spacecat-audit-worker',
        Authorization: `token ${process.env.LLMO_HLX_API_KEY}`,
      },
    });

    if (!res.ok) {
      if (res.status !== 404) {
        log.error(`queryIndexHasPatternsFile: failed to fetch query-index from ${url} — status ${res.status} ${res.statusText}`);
        return fetchErrorResult('query-index', res.status);
      }
      return false;
    }

    const data = await res.json();
    const paths = Array.isArray(data?.data) ? data.data : [];

    return paths.some((entry) => entry?.path === `/${dataFolder}/agentic-traffic/patterns/patterns.json`);
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    log.error(`queryIndexHasPatternsFile: error fetching query-index from ${url} — ${error.message}`);
    return fetchErrorResult('query-index');
  }
}

/**
 * Fetches config categories from the latest LLMO config
 */
export async function getConfigCategories(site, context) {
  const { log, s3Client, env } = context;
  const siteId = site.getSiteId();
  const s3Bucket = env.S3_IMPORTER_BUCKET_NAME;

  try {
    const { config } = await llmoConfig.readConfig(
      siteId,
      s3Client,
      { s3Bucket },
    );

    if (!config?.categories) {
      return [];
    }

    return Object.values(config.categories).map((category) => category.name);
  } catch (error) {
    log.warn(`Failed to fetch config categories: ${error.message}`);
    return [];
  }
}

export async function saveExcelReportForBatch({
  workbook,
  outputLocation,
  log,
  sharepointClient,
  filename,
}) {
  const buffer = await workbook.xlsx.writeBuffer();

  if (sharepointClient) {
    await uploadToSharePoint(buffer, filename, outputLocation, sharepointClient, log);
    return { filename, outputLocation };
  }

  return null;
}
