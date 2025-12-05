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

import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

/**
 * Client for interacting with Adobe Experience Manager (AEM) Sites API
 * @see https://developer.adobe.com/experience-cloud/experience-manager-apis/api/stable/sites/
 */
export class AemClient {
  static API_SITES_BASE = '/adobe/sites';

  static API_SITES_FRAGMENTS = `${AemClient.API_SITES_BASE}/cf/fragments`;

  constructor(baseUrl, imsClient, log = console) {
    if (!baseUrl) {
      throw new Error('baseUrl is required for AEM client');
    }

    if (!imsClient) {
      throw new Error('imsClient is required for AEM client');
    }

    this.baseUrl = baseUrl;
    this.imsClient = imsClient;
    this.accessToken = null;
    this.tokenObtainedAt = null;
    this.log = log;
  }

  /**
   * Factory method to create an AemClient from context
   * @param {Object} context - The audit context
   * @param {Object} context.site - The site object
   * @param {Object} context.env - Environment variables
   * @param {Object} context.log - Logger instance
   * @returns {Promise<AemClient>}
   */
  static async createFrom(context) {
    const { site, env, log } = context;

    const authorUrl = site.getDeliveryConfig().authorURL;
    if (!authorUrl) {
      throw new Error('AEM Author configuration missing: AEM Author URL required');
    }

    const imsClient = ImsClient.createFrom({
      log,
      env: {
        IMS_HOST: env.IMS_HOST,
        IMS_CLIENT_ID: env.IMS_CLIENT_ID,
        IMS_CLIENT_CODE: env.IMS_CLIENT_CODE,
        IMS_CLIENT_SECRET: env.IMS_CLIENT_SECRET,
        IMS_SCOPE: env.IMS_SCOPE,
      },
    });

    return new AemClient(authorUrl, imsClient, log);
  }

  /**
   * Gets a valid service access token, fetching a new one if expired or missing.
   * @returns {Promise<string>} The access token string
   */
  async getAccessToken() {
    if (this.isTokenExpired()) {
      this.accessToken = await this.imsClient.getServiceAccessToken();
      this.tokenObtainedAt = Date.now();
    }
    return this.accessToken.access_token;
  }

  /**
   * Checks if the current access token is expired.
   * @returns {boolean} True if the access token is expired, false otherwise.
   */
  isTokenExpired() {
    if (!this.accessToken || !this.tokenObtainedAt) {
      this.invalidateAccessToken();
      return true;
    }

    const expiresAt = this.tokenObtainedAt + (this.accessToken.expires_in * 1000);
    const isExpired = Date.now() >= expiresAt;
    if (isExpired) {
      this.invalidateAccessToken();
    }

    return isExpired;
  }

  /**
   * Invalidates the current access token, forcing a refresh on next request.
   */
  invalidateAccessToken() {
    this.accessToken = null;
    this.tokenObtainedAt = null;
  }

  /**
   * Generic request method for AEM API calls
   * @private
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {Object} options - Additional fetch options
   * @returns {Promise<Object|null>}
   */
  async request(method, path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...options.headers,
    };

    this.log.debug(`[AEM Client] ${method} ${url}`);

    const response = await fetch(url, {
      method,
      headers,
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[AEM Client] Request failed with status ${response.status}: ${errorText}`);
    }

    // Handle non-empty responses
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }

    return null;
  }

  /**
   * List all content fragments
   * @see https://developer.adobe.com/experience-cloud/experience-manager-apis/api/stable/sites/#operation/fragments/getFragments
   *
   * @param {string} path - The path to search for content fragments
   * @param {Object} options - Query options
   * @param {string} [options.cursor] - Pagination cursor
   * @param {string} [options.projection='minimal'] - Response projection (minimal, full)
   * @param {number} [options.limit] - Maximum items per page
   * @returns {Promise<{items: Array, cursor: string|null}>}
   */
  async getFragments(path, options = {}) {
    const {
      cursor = null,
      projection = 'minimal',
      limit,
    } = options;

    const params = new URLSearchParams({
      path,
      projection,
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    if (limit) {
      params.set('limit', limit.toString());
    }

    const queryPath = `${AemClient.API_SITES_FRAGMENTS}?${params.toString()}`;

    try {
      const data = await this.request('GET', queryPath);

      return {
        items: data?.items || [],
        cursor: data?.cursor || null,
      };
    } catch (error) {
      throw new Error(`[AEM Client] Failed to fetch fragments from ${path}: ${error.message}`);
    }
  }
}
