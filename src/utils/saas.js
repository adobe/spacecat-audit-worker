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

import { hasText } from '@adobe/spacecat-shared-utils';
import { findBestMatchingPath } from './url-utils.js';
import { deepMerge, deepMergeAll } from './config-utils.js';

/**
 * Extracts headers from config with flexible scope support.
 * Merges headers from both 'all' scope and a specific scope (e.g., 'cs', 'pdp', 'plp').
 * @param {Object} sectionData - The section data containing default config.
 * @param {Object} localeData - The locale-specific data.
 * @param {string} scope - The scope to extract (e.g., 'cs', 'pdp', 'plp').
 * @returns {Object} Merged headers with 'all' + scope-specific.
 */
function extractHeaders(sectionData, localeData, scope = 'cs') {
  const defaultAllHeaders = sectionData.default?.headers?.all || {};
  const defaultScopeHeaders = sectionData.default?.headers?.[scope] || {};
  const localeAllHeaders = localeData.headers?.all || {};
  const localeScopeHeaders = localeData.headers?.[scope] || {};

  return deepMergeAll(
    defaultAllHeaders,
    defaultScopeHeaders,
    localeAllHeaders,
    localeScopeHeaders,
  );
}

/**
 * Makes an HTTP request with custom headers and timeout handling.
 * @param {string} name - Identifier for the request.
 * @param {string} url - Target URL.
 * @param {object} req - Request options and headers.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {Promise<any|string|null>} - Response data or null.
 */
export async function request(name, url, req = [], timeout = 60000) {
  if (timeout <= 0 || timeout > 300000) { // max 5 minutes
    throw new Error('Timeout must be between 1ms and 300000ms');
  }

  // allow requests for 60s max
  const abortController = new AbortController();
  const abortTimeout = setTimeout(() => abortController.abort(), timeout);

  const headers = {
    ...req.headers,
    'User-Agent': 'Spacecat/1.0',
  };

  const resp = await fetch(url, {
    ...req,
    headers,
    signal: abortController.signal,
  });
  // clear the abort timeout if the request passed
  clearTimeout(abortTimeout);

  let responseText = '';

  if (resp.ok) {
    if (resp.status < 204) {
      // ok with content
      return resp.headers.get('content-type') === 'application/json' ? resp.json() : resp.text();
    } else if (resp.status === 204) {
      // ok but no content
      return null;
    }
  } else {
    try {
      responseText = await resp.text();
      // eslint-disable-next-line no-unused-vars
    } catch (e) { /* nothing to be done */ }
  }

  throw new Error(`Request '${name}' to '${url}' failed (${resp.status}): ${resp.headers.get('x-error') || resp.statusText}${responseText.length > 0 ? ` responseText: ${responseText}` : ''}`);
}

/**
 * Fetches spreadsheet data from a given config path and optional sheet name.
 * Useful for loading configuration or data from remote sources.
 * @param configPath - The URL or path to the spreadsheet config.
 * @param sheet - Optional sheet name to request specific data.
 * @returns {Promise<*|string|null>} - The spreadsheet data, string, or null.
 */
export async function requestSpreadsheet(configPath, sheet) {
  return request(
    'spreadsheet',
    configPath + (sheet ? `?sheet=${sheet}` : ''),
  );
}

/**
 * Validates the required fields in the config object for a given locale (PAAS format).
 * @param config - Configuration object to validate.
 * @param locale - Locale identifier.
 * @returns {*} - The validated config object.
 */
export function validateConfig(config, locale) {
  const requiredConfigFields = [
    'commerce-customer-group',
    'commerce-environment-id',
    'commerce-store-code',
    'commerce-store-view-code',
    'commerce-website-code',
    'commerce-x-api-key',
  ];
  const missingFields = [];

  for (const field of requiredConfigFields) {
    if (!hasText(config[field])) {
      missingFields.push(`Missing required parameter: ${field}`);
    }
  }

  if (missingFields.length > 0) {
    throw new Error(`Missing required config parameters for ${locale} locale: ${missingFields.join(', ')}`);
  }

  return config;
}

/**
 * Normalizes commerce config keys to support dot-separated alternatives.
 * Adds hyphenated keys for any `commerce.*` keys while preserving originals.
 * @param {Object} config - Raw config object.
 * @returns {Object} Normalized config with hyphenated commerce keys.
 */
