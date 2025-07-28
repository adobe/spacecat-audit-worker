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

/**
 * Checks if a given URL is a "preview" page
 *
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL is a "preview" page, false otherwise
 */
export function isPreviewPage(url) {
  const urlObj = new URL(url);
  return urlObj.hostname.endsWith('.page');
}

/**
 * Gets the country code (lowercased) from a language code.
 * If the language code is not in the format of "language-country" or "language_country",
 * the default country code is returned.
 * @param {string} lang - The language code.
 * @param {string} defaultCountry - The default country code.
 * @returns {string} - The country code.
 */
export function getCountryCodeFromLang(lang, defaultCountry = 'us') {
  if (!lang) return defaultCountry;
  // Split on hyphen or underscore (both are used in the wild)
  const parts = lang.split(/[-_]/);
  if (parts.length === 2 && parts[1].length === 2) {
    // Return the country part, uppercased
    return parts[1].toLowerCase();
  }
  // If only language is present, return default
  return defaultCountry;
}
