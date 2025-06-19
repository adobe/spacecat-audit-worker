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
  { name: 'locale_dash_full', regex: '^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?[a-z]{2}-([a-z]{2})(?:/|$)' },
  { name: 'locale_underscore_full', regex: '^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?([a-z]{2})_[a-z]{2}(?:/|$)' },
  { name: 'global_prefix', regex: '^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)(?:global|international)/([a-z]{2})(?:/|$)' },
  { name: 'countries_prefix', regex: '^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)(?:countries?|regions?)/([a-z]{2})(?:/|$)' },
  { name: 'lang_country', regex: '^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)[a-z]{2}/([a-z]{2})(?:/|$)' },
  { name: 'path_3letter_full', regex: '^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?([a-z]{3})(?:/|$)' },
  { name: 'path_2letter_full', regex: '^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?([a-z]{2})(?:/|$)' },
  { name: 'query_country', regex: '[?&]country=([a-z]{2,3})(?:&|$)' },
  { name: 'query_locale', regex: '[?&]locale=[a-z]{2}-([a-z]{2})(?:&|$)' },
];
