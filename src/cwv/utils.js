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

import { removeTrailingSlash } from '../utils/url-utils.js';

/**
 * Checks if a CWV data entry URL matches a site baseURL.
 * Only applies to entries with type 'url' (not 'group').
 * @param {object} data - CWV data entry with type and url properties
 * @param {string} baseURL - Normalized baseURL (without trailing slash) to compare against
 * @returns {boolean} - True if the entry's URL matches the given URL
 */
export function isHomepage(data, baseURL) {
  if (data.type !== 'url') return false;
  return removeTrailingSlash(data.url) === baseURL;
}
