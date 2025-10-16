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
 * Validates the required fields in the config object for a given locale.
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
 * Retrieves and validates configuration for a given store and locale.
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
 * @param {Object} site - The site object with configuration.
 * @param {string} auditType - The audit type to get handler config for.
 * @param {string} finalUrl - The site URL.
 * @param {Object} log - Logger instance.
 * @param {string} locale - Optional locale (defaults to empty string for 'default').
 * @returns {Promise<Object>} Commerce configuration with environment-id,
 * store-view-code, website-code.
 */
export async function getCommerceConfig(site, auditType, finalUrl, log, locale = '') {
  try {
    // Get custom config from site configuration (similar to sitemap-product-coverage)
    // Examples:
    // {
    //   "handlers": {
    //     "product-metatags": {
    //       // Option 1: Direct config (inline)
    //       "config": {
    //         "commerce-environment-id": "your-env-id",
    //         "commerce-store-view-code": "default",
    //         "commerce-website-code": "base",
    //         "commerce-store-code": "default",
    //         "commerce-customer-group": "0",
    //         "commerce-x-api-key": "your-api-key",
    //         "commerce-endpoint": "https://commerce.adobe.io/graphql"
    //       }
    //     }
    //   }
    // }

    // {
    //   "handlers": {
    //     "product-metatags": {
    //       // Option 2: Remote config (like sitemap-product-coverage)
    //       "configSection": "stage", // Section within that JSON (you're using "prod")
    //       "configName": "configs", // Name of the JSON file (defaults to configs)
    //       "configSheet": "commerce" // Optional - for Google Sheets tabs/sheets
    //     }
    //   }
    // }
    const customConfig = site.getConfig()?.getHandlers()?.[auditType];

    // Build params object for getConfig
    const params = {
      storeUrl: finalUrl,
      locale: locale === 'default' ? '' : locale,
      configName: customConfig?.configName,
      configSection: customConfig?.configSection,
      configSheet: customConfig?.configSheet,
      config: customConfig?.config?.[locale] || customConfig?.config,
    };

    log.info(`Fetching commerce config for site: ${site.getId()}, locale: ${locale || 'default'}`);

    // Get and validate config - this will have all commerce-* fields
    const config = await getConfig(params, log);

    log.info('Successfully retrieved commerce config');
    log.debug('Commerce config keys:', Object.keys(config));

    return {
      environmentId: config['commerce-environment-id'],
      storeViewCode: config['commerce-store-view-code'],
      websiteCode: config['commerce-website-code'],
      storeCode: config['commerce-store-code'],
      customerGroup: config['commerce-customer-group'],
      apiKey: config['commerce-x-api-key'],
      endpoint: config['commerce-endpoint'],
    };
  } catch (error) {
    log.error(`Error fetching commerce config for site ${site.getId()}:`, error);
    throw error;
  }
}
