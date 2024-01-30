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

export default class AhrefsAPIClient {
  static createFrom(context) {
    const { AHREFS_API_BASE_URL: apiBaseUrl, AHREFS_API_KEY: apiKey } = context.env;
    return new AhrefsAPIClient({ apiBaseUrl, apiKey });
  }

  constructor(config) {
    const { apiKey, apiBaseUrl } = config;

    if (!isValidUrl(apiBaseUrl)) {
      throw new Error(`Invalid Ahrefs API Base URL: ${apiBaseUrl}`);
    }

    this.apiBaseUrl = apiBaseUrl;
    this.apiKey = apiKey;
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

    if (!response.ok) {
      const result = await response.json();
      throw new Error(`Ahrefs API request failed with status: ${response.status}. Reason: ${result.error}`);
    }

    try {
      const result = await response.json();
      return {
        result,
        fullAuditRef,
      };
    } catch (e) {
      throw new Error(`Error parsing Ahrefs API response: ${e.message}`);
    }
  }

  async getBrokenBacklinks(url) {
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
      limit: 50,
      mode: 'prefix',
      order_by: 'domain_rating_source:desc,traffic_domain:desc',
      target: url,
      output: 'json',
      where: JSON.stringify(filter),
    };

    return this.sendRequest('/site-explorer/broken-backlinks', queryParams);
  }

  async getOrganicKeywords(site, log) {
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');

      return `${year}-${month}-${day}`;
    };
    const today = new Date();

    const config = site.getConfig();
    const siteConfig = config?.alerts?.find((alert) => alert.type === 'organic-keywords') || {
      country: 'us',
      select: [
        'keyword',
        'best_position',
        'best_position_prev',
        'best_position_diff',
        'sum_traffic',
      ],
      limit: 15,
      order_by: 'sum_traffic',
    };

    const queryParams = {
      country: siteConfig.country,
      limit: siteConfig.limit,
      date: formatDate(today),
      date_compared: formatDate(new Date(today.setMonth(today.getMonth() - 1))),
      target: site.getBaseURL(),
      output: 'json',
      order_by: siteConfig.order_by,
      mode: 'prefix',
      select: siteConfig.select,
    };

    log.info(`Sending request to Ahrefs API with query params: ${JSON.stringify(queryParams)}}`);

    return this.sendRequest('/site-explorer/organic-keywords', queryParams);
  }
}
