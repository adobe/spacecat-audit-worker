/*
 * Copyright 2024 Adobe. All rights reserved.
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
 * Common asset file extensions organized by category
 */
const ASSET_EXTENSIONS = {
  images: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff', '.tif'],
  documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp'],
  media: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mp3', '.wav', '.ogg', '.m4a'],
  archives: ['.zip', '.rar', '.tar', '.gz', '.7z', '.bz2'],
  fonts: ['.woff', '.woff2', '.ttf', '.eot', '.otf'],
};

/**
 * Flattened list of all asset extensions
 */
const ALL_ASSET_EXTENSIONS = Object.values(ASSET_EXTENSIONS).flat();

/**
 * Checks if a URL points to an asset file based on its extension
 * @param {string} url - The URL to check
 * @param {string[]} [extensions] - Optional custom list of extensions to check against
 * @returns {boolean} - True if the URL ends with an asset extension
 */
export function isAssetUrl(url, extensions = ALL_ASSET_EXTENSIONS) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const urlLower = url.toLowerCase();
  return extensions.some((extension) => urlLower.endsWith(extension));
}

/**
 * Checks if a URL points to a specific category of assets
 * @param {string} url - The URL to check
 * @param {string} category - The asset category (images, documents, media, archives, fonts, code)
 * @returns {boolean} - True if the URL ends with an extension from the specified category
 */
export function isAssetCategory(url, category) {
  const extensions = ASSET_EXTENSIONS[category];
  if (!extensions) {
    throw new Error(`Unknown asset category: ${category}. Valid categories are: ${Object.keys(ASSET_EXTENSIONS).join(', ')}`);
  }
  return isAssetUrl(url, extensions);
}

/**
 * Filters an array of URLs to exclude asset URLs
 * @param {string[]} urls - Array of URLs to filter
 * @param {string[]} [extensions] - Optional custom list of extensions to exclude
 * @returns {string[]} - Array of non-asset URLs
 */
export function filterAssetUrls(urls, extensions = ALL_ASSET_EXTENSIONS) {
  return urls.filter((url) => !isAssetUrl(url, extensions));
}

/**
 * Get all asset extensions (for reference or testing)
 * @returns {string[]} - Array of all asset extensions
 */
export function getAllAssetExtensions() {
  return [...ALL_ASSET_EXTENSIONS];
}

/**
 * Get asset extensions by category
 * @returns {Object} - Object containing asset extensions organized by category
 */
export function getAssetExtensionsByCategory() {
  return { ...ASSET_EXTENSIONS };
}
