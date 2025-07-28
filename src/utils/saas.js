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

export async function request(name, url, req = [], timeout = 60000) {
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) { /* nothing to be done */ }
  }

  throw new Error(`Request '${name}' to '${url}' failed (${resp.status}): ${resp.headers.get('x-error') || resp.statusText}${responseText.length > 0 ? ` responseText: ${responseText}` : ''}`);
}

export async function requestSpreadsheet(configPath, sheet) {
  return request(
    'spreadsheet',
    configPath + (sheet ? `?sheet=${sheet}` : ''),
  );
}

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

    if (data) {
      // eslint-disable-next-line no-param-reassign
      params.config = data.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {});
    } else {
      // Handle case where configData.public.default is an object
      // eslint-disable-next-line no-param-reassign
      params.config = data.public.default;
    }
  }
  return params.config;
}

export async function requestSaaS(query, operationName, variables, params, log) {
  const { storeUrl, configOverrides = {} } = params;
  const config = {
    ...(await getConfig(params, log)),
    ...configOverrides,
  };
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
    for (const error of response.errors) {
      log.error(`Request '${operationName}' returned GraphQL error`, error);
    }
  }

  if (typeof response === 'string') {
    return JSON.parse(response);
  }

  return response;
}
