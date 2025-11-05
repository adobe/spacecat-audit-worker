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

import { findBestMatchingPath } from './url-utils.js';

/**
 * Deep merges two objects recursively.
 * Arrays are not merged, they are replaced.
 * Null values in source will override target values.
 * @param {Object} target - The target object.
 * @param {Object} source - The source object to merge into target.
 * @returns {Object} - The deeply merged object.
 */
export function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return source;
  }

  const result = { ...target };

  Object.keys(source).forEach((key) => {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)
        && targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
      // Both are objects, merge them recursively
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      // Primitive, array, or null - replace
      result[key] = sourceValue;
    }
  });

  return result;
}

/**
 * Deep merges multiple objects from left to right.
 * @param {...Object} objects - Objects to merge.
 * @returns {Object} - The deeply merged result.
 */
export function deepMergeAll(...objects) {
  return objects.reduce((acc, obj) => deepMerge(acc, obj || {}), {});
}

/**
 * Detects if config has multiple locale/path configurations.
 * Use case: Validation - determine if multi-locale handling is needed.
 * @param {Object} configData - The full config object.
 * @param {string} configSection - The section to check (default: 'public').
 * @returns {boolean} True if multiple paths exist beyond 'default'.
 */
export function isMultiLocaleConfig(configData, configSection = 'public') {
  const sectionData = configData?.[configSection];
  if (!sectionData) return false;

  const paths = Object.keys(sectionData).filter((k) => k !== 'default');
  return paths.length > 0;
}

/**
 * Lists all available locale/path keys in config.
 * Use cases:
 * - Error handling: Show available alternatives when a locale fails
 * - Future admin UI: Display all configured locales
 * - Pre-flight checks: Verify expected locales exist
 * @param {Object} configData - The full config object.
 * @param {string} configSection - The section to check (default: 'public').
 * @returns {string[]} Array of available path keys (excludes 'default').
 */
export function getAvailablePaths(configData, configSection = 'public') {
  const sectionData = configData?.[configSection];
  if (!sectionData) return [];

  return Object.keys(sectionData).filter((k) => k !== 'default');
}

/**
 * Validates if a specific locale/path exists in the config.
 * Use cases:
 * - Validation: "Does this config support the locale I extracted?"
 * - Debugging: "Why isn't locale X working?" (check if it exists)
 * @param {Object} configData - The full config object.
 * @param {string} locale - The locale/path to validate.
 * @param {string} configSection - The section to check (default: 'public').
 * @returns {boolean} True if the locale exists in config.
 */
export function isLocaleSupported(configData, locale, configSection = 'public') {
  const sectionData = configData?.[configSection];
  if (!sectionData) return false;

  // Check direct match
  if (sectionData[locale]) return true;

  // Check with leading/trailing slashes
  const localeWithSlashes = locale.startsWith('/') ? locale : `/${locale}/`;
  if (sectionData[localeWithSlashes]) return true;

  // Check if it matches via findBestMatchingPath
  const matchedPath = findBestMatchingPath(sectionData, locale);
  return matchedPath !== 'default';
}

/**
 * Validates a batch of locales against the config.
 * Use case: Pre-flight checks before processing 1000 pages.
 * @param {Object} configData - The full config object.
 * @param {string[]} locales - Array of locales to validate.
 * @param {string} configSection - The section to check (default: 'public').
 * @returns {Object} Validation result with supported and unsupported locales.
 */
export function validateLocales(configData, locales, configSection = 'public') {
  const supported = [];
  const unsupported = [];
  const availablePaths = getAvailablePaths(configData, configSection);

  locales.forEach((locale) => {
    if (isLocaleSupported(configData, locale, configSection)) {
      supported.push(locale);
    } else {
      unsupported.push(locale);
    }
  });

  return {
    supported,
    unsupported,
    availablePaths, // Show what's available for debugging
    allSupported: unsupported.length === 0,
  };
}

/**
 * Gets the full merged config for a specific path (useful for accessing analytics, plugins, etc.).
 * @param {Object} configData - The full config object.
 * @param {string} path - The path to get config for.
 * @param {string} configSection - The section to use (default: 'public').
 * @returns {Object} The merged config object.
 */
export function getConfigForPath(configData, path, configSection = 'public') {
  const sectionData = configData?.[configSection];
  if (!sectionData) return {};

  const defaultConfig = sectionData.default || {};
  const pathKey = findBestMatchingPath(sectionData, path);
  const pathConfig = sectionData[pathKey] || {};

  if (pathKey === 'default') {
    return defaultConfig;
  }

  return deepMerge(defaultConfig, pathConfig);
}

/**
 * Gets diagnostic information about config locale support.
 * Use case: Debugging - comprehensive info about what's wrong.
 * @param {Object} configData - The full config object.
 * @param {string} locale - The locale being debugged.
 * @param {string} configSection - The section to check (default: 'public').
 * @returns {Object} Diagnostic information.
 */
export function getLocaleDebugInfo(configData, locale, configSection = 'public') {
  const sectionData = configData?.[configSection];
  const availablePaths = getAvailablePaths(configData, configSection);
  const isSupported = isLocaleSupported(configData, locale, configSection);
  const matchedPath = sectionData ? findBestMatchingPath(sectionData, locale) : 'default';

  return {
    locale,
    isSupported,
    matchedPath,
    availablePaths,
    hasMultipleLocales: isMultiLocaleConfig(configData, configSection),
    sectionExists: !!sectionData,
    totalPaths: availablePaths.length + 1, // +1 for default
  };
}
