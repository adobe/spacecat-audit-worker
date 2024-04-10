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

import { isValidUrl } from '@adobe/spacecat-shared-utils';
import { fetch } from './utils.js';

const getLimit = (limit, upperLimit) => Math.min(limit, upperLimit);

export default class AhrefsAPIClient {
  static createFrom(context) {
    const { AHREFS_API_BASE_URL: apiBaseUrl, AHREFS_API_KEY: apiKey } = context.env;
    return new AhrefsAPIClient({ apiBaseUrl, apiKey }, context.log);
  }

  constructor(config, log = console) {
    const { apiKey, apiBaseUrl } = config;

    if (!isValidUrl(apiBaseUrl)) {
      throw new Error(`Invalid Ahrefs API Base URL: ${apiBaseUrl}`);
    }

    this.apiBaseUrl = apiBaseUrl;
    this.apiKey = apiKey;
    this.log = log;
  }

  async sendRequest(endpoint, queryParams = {}) {
    const queryParamsKeys = Object.keys(queryParams);
    const queryString = queryParamsKeys.length > 0
      ? `?${queryParamsKeys
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
        .join('&')}` : '';

    const fullAuditRef = `${this.apiBaseUrl}${endpoint}${queryString}`;
    const response = await fetch(fullAuditRef, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    this.log.info(`Ahrefs API ${endpoint} response has number of rows: ${response.headers.get('x-api-rows')}, 
      cost per row: ${response.headers.get('x-api-units-cost-row')},
      total cost: ${response.headers.get('x-api-units-cost-total-actual')}`);

    if (!response.ok) {
      this.log.error(`Ahrefs API request failed with status: ${response.status}`);
      throw new Error(`Ahrefs API request failed with status: ${response.status}`);
    }

    try {
      const result = await response.json();
      return {
        result,
        fullAuditRef,
      };
    } catch (e) {
      this.log.error(`Error parsing Ahrefs API response: ${e.message}`);
      throw new Error(`Error parsing Ahrefs API response: ${e.message}`);
    }
  }

  async getBrokenBacklinks(url, limit = 50) {
    const filter = {
      and: [
        { field: 'is_dofollow', is: ['eq', 1] },
        { field: 'is_content', is: ['eq', 1] },
        { field: 'domain_rating_source', is: ['gte', 29.5] },
        { field: 'traffic_domain', is: ['gte', 500] },
        { field: 'links_external', is: ['lte', 300] },
      ],
    };

    const queryParams = {
      select: [
        'title',
        'url_from',
        'url_to',
      ].join(','),
      limit: getLimit(limit, 100),
      mode: 'prefix',
      order_by: 'domain_rating_source:desc,traffic_domain:desc',
      target: url,
      output: 'json',
      where: JSON.stringify(filter),
    };

    return this.sendRequest('/site-explorer/broken-backlinks', queryParams);
  }
}