function normalizeCommerceConfigKeys(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  let normalized = config;
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('commerce.')) {
      const hyphenKey = key.replace(/\./g, '-');
      if (!hasText(config[hyphenKey])) {
        if (normalized === config) {
          normalized = { ...config };
        }
        normalized[hyphenKey] = value;
      }
    }
  }
  return normalized;
}

/**
 * Validates the commerce config return shape.
 * Checks for url and all required headers.
 * Supports both PAAS Magento-* headers and new AC format (minimal headers).
 * AC-Environment-Id can be used in config as a fallback source for Magento-Environment-Id,
 * but only Magento-Environment-Id is sent in actual request headers.
 * @param {Object} config - The config object with url and headers.
 * @param {string} locale - Locale identifier.
 * @throws {Error} If required fields are missing.
 */
function validateCommerceConfigShape(config, locale) {
  const missingFields = [];

  if (!hasText(config.url)) {
    missingFields.push('url');
  }

  if (!config.headers) {
    missingFields.push('headers');
  } else {
    // Check for Magento-Environment-Id (required)
    const hasEnvironmentId = hasText(config.headers['Magento-Environment-Id']);

    if (!hasEnvironmentId) {
      missingFields.push('headers.Magento-Environment-Id');
    }

    // Determine if this is AC format or PAAS Magento format
    // AC format: only has Magento-Environment-Id and possibly AC-View-ID (no PAAS fields)
    // PAAS format: has all the Magento-* fields plus x-api-key
    const hasPaasFields = hasText(config.headers['Magento-Customer-Group'])
      || hasText(config.headers['Magento-Store-Code'])
      || hasText(config.headers['Magento-Store-View-Code'])
      || hasText(config.headers['Magento-Website-Code'])
      || hasText(config.headers['x-api-key']);

    const isPaasFormat = hasPaasFields;

    if (isPaasFormat) {
      // PAAS Magento-* format validation - store identifiers required
      // Magento-Customer-Group and x-api-key are optional.
      const requiredHeaders = [
        'Magento-Store-Code',
        'Magento-Store-View-Code',
        'Magento-Website-Code',
      ];

      for (const field of requiredHeaders) {
        if (!hasText(config.headers[field])) {
          missingFields.push(`headers.${field}`);
        }
      }
    }
    // For AC format, only Magento-Environment-Id is required
    // Other AC-* headers like AC-View-ID are optional
  }

  if (missingFields.length > 0) {
    throw new Error(`Missing required commerce config fields for ${locale} locale: ${missingFields.join(', ')}`);
  }
}

/**
 * Extracts commerce configuration from PAAS instance type.
 * Fetches and validates config from remote spreadsheet/JSON file.
 * @param {Object} params - Configuration parameters.
 * @param {Object} log - Logger instance.
 * @returns {Promise<Object>} Commerce config with url and headers.
 */
