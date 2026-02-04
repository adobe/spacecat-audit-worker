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

/* eslint-disable max-classes-per-file */

/**
 * Store Client - Utility for fetching data from URL Store and Guidelines Store
 *
 * API Endpoints (from spacecat-api-service):
 * - URL Store: GET /sites/{siteId}/url-store/by-audit/{auditType}
 * - Sentiment Config: GET /sites/{siteId}/sentiment/config?audit={auditType}
 *
 * Note: Content Store is called directly by Mystique (not from audit worker)
 * because content can exceed SQS message size limits (256KB).
 *
 * The stores provide:
 * - urlStore: URLs discovered during brand presence analysis (Wikipedia, Reddit, YouTube, etc.)
 * - guidelinesStore: Analysis guidelines and topics for different audit types
 */

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

/**
 * Error thrown when a store returns empty results
 */
export class StoreEmptyError extends Error {
  constructor(storeName, siteId, details = '') {
    const msg = `${storeName} returned empty results for siteId: ${siteId}`;
    super(details ? `${msg}. ${details}` : msg);
    this.name = 'StoreEmptyError';
    this.storeName = storeName;
    this.siteId = siteId;
  }
}

/**
 * Audit types for URL Store queries (maps to audit types in url-store)
 * Used as {auditType} path parameter in /sites/{siteId}/url-store/by-audit/{auditType}
 */
export const URL_TYPES = {
  WIKIPEDIA: 'wikipedia-analysis',
  REDDIT: 'reddit-analysis',
  YOUTUBE: 'youtube-analysis',
};

/**
 * Audit types for guidelines queries
 * These are used as the ?audit= query parameter in /sites/{siteId}/sentiment/config
 */
export const GUIDELINE_TYPES = {
  WIKIPEDIA_ANALYSIS: 'wikipedia-analysis',
  REDDIT_ANALYSIS: 'reddit-analysis',
  YOUTUBE_ANALYSIS: 'youtube-analysis',
};

/**
 * Store Client class for accessing URL, Content, and Guidelines stores
 * Uses spacecat-api-service endpoints
 */
export default class StoreClient {
  /**
   * Creates a StoreClient from the Lambda context
   * @param {Object} context - The Lambda context
   * @param {Object} context.env - Environment variables
   * @param {Object} context.log - Logger instance
   * @returns {StoreClient} - StoreClient instance
   */
  static createFrom(context) {
    const {
      SPACECAT_API_BASE_URL: apiBaseUrl,
      SPACECAT_API_KEY: apiKey,
    } = context.env || {};

    return new StoreClient({ apiBaseUrl, apiKey }, fetch, context.log);
  }

  /**
   * @param {Object} config - Configuration object
   * @param {string} config.apiBaseUrl - Base URL for spacecat-api-service
   * @param {string} [config.apiKey] - API key for authentication
   * @param {Function} fetchAPI - Fetch function
   * @param {Object} log - Logger instance
   */
  constructor(config, fetchAPI, log = console) {
    const { apiBaseUrl, apiKey } = config;

    this.apiBaseUrl = apiBaseUrl;
    this.apiKey = apiKey;
    this.fetchAPI = fetchAPI;
    this.log = log;
  }

  /**
   * Builds headers for API requests
   * @returns {Object} Headers object
   * @private
   */
  #buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add authorization header if API key is configured
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Sends a GET request to the store API
   * @param {string} endpoint - API endpoint
   * @param {Object} queryParams - Query parameters
   * @returns {Promise<Object>} Response data
   * @private
   */
  async #sendRequest(endpoint, queryParams = {}) {
    const queryString = Object.entries(queryParams)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    const url = `${this.apiBaseUrl}${endpoint}${queryString ? `?${queryString}` : ''}`;

    this.log.debug(`[StoreClient] Requesting: ${url}`);

    const response = await this.fetchAPI(url, {
      method: 'GET',
      headers: this.#buildHeaders(),
    });

    if (!response.ok) {
      const errorMessage = `Store API request failed: ${response.status} ${response.statusText}`;
      this.log.error(`[StoreClient] ${errorMessage}`);
      throw new Error(errorMessage);
    }

    return response.json();
  }

  /**
   * Fetches all pages of a paginated endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} queryParams - Query parameters
   * @returns {Promise<Array>} All items from all pages
   * @private
   */
  async #fetchAllPages(endpoint, queryParams = {}) {
    const allItems = [];
    let cursor = null;

    do {
      const params = { ...queryParams, limit: 500 };
      if (cursor) {
        params.cursor = cursor;
      }

      // eslint-disable-next-line no-await-in-loop
      const result = await this.#sendRequest(endpoint, params);
      const items = result?.items || [];
      allItems.push(...items);

      cursor = result?.pagination?.cursor || null;
    } while (cursor);

    return allItems;
  }

  /**
   * Fetches URLs from the URL Store for a given site and audit type
   * Uses: GET /sites/{siteId}/url-store/by-audit/{auditType}
   *
   * @param {string} siteId - The site ID
   * @param {string} auditType - The audit type (e.g., 'wikipedia-analysis', 'reddit-analysis')
   * @returns {Promise<Array<Object>>} Array of URL objects
   * @throws {StoreEmptyError} If no URLs are found
   */
  async getUrls(siteId, auditType) {
    this.log.info(`[StoreClient] Fetching ${auditType} URLs for siteId: ${siteId}`);

    const urls = await this.#fetchAllPages(`/sites/${siteId}/url-store/by-audit/${auditType}`);

    if (urls.length === 0) {
      throw new StoreEmptyError('urlStore', siteId, `No ${auditType} URLs found`);
    }

    this.log.info(`[StoreClient] Found ${urls.length} ${auditType} URLs for siteId: ${siteId}`);
    return urls;
  }

  /**
   * Fetches sentiment config (topics and guidelines) for a site and audit type
   * Uses: GET /sites/{siteId}/sentiment/config?audit={auditType}
   *
   * @param {string} siteId - The site ID
   * @param {string} auditType - The audit type to filter guidelines (e.g., 'wikipedia-analysis')
   * @returns {Promise<Object>} Config object with topics and guidelines arrays
   * @throws {StoreEmptyError} If no guidelines are found
   */
  async getGuidelines(siteId, auditType) {
    this.log.info(`[StoreClient] Fetching sentiment config for siteId: ${siteId}, audit: ${auditType}`);

    const result = await this.#sendRequest(`/sites/${siteId}/sentiment/config`, { audit: auditType });

    const { topics = [], guidelines = [] } = result || {};

    if (guidelines.length === 0) {
      throw new StoreEmptyError('guidelinesStore', siteId, `No guidelines found for audit type: ${auditType}`);
    }

    this.log.info(`[StoreClient] Found ${topics.length} topics and ${guidelines.length} guidelines for siteId: ${siteId}`);
    return { topics, guidelines };
  }
}
