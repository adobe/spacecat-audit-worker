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
    if (!config[field]) {
      missingFields.push(`Missing required parameter: ${field}`);
    }
  }

  if (missingFields.length > 0) {
    throw new Error(`Missing required config parameters for ${locale} locale: ${missingFields.join(', ')}`);
  }

  return config;
}

/**
 * Validates the commerce config return shape.
 * Checks for url and all required headers.
 * @param {Object} config - The config object with url and headers.
 * @param {string} locale - Locale identifier.
 * @throws {Error} If required fields are missing.
 */
function validateCommerceConfigShape(config, locale) {
  const missingFields = [];

  if (!config.url) {
    missingFields.push('url');
  }

  if (!config.headers) {
    missingFields.push('headers');
  } else {
    const requiredHeaders = [
      'Magento-Customer-Group',
      'Magento-Environment-Id',
      'Magento-Store-Code',
      'Magento-Store-View-Code',
      'Magento-Website-Code',
      'x-api-key',
    ];

    for (const field of requiredHeaders) {
      if (!config.headers[field]) {
        missingFields.push(`headers.${field}`);
      }
    }
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

  if (!params.config) {
    const localePath = locale ? `${locale}/` : '';
    const configPath = `${storeUrl}/${localePath}${configName}.json`;
    log.debug(`Fetching PAAS config from ${configPath}`);
    const configData = await requestSpreadsheet(configPath, configSheet);

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
        params.config = configData.public.default;
      } else {
        log.warn(`Invalid config file ${configPath} format for ${locale || 'default'} locale`);
        throw new Error(`Invalid config file ${configPath} format for ${locale || 'default'} locale`);
      }
    } else if (data && Array.isArray(data)) {
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

  const config = validateConfig(params.config, locale);

  return {
    url: config['commerce-endpoint'],
    headers: {
      'Magento-Customer-Group': config['commerce-customer-group'],
      'Magento-Environment-Id': config['commerce-environment-id'],
      'Magento-Store-Code': config['commerce-store-code'],
      'Magento-Store-View-Code': config['commerce-store-view-code'],
      'Magento-Website-Code': config['commerce-website-code'],
      'x-api-key': config['commerce-x-api-key'],
    },
  };
}

/**
 * Extracts commerce configuration from ACCS instance type.
 * If params.config is not provided, fetches and validates config from remote JSON file.
 * If params.config is provided directly, it should already be in the final shape { url, headers }.
 * Handles nested structure with headers containing multiple scopes.
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
    const localePath = params.locale ? `${params.locale}/` : '';
    const configPath = `${params.storeUrl}/${localePath}${params.configName || 'config'}.json`;
    log.debug(`Fetching ACCS config from ${configPath}`);

    const configData = await requestSpreadsheet(configPath, params.configSheet);
    const configSection = params.configSection || 'public';
    const locale = params.locale || 'default';

    // Navigate to the section (e.g., "public") with defensive validation
    const sectionData = configData[configSection];
    if (!sectionData) {
      log.warn(`Config section "${configSection}" not found, attempting fallback to 'public'`);
      const fallbackSection = configData.public || { default: {} };
      if (!fallbackSection || !fallbackSection.default) {
        throw new Error(`Config section "${configSection}" not found and no valid fallback available`);
      }
      return extractCommerceConfigFromACCS({ ...params, configSection: 'public' }, log);
    }

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
      throw new Error(`Locale data not found for "${localeKey}" in section "${configSection}"`);
    }

    // Deep merge entire configs (not just headers) to preserve analytics, plugins, etc.
    const defaultConfig = sectionData.default || {};
    const mergedConfig = localeKey === 'default' ? defaultConfig : deepMerge(defaultConfig, localeData);

    // Extract commerce endpoint from merged config
    const commerceEndpoint = mergedConfig['commerce-endpoint'];

    // Extract headers using generic scope support
    const mergedHeaders = extractHeaders(sectionData, localeData, params.scope || 'cs');

    // Build return object directly from extracted values
    const extractedConfig = {
      url: commerceEndpoint,
      headers: {
        'Magento-Customer-Group': mergedHeaders['Magento-Customer-Group'],
        'Magento-Environment-Id': mergedHeaders['Magento-Environment-Id'],
        'Magento-Store-Code': mergedHeaders['Magento-Store-Code'],
        'Magento-Store-View-Code': mergedHeaders['Magento-Store-View-Code'],
        'Magento-Website-Code': mergedHeaders['Magento-Website-Code'],
        'x-api-key': mergedHeaders['x-api-key'],
      },
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
    const localePath = locale ? `${locale}/` : '';
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
 * @param {Object} site - The site object with configuration.
 * @param {string} auditType - The audit type to get handler config for.
 * @param {string} finalUrl - The site URL.
 * @param {Object} log - Logger instance.
 * @param {string} locale - Optional locale (defaults to empty string for 'default').
 * @returns {Promise<{
 *   url: string,
 *   headers: {
 *     'Magento-Customer-Group': string,
 *     'Magento-Environment-Id': string,
 *     'Magento-Store-Code': string,
 *     'Magento-Store-View-Code': string,
 *     'Magento-Website-Code': string,
 *     'x-api-key': string
 *   }
 * }>} Commerce configuration with url and headers.
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
      instanceType,
      config: customConfig?.config?.[locale] || customConfig?.config,
    };

    log.info(`Fetching commerce config for site: ${site.getId()}, locale: ${locale || 'default'}, instanceType: ${instanceType}`);

    // Extract and format config based on instance type
    switch (instanceType) {
      case 'ACCS':
        log.info('Successfully retrieved commerce config');
        return extractCommerceConfigFromACCS(params, log);

      case 'ACO':
        // Not implemented yet
        throw new Error('ACO instance type not yet implemented');

      case 'PAAS':
      default:
        log.info('Successfully retrieved commerce config');
        return extractCommerceConfigFromPAAS(params, log);
    }
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