export async function extractCommerceConfigFromPAAS(params, log) {
  const {
    configName = 'configs',
    configSheet,
    storeUrl,
    locale,
  } = params;
  const localeLabel = locale || 'default';

  if (!params.config) {
    const localePath = locale ? `${locale}/` : '';
    const configPath = `${storeUrl}/${localePath}${configName}.json`;
    log.debug(`Fetching PAAS config from ${configPath}`);
    const configData = params.configData || await requestSpreadsheet(configPath, configSheet);

    let data;
    if (params.configSection) {
      data = configData[params.configSection].data;
    } else {
      data = configData.data;
    }

    // Defensive validation: handle empty or missing data
    if (!data || (Array.isArray(data) && data.length === 0)) {
      log.warn(`No data found in config for ${locale || 'default'} locale, attempting fallback`);
      // Try to use default if it exists
      if (configData?.public?.default) {
        // eslint-disable-next-line no-param-reassign
        params.config = normalizeCommerceConfigKeys(configData.public.default);
      } else {
        log.warn(`Invalid config file ${configPath} format for ${locale || 'default'} locale`);
        throw new Error(`Invalid config file ${configPath} format for ${locale || 'default'} locale`);
      }
    } else if (data && Array.isArray(data)) {
      // eslint-disable-next-line no-param-reassign
      params.config = normalizeCommerceConfigKeys(
        data.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {}),
      );
    } else if (configData?.public?.default) {
      // eslint-disable-next-line no-param-reassign
      params.config = normalizeCommerceConfigKeys(configData.public.default);
    } else {
      log.warn(`Invalid config file ${configPath} format for ${locale || 'default'} locale`);
      throw new Error(`Invalid config file ${configPath} format for ${locale || 'default'} locale`);
    }
  } else {
    // eslint-disable-next-line no-param-reassign
    params.config = normalizeCommerceConfigKeys(params.config);
  }

  const { config } = params;
  const validationConfig = {
    ...config,
    'commerce-customer-group': hasText(config['commerce-customer-group'])
      ? config['commerce-customer-group']
      : 'optional',
    'commerce-x-api-key': hasText(config['commerce-x-api-key'])
      ? config['commerce-x-api-key']
      : 'optional',
  };
  validateConfig(validationConfig, localeLabel);

  const headers = {
    'Magento-Environment-Id': config['commerce-environment-id'],
    'Magento-Store-Code': config['commerce-store-code'],
    'Magento-Store-View-Code': config['commerce-store-view-code'],
    'Magento-Website-Code': config['commerce-website-code'],
  };
  if (hasText(config['commerce-customer-group'])) {
    headers['Magento-Customer-Group'] = config['commerce-customer-group'];
  }
  if (hasText(config['commerce-x-api-key'])) {
    headers['x-api-key'] = config['commerce-x-api-key'];
  }

  return {
    url: config['commerce-endpoint'],
    headers,
  };
}

/**
 * Extracts commerce configuration from ACCS instance type.
 * If params.config is not provided, fetches and validates config from remote JSON file.
 * If params.config is provided directly, it should already be in the final shape { url, headers }.
 * Handles nested structure with headers containing multiple scopes.
 *
 * Header handling:
 * - AC-Environment-Id: Can be used in config as a fallback source for Magento-Environment-Id
 * - Only Magento-Environment-Id is sent in actual request headers
 * - AC-View-ID: Sent if present in config
 *
 * Features:
 * - Generic scope support (cs, pdp, plp, etc.) via params.scope
 * - Path-based config matching (supports /en/, /en/us/, /products/, etc.)
 * - Empty config fallback to default
 * - Defensive validation with warnings
 * - Full config merge (preserves analytics, plugins, etc.)
 *
 * @param {Object} params - Configuration parameters.
 * @param {string} [params.scope='cs'] - Header scope to extract (e.g., 'cs', 'pdp', 'plp').
 * @param {Object} log - Logger instance.
 * @returns {Promise<Object>} Commerce config with url and headers.
 */
