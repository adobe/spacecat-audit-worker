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

export const DEFAULT_COUNTRY_PATTERNS = [
  { name: 'subdomain', regex: '^https?://([a-z]{2})\\.' },
  { name: 'path_3letter', regex: '^[^/]+//[^/]+/([a-z]{3})(?:/|$)' },
  { name: 'path_2letter', regex: '^[^/]+//[^/]+/([a-z]{2})(?:/|$)' },
  { name: 'locale_dash', regex: '^[^/]+//[^/]+/[a-z]{2}-([a-z]{2})(?:/|$)' },
  { name: 'locale_underscore', regex: '^[^/]+//[^/]+/([a-z]{2})_[a-z]{2}(?:/|$)' },
  { name: 'global_prefix', regex: '^[^/]+//[^/]+/(?:global|international)/([a-z]{2})(?:/|$)' },
  { name: 'countries_prefix', regex: '^[^/]+//[^/]+/(?:countries?|regions?)/([a-z]{2})(?:/|$)' },
  { name: 'lang_country', regex: '^[^/]+//[^/]+/[a-z]{2}/([a-z]{2})(?:/|$)' },
  { name: 'query_country', regex: '[?&]country=([a-z]{2,3})(?:&|$)' },
  { name: 'query_locale', regex: '[?&]locale=[a-z]{2}-([a-z]{2})(?:&|$)' },
];

export function buildCountryExtractionSQL() {
  const cases = DEFAULT_COUNTRY_PATTERNS
    .map(({ regex }) => `WHEN REGEXP_EXTRACT(url, '${regex}', 1) != '' THEN UPPER(REGEXP_EXTRACT(url, '${regex}', 1))`)
    .join('\n          ');

  return `
        CASE 
          ${cases}
          WHEN geo_country IS NOT NULL THEN UPPER(geo_country)
          ELSE 'UNKNOWN'
        END`;
}

/* c8 ignore stop */
