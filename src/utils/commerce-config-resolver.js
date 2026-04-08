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

import { removeTrailingSlash } from './url-utils.js';

/**
 * Finds the best matching store view URL from commerceLlmoConfig for a given product URL.
 * Sorts by URL length (longest first) to find the most specific match.
 * Validates path boundaries to avoid /ro matching /roma.
 * @param {Object} commerceLlmoConfig - Record<storeViewUrl, StoreViewConfig>
 * @param {string} productUrl - The product page URL to match
 * @returns {string|null} The matching store view URL key, or null
 */
export function findBestMatchingStoreViewUrl(commerceLlmoConfig, productUrl) {
  if (!commerceLlmoConfig || !productUrl) {
    return null;
  }

  const normalizedProductUrl = removeTrailingSlash(productUrl);

  const storeViewUrls = Object.keys(commerceLlmoConfig)
    .sort((a, b) => removeTrailingSlash(b).length - removeTrailingSlash(a).length);

  for (const storeViewUrl of storeViewUrls) {
    const normalized = removeTrailingSlash(storeViewUrl);
    if (normalizedProductUrl === normalized) {
      return storeViewUrl;
    }
    if (normalizedProductUrl.startsWith(`${normalized}/`)) { return storeViewUrl; }
  }

  return null;
}

/**
 * Transforms a StoreViewConfig (from commerceLlmoConfig) to the { url, headers } format
 * used by getCommerceConfig throughout the codebase.
 * @param {Object} storeViewConfig - The store view config entry
 * @returns {{ url: string|undefined, headers: Object }}
 */
export function transformToCommerceConfig(storeViewConfig) {
  if (!storeViewConfig) {
    return { url: undefined, headers: {} };
  }

  const headers = {};

  if (storeViewConfig.environmentId) {
    headers['Magento-Environment-Id'] = storeViewConfig.environmentId;
  }
  if (storeViewConfig.websiteCode) {
    headers['Magento-Website-Code'] = storeViewConfig.websiteCode;
  }
  if (storeViewConfig.storeCode) {
    headers['Magento-Store-Code'] = storeViewConfig.storeCode;
  }
  if (storeViewConfig.storeViewCode) {
    headers['Magento-Store-View-Code'] = storeViewConfig.storeViewCode;
  }
  if (storeViewConfig.magentoAPIKey) {
    headers['x-api-key'] = storeViewConfig.magentoAPIKey;
  }

  return {
    url: storeViewConfig.magentoEndpoint || undefined,
    headers,
  };
}

/**
 * Returns the storeViewCode from a commerce config for grouping purposes.
 * @param {Object} commerceConfig - The { url, headers } commerce config
 * @returns {string} The storeViewCode, or '_default' if unavailable
 */
export function configGroupKey(commerceConfig) {
  return commerceConfig?.headers?.['Magento-Store-View-Code'] || '_default';
}

/**
 * Resolves manual commerce config for a given product URL.
 * @param {Object} commerceLlmoConfig - The pre-read commerceLlmoConfig
 * @param {string} productUrl - The product page URL
 * @returns {{ url: string|undefined, headers: Object }|null} Transformed config, or null
 */
export function resolveManualCommerceConfig(commerceLlmoConfig, productUrl) {
  if (!commerceLlmoConfig || Object.keys(commerceLlmoConfig).length === 0) {
    return null;
  }

  const matchedUrl = findBestMatchingStoreViewUrl(commerceLlmoConfig, productUrl);
  if (!matchedUrl) {
    return null;
  }

  return { ...transformToCommerceConfig(commerceLlmoConfig[matchedUrl]), storeViewUrl: matchedUrl };
}

/**
 * Creates a memoized resolver that reads commerceLlmoConfig once from site config
 * and caches resolved configs per product URL.
 * @param {Object} site - The site object
 * @returns {function(string): Object|null} Resolver function
 */
export function createMemoizedManualConfigResolver(site) {
  const commerceLlmoConfig = site?.getConfig?.()?.state?.commerceLlmoConfig;
  const cache = new Map();

  return (productUrl) => {
    if (!commerceLlmoConfig || Object.keys(commerceLlmoConfig).length === 0) {
      return null;
    }

    if (cache.has(productUrl)) {
      return cache.get(productUrl);
    }

    const result = resolveManualCommerceConfig(commerceLlmoConfig, productUrl);
    cache.set(productUrl, result);
    return result;
  };
}