export async function extractCommerceConfigFromACCS(params, log) {
  if (!params.config) {
    const localePath = hasText(params.locale) ? `${params.locale}/` : '';
    const configPath = `${params.storeUrl}/${localePath}${params.configName || 'config'}.json`;
    log.debug(`Fetching ACCS config from ${configPath}`);

    const configSection = params.configSection || 'public';
    const locale = params.locale || 'default';
    const originalSection = configSection;
    const configData = params.configData
      || await requestSpreadsheet(configPath, params.configSheet);
    const isSectionValid = (section) => section && Object.keys(section).length > 0;

    let sectionData = configData[configSection];
    if (!isSectionValid(sectionData) && configSection !== 'public') {
      log.warn(`Config section "${configSection}" not found, attempting fallback to 'public'`);
      sectionData = configData.public;
    }

    if (!isSectionValid(sectionData)) {
      throw new Error(`Config section "${originalSection}" not found and no valid fallback available`);
    }
    const resolvedSection = sectionData === configData.public ? 'public' : configSection;

    // Use path-based matching instead of hardcoded locale key format
    const localeKey = findBestMatchingPath(sectionData, locale);

    // Get locale-specific data
    let localeData = sectionData[localeKey];

    // Fallback to default if locale-specific not found
    if (!localeData && localeKey !== 'default') {
      log.warn(`Locale config for "${localeKey}" not found, falling back to default`);
      localeData = sectionData.default;
    }

    // Fallback to default if locale config is empty
    if (!localeData || (typeof localeData === 'object' && Object.keys(localeData).length === 0)) {
      log.warn(`Locale config for "${localeKey}" is empty or missing, falling back to default`);
      localeData = sectionData.default;
    }

    if (!localeData) {
      throw new Error(`Locale data not found for "${localeKey}" in section "${resolvedSection}"`);
    }

    // Deep merge entire configs (not just headers) to preserve analytics, plugins, etc.
    const defaultConfig = sectionData.default || {};
    const mergedConfig = localeKey === 'default' ? defaultConfig : deepMerge(defaultConfig, localeData);
    const normalizedConfig = normalizeCommerceConfigKeys(mergedConfig);

    // Extract commerce endpoint from merged config
    const commerceEndpoint = normalizedConfig['commerce-endpoint'];

    // Extract headers using generic scope support
    const mergedHeaders = extractHeaders(sectionData, localeData, params.scope || 'cs');

    // Build return object directly from extracted values
    // Support both legacy Magento-* headers and new AC-* headers
    const headers = {};

    // Handle AC-Environment-Id as a fallback for Magento-Environment-Id.
    // AC-Environment-Id is only used as a source but NOT sent in the headers.
    // Only Magento-Environment-Id is sent in the actual request headers.
    const acEnvironmentId = mergedHeaders['AC-Environment-Id'];
    const magentoEnvironmentId = mergedHeaders['Magento-Environment-Id'];
    const resolvedEnvironmentId = magentoEnvironmentId || acEnvironmentId;
    if (resolvedEnvironmentId) {
      headers['Magento-Environment-Id'] = resolvedEnvironmentId;
    }

    // Add legacy Magento-* headers if present
    if (mergedHeaders['Magento-Customer-Group']) {
      headers['Magento-Customer-Group'] = mergedHeaders['Magento-Customer-Group'];
    }
    if (mergedHeaders['Magento-Store-Code']) {
      headers['Magento-Store-Code'] = mergedHeaders['Magento-Store-Code'];
    }
    if (mergedHeaders['Magento-Store-View-Code']) {
      headers['Magento-Store-View-Code'] = mergedHeaders['Magento-Store-View-Code'];
    }
    if (mergedHeaders['Magento-Website-Code']) {
      headers['Magento-Website-Code'] = mergedHeaders['Magento-Website-Code'];
    }
    if (mergedHeaders['x-api-key']) {
      headers['x-api-key'] = mergedHeaders['x-api-key'];
    }

    // Add AC-View-ID if present
    if (mergedHeaders['AC-View-ID']) {
      headers['AC-View-ID'] = mergedHeaders['AC-View-ID'];
    }

    const extractedConfig = {
      url: commerceEndpoint,
      headers,
    };

    // Validate the extracted config
    validateCommerceConfigShape(extractedConfig, locale);
    return extractedConfig;
  }

  // If config was provided directly, it should already be in the final shape { url, headers }
  validateCommerceConfigShape(params.config, params.locale || 'default');
  return params.config;
}

/**
 * Extracts commerce configuration from ACO (Adobe Commerce Optimizer) instance type.
 * ACO configs have the same structure as ACCS configs, so this function delegates to
 * extractCommerceConfigFromACCS with appropriate logging.
 *
 * @param {Object} params - Configuration parameters.
 * @param {string} [params.scope='cs'] - Header scope to extract (e.g., 'cs', 'pdp', 'plp').
 * @param {Object} log - Logger instance.
 * @returns {Promise<Object>} Commerce config with url and headers.
 */
export async function extractCommerceConfigFromACO(params, log) {
  log.debug('ACO instance type detected, using ACCS extraction logic');
  return extractCommerceConfigFromACCS(params, log);
}

/**
 * Retrieves and validates configuration for a given store and locale (PAAS only).
 * This is a legacy function used by sitemap-product-coverage and other PAAS integrations.
 * For new code, use extractCommerceConfigFromPAAS directly.
 * @param params - Parameters including store, locale, and config options.
 * @param log - Logger instance for debug output.
 * @returns {Promise<*>} - The validated configuration object.
 */
