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

/**
 * Parses additional data to extract and normalize URLs, handling comma-separated values
 * @param {Array|null} additionalData - Raw additional data from SQS (array of strings)
 * @param {string} domain - The domain to use for normalizing relative URLs
 * @returns {Array|null} Array of normalized URLs or null
 */
export function parseCustomUrls(additionalData, domain = null) {
  if (!additionalData || !Array.isArray(additionalData) || additionalData.length === 0) {
    return null;
  }

  // Join all data and split by commas to handle comma-separated URLs
  const allUrls = additionalData
    .join(',')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .map((url) => {
      // Normalize relative paths to full URLs for consistency with RUM data
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (domain) {
          // Clean domain (remove trailing slash) and ensure path starts with /
          const cleanDomain = domain.replace(/\/$/, '');
          const path = url.startsWith('/') ? url : `/${url}`;
          return `${cleanDomain}${path}`;
        }
        // If no domain provided, return as-is (for backward compatibility)
        return url;
      }
      return url;
    })
    .filter((url, index, array) => array.indexOf(url) === index); // Remove duplicates

  return allUrls.length > 0 ? allUrls : null;
}
