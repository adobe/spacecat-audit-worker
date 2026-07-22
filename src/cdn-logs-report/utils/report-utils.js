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

import { S3Client } from '@aws-sdk/client-s3';
import { getStaticContent, isoCalendarWeek } from '@adobe/spacecat-shared-utils';

// Region of the importer bucket (S3_IMPORTER_BUCKET_NAME) the daily exports write to.
export const IMPORTER_BUCKET_REGION = 'us-east-1';

let importerS3Client;
/**
 * Lazily-created, shared S3 client pinned to the importer bucket region. Reused
 * across the agentic + referral daily exports and across warm Lambda invocations,
 * instead of constructing a new client per export.
 */
export function getImporterS3Client() {
  if (!importerS3Client) {
    importerS3Client = new S3Client({ region: IMPORTER_BUCKET_REGION });
  }
  return importerS3Client;
}

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
    context?.log?.error?.(`Failed to replace agentic URL classification rules for site ${siteId}: ${error.message}`);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
}

/**
 * Fetches a site's top distinct referral url_paths (ranked by summed pageviews
 * across all referral sources) via the read RPC. This is the Postgres analogue of
 * the CDN Athena top-URLs query — the URL corpus fed to category-rule generation
 * for referral-only sites (LLMO-6257). Returns a flat array of path strings.
 */
export async function fetchReferralTopUrls({ site, context, limit = 200 }) {
  const siteId = site.getId();
  const postgrestClient = context?.dataAccess?.services?.postgrestClient;

  if (!postgrestClient?.rpc) {
    throw new Error('PostgREST client is required to fetch referral top URLs');
  }

  const { data, error } = await postgrestClient.rpc(
    'rpc_referral_traffic_top_urls',
    {
      p_site_id: siteId,
      p_limit: limit,
    },
  );

  if (error) {
    context?.log?.error?.(`Failed to fetch referral top URLs for site ${siteId}: ${error.message}`);
    throw error;
  }

  return (Array.isArray(data) ? data : [])
    .map((row) => row?.url_path)
    .filter((path) => typeof path === 'string' && path.length > 0);
}

/**
 * Materializes a site's active category rules onto its referral URLs via the writer
 * RPC, upserting category_name into agentic_url_classifications (LLMO-6257). Returns
 * the RPC payload ({ site_id, classified }).
 */
export async function applyCategoryRulesToReferral({
  site,
  context,
  source = null,
  since = null,
  updatedBy = 'audit-worker:referral-patterns',
}) {
  const siteId = site.getId();
  const postgrestClient = context?.dataAccess?.services?.postgrestClient;

  if (!postgrestClient?.rpc) {
    throw new Error('PostgREST client is required to apply category rules to referral');
  }

  const { data, error } = await postgrestClient.rpc(
    'wrpc_apply_category_rules_to_referral',
    {
      p_site_id: siteId,
      p_source: source,
      p_since: since,
      p_updated_by: updatedBy,
    },
  );

  if (error) {
    context?.log?.error?.(`Failed to apply category rules to referral for site ${siteId}: ${error.message}`);
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
}