export async function getConfig(params, log) {
  const {
    configName = 'configs',
    configSheet,
    storeUrl,
    locale,
  } = params;

  if (!params.config) {
    const localePath = hasText(locale) ? `${locale}/` : '';
    const configPath = `${storeUrl}/${localePath}${configName}.json`;
    log.debug(`Fetching config ${configName} for ${params.contentUrl}`);
    const configData = await requestSpreadsheet(configPath, configSheet);

    let data;
    if (params.configSection) {
      data = configData[params.configSection].data;
    } else {
      data = configData.data;
    }

    if (data && Array.isArray(data)) {
      // eslint-disable-next-line no-param-reassign
      params.config = data.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {});
    } else if (configData?.public?.default) {
      // eslint-disable-next-line no-param-reassign
      params.config = configData.public.default;
    } else {
      log.warn(`Invalid config file ${configPath} format for ${locale || 'default'} locale`);
      throw new Error(`Invalid config file ${configPath} format for ${locale || 'default'} locale`);
    }
  }

  return validateConfig(params.config, locale);
}

/**
 * Sends a GraphQL request to the SaaS endpoint using store configuration.
 * @param query - GraphQL query string.
 * @param operationName - Name of the GraphQL operation.
 * @param variables - Variables for the GraphQL query.
 * @param params - Store and config parameters.
 * @param log - Logger instance.
 * @returns {Promise<*>} - The GraphQL response.
 */
export async function requestSaaS(query, operationName, variables, params, log) {
  const { storeUrl } = params;
  const config = await getConfig(params, log);
  const headers = {
    'Content-Type': 'application/json',
    origin: storeUrl,
    'magento-customer-group': config['commerce-customer-group'],
    'magento-environment-id': config['commerce-environment-id'],
    'magento-store-code': config['commerce-store-code'],
    'magento-store-view-code': config['commerce-store-view-code'],
    'magento-website-code': config['commerce-website-code'],
    'x-api-key': config['commerce-x-api-key'],
    // bypass LiveSearch cache
    'Magento-Is-Preview': true,
  };
  const method = 'POST';

  const response = await request(
    `${operationName}(${JSON.stringify(variables)})`,
    config['commerce-endpoint'],
    {
      method,
      headers,
      body: JSON.stringify({
        operationName,
        query,
        variables,
      }),
    },
  );

  // Log GraphQL errors
  if (response?.errors) {
    const errorMessages = response.errors.map((error) => error.message).join(', ');
    throw new Error(`GraphQL operation '${operationName}' failed: ${errorMessages}`);
  }

  if (typeof response === 'string') {
    return JSON.parse(response);
  }

  return response;
}

/**
 * Retrieves commerce configuration for a site from handler config or remote config.
 * Supports multiple instance types: PAAS, ACCS, ACO.
 * Instance is determined by the instanceType field in the handler config.
 * When configName is not explicitly set, optional fallbacks can be attempted
 * (configs/config/global) without changing behavior when the default works.
 * @param {Object} site - The site object with configuration.
 * @param {string} auditType - The audit type to get handler config for.
 * @param {string} finalUrl - The site URL.
 * @param {Object} log - Logger instance.
 * @param {string} locale - Optional locale (defaults to empty string for 'default').
 * @returns {Promise<{
 *   url: string,
 *   headers: {
 *     'Magento-Customer-Group'?: string,
 *     'Magento-Environment-Id'?: string,
 *     'Magento-Store-Code'?: string,
 *     'Magento-Store-View-Code'?: string,
 *     'Magento-Website-Code'?: string,
 *     'x-api-key'?: string,
 *     'AC-View-ID'?: string,
 *   }
 * }>} Commerce configuration with url and headers.
 * For PAAS: Returns legacy Magento-* headers.
 * For ACCS/ACO: Returns Magento-Environment-Id (required) + optional AC-View-ID.
 * Note: AC-Environment-Id is used as fallback source but not sent in headers.
 */
