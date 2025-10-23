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

export const DEFAULT_COUNTRY_PATTERNS = [
  // Matches locale with dash format: /en-us/, /fr-fr/, https://example.com/de-de/page
  { name: 'locale_dash_full', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?[a-z]{2}-([a-z]{2})(?:/|$)' },

  // Matches locale with underscore format: /en_us/, /fr_fr/, https://example.com/de_de/page
  { name: 'locale_underscore_full', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?[a-z]{2}_([a-z]{2})(?:/|$)' },

  // Matches locale files: /en_us.html, /fr_ca.jsp, etc.
  { name: 'locale_underscore_file', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?[a-z]{2}_([a-z]{2})\\.[a-z]+$' },

  // Matches global/international prefix: /global/us/, /international/fr/, https://example.com/global/de/
  { name: 'global_prefix', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)(?:global|international)/([a-z]{2})(?:/|$)' },

  // Matches countries/regions prefix: /countries/us/, /regions/fr/, https://example.com/country/de/
  { name: 'countries_prefix', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)(?:countries?|regions?)/([a-z]{2})(?:/|$)' },

  // Matches country/language format: /us/en/, /ca/fr/, https://example.com/de/en/page
  { name: 'country_lang', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)([a-z]{2})/[a-z]{2}(?:/|$)' },

  // Matches 2-letter country codes: /us/, /fr/, /de/, https://example.com/gb/page
  { name: 'path_2letter_full', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?([a-z]{2})(?:/|$)' },

  // Matches country query parameter: ?country=us, &country=fr, ?country=usa
  { name: 'query_country', regex: '(?i)[?&]country=([a-z]{2,3})(?:&|$)' },

  // Matches locale query parameter: ?locale=en-us, &locale=fr-fr
  { name: 'query_locale', regex: '(?i)[?&]locale=[a-z]{2}-([a-z]{2})(?:&|$)' },
];
