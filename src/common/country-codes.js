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

// Codes that are valid ISO-3166 countries but are not real regions - small
// islands whose code is dominated by an unrelated URL path token.
const NON_REGION_CODES = ['TV', 'ST'];

// Codes that are valid ISO-3166 countries but collide with an ISO-639 language
// code, and are dominated fleet-wide by that language's URL path segment
// (e.g. /vi/, /ml/, /sv/, /en_gl/) rather than genuine traffic from the named
// country (LLMO-7230). Each value documents the collision so the reasoning
// survives independently of the PR/test history. CY and AF are deliberately
// NOT here - both were checked against live traffic and are genuine
// country-then-language paths (/cy/el/..., /af/en/...), not language leaks.
// PA is also deliberately not here - Panama is genuine traffic fleet-wide;
// sites needing to exclude it (e.g. Zee5's Punjabi /pa/) use siteIgnoreList.
const LANGUAGE_COLLISION_CODES = {
  VI: 'Vietnamese vs Virgin Islands',
  ML: 'Malayalam vs Mali',
  NE: 'Nepali vs Niger',
  MR: 'Marathi vs Mauritania',
  KN: 'Kannada vs St Kitts',
  BN: 'Bengali vs Brunei',
  GU: 'Gujarati vs Guam',
  MS: 'Malay(sian) vs Montserrat',
  SR: 'Serbian vs Suriname',
  SL: 'Slovenian vs Sierra Leone',
  SV: 'Swedish vs El Salvador',
  ET: 'Estonian vs Ethiopia',
  GA: 'Irish/Georgian vs Gabon',
  GL: '"Global" locale (/en_gl/) vs Greenland',
};

const GLOBAL_IGNORE_CODES = new Set([
  ...NON_REGION_CODES,
  ...Object.keys(LANGUAGE_COLLISION_CODES),
]);

/**
 * Normalizes a raw country code (typically regex-extracted from a URL path) to
 * a display region. Codes that are not valid ISO-3166 alpha-2, are on the
 * global ignore list (non-region small islands + language-collision codes), or
 * are on the caller-supplied per-site ignore list collapse to 'GLOBAL'.
 *
 * @param {string} code - Raw country code (case-insensitive).
 * @param {Array<string>} [siteIgnoreList] - Per-site codes to force to 'GLOBAL'.
 * @returns {string} A validated ISO-3166 code, the 'UK' alias, or 'GLOBAL'.
 */
export function validateCountryCode(code, siteIgnoreList = []) {
  const DEFAULT_COUNTRY_CODE = 'GLOBAL';
  const countryAliases = {
    UK: 'UK',
  };
  if (!code || typeof code !== 'string') {
    return DEFAULT_COUNTRY_CODE;
  }

  const upperCode = code.toUpperCase();
  const upperSiteIgnoreList = siteIgnoreList.map((c) => c.toUpperCase());
  const ignoreCountryCodes = [...GLOBAL_IGNORE_CODES, ...upperSiteIgnoreList];

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