export async function getCommerceConfig(site, auditType, finalUrl, log, locale = '') {
  try {
    // Setup: extract config and determine instance type
    const customConfig = site.getConfig()?.getHandlers()?.[auditType];
    const instanceType = customConfig?.instanceType || 'PAAS'; // Default to PAAS

    const params = {
      storeUrl: finalUrl,
      locale: locale === 'default' ? '' : locale,
      configName: customConfig?.configName,
      configSection: customConfig?.configSection,
      configSheet: customConfig?.configSheet,
      config: customConfig?.config?.[locale] || customConfig?.config,
    };

    log.info(`Fetching commerce config for site: ${site.getId()}, locale: ${locale || 'default'}, instanceType: ${instanceType}`);

    const hasExplicitConfigName = Boolean(params.config)
      || (customConfig && Object.prototype.hasOwnProperty.call(customConfig, 'configName'));
    const isAccsFamily = instanceType === 'ACCS' || instanceType === 'ACO';
    const defaultConfigName = isAccsFamily ? 'config' : 'configs';
    const fallbackNames = isAccsFamily
      ? ['configs', 'global']
      : ['config', 'global'];
    const configNameCandidates = hasExplicitConfigName
      ? [params.configName]
      : [defaultConfigName, ...fallbackNames]
        .filter((name, index, list) => name && list.indexOf(name) === index);

    const [firstConfigName, secondConfigName, thirdConfigName] = configNameCandidates;
    let primaryError;

    const scoreConfig = (config) => {
      if (!config) {
        return -1;
      }
      let score = 0;
      if (hasText(config.url)) {
        score += 1;
      }
      if (config.headers && typeof config.headers === 'object') {
        for (const value of Object.values(config.headers)) {
          if (hasText(value)) {
            score += 1;
          }
        }
      }
      return score;
    };

    let bestFallbackConfig = null;
    let bestFallbackScore = scoreConfig(bestFallbackConfig);

    const considerFallbackConfig = (config) => {
      const score = scoreConfig(config);
      if (score > bestFallbackScore) {
        bestFallbackScore = score;
        bestFallbackConfig = config;
      }
    };

    const attemptFirstParams = { ...params, configName: firstConfigName };
    try {
      let config;
      if (instanceType === 'ACCS') {
        config = await extractCommerceConfigFromACCS(attemptFirstParams, log);
      } else if (instanceType === 'ACO') {
        config = await extractCommerceConfigFromACO(attemptFirstParams, log);
      } else {
        config = await extractCommerceConfigFromPAAS(attemptFirstParams, log);
      }
      log.info('Successfully retrieved commerce config');
      return config;
    } catch (error) {
      primaryError = error;
      if (hasExplicitConfigName) {
        throw error;
      }
      log.debug(`Commerce config extraction failed for "${firstConfigName}": ${error.message}`);
    }

    if (secondConfigName) {
      const attemptSecondParams = { ...params, configName: secondConfigName };
      try {
        let config;
        if (instanceType === 'ACCS') {
          config = await extractCommerceConfigFromACCS(attemptSecondParams, log);
        } else if (instanceType === 'ACO') {
          config = await extractCommerceConfigFromACO(attemptSecondParams, log);
        } else {
          config = await extractCommerceConfigFromPAAS(attemptSecondParams, log);
        }
        considerFallbackConfig(config);
      } catch (error) {
        log.debug(`Commerce config extraction failed for "${secondConfigName}": ${error.message}`);
      }
    }

    if (thirdConfigName) {
      const attemptThirdParams = { ...params, configName: thirdConfigName };
      try {
        let config;
        if (instanceType === 'ACCS') {
          config = await extractCommerceConfigFromACCS(attemptThirdParams, log);
        } else if (instanceType === 'ACO') {
          config = await extractCommerceConfigFromACO(attemptThirdParams, log);
        } else {
          config = await extractCommerceConfigFromPAAS(attemptThirdParams, log);
        }
        considerFallbackConfig(config);
      } catch (error) {
        log.debug(`Commerce config extraction failed for "${thirdConfigName}": ${error.message}`);
      }
    }

    if (bestFallbackConfig) {
      log.info('Successfully retrieved commerce config');
      return bestFallbackConfig;
    }

    throw primaryError;
  } catch (error) {
    log.error(`Error fetching commerce config for site ${site.getId()}:`, error);
    throw error;
  }
}

// Re-export config utilities for backward compatibility
export {
  deepMerge,
  deepMergeAll,
  isMultiLocaleConfig,
  getAvailablePaths,
  isLocaleSupported,
  validateLocales,
  getConfigForPath,
  getLocaleDebugInfo,
} from './config-utils.js';

export { findBestMatchingPath } from './url-utils.js';
