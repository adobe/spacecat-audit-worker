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

import { API_BASE_URL } from '../opportunities/config.js';

/**
 * SpaceCat API Client for interacting with Fix Entity endpoints
 */
class SpaceCatClient {
  constructor(apiKey, baseUrl = API_BASE_URL) {
    if (!apiKey) {
      throw new Error('SpaceCat API key is required. Please set SPACECAT_API_KEY environment variable.');
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Make an authenticated request to the SpaceCat API with retry logic
   * @param {string} url - Full URL to request
   * @param {object} options - Fetch options
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Promise<Response>}
   */
  async fetchWithRetry(url, options, maxRetries = 3) {
    let attempt = 1;
    /* eslint-disable no-await-in-loop */
    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            ...options.headers,
          },
        });

        if (response.ok) {
          return response;
        }

        // Handle specific error codes
        if (response.status === 404) {
          const error = new Error('Resource not found');
          error.status = 404;
          error.response = response;
          throw error;
        }

        if (response.status === 400) {
          const errorBody = await response.json().catch(() => ({ message: 'Bad request' }));
          const error = new Error(`Bad request: ${errorBody.message || response.statusText}`);
          error.status = 400;
          error.response = response;
          throw error;
        }

        // Retry on 5xx errors and 429 (rate limit)
        const isRetryable = response.status >= 500 || response.status === 429;
        if (isRetryable && attempt < maxRetries) {
          // Exponential backoff, max 10s
          const delay = Math.min(1000 * (2 ** (attempt - 1)), 10000);
          await new Promise((resolve) => {
            setTimeout(resolve, delay);
          });
          attempt += 1;
          // eslint-disable-next-line no-continue
          continue;
        }

        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.response = response;
        throw error;
      } catch (error) {
        if (attempt === maxRetries || error.status === 404 || error.status === 400) {
          throw error;
        }
        // Retry on network errors
        const delay = Math.min(1000 * (2 ** (attempt - 1)), 10000);
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
      }
      attempt += 1;
    }
    /* eslint-enable no-await-in-loop */
    throw new Error(`Failed to fetch after ${maxRetries} attempts`);
  }

  /**
   * Create fix entities for an opportunity
   * POST /api/v1/sites/{siteId}/opportunities/{opportunityId}/fixes
   *
   * @param {string} siteId - Site UUID
   * @param {string} opportunityId - Opportunity UUID
   * @param {Array<object>} fixes - Array of fix objects
   * @param {string} fixes[].type - Fix type
   *  (REDIRECT_UPDATE, EXPERIMENT, CONTENT_UPDATE, METADATA_UPDATE)
   * @param {object} fixes[].changeDetails - Details of the change
   * @param {string} [fixes[].status] - Fix status
   *  (PENDING, DEPLOYED, PUBLISHED, FAILED, ROLLED_BACK)
   * @param {Array<string>} [fixes[].suggestionIds] - Array of suggestion IDs to associate
   * @returns {Promise<object>} Created fix entities
   */
  async createFixEntities(siteId, opportunityId, fixes) {
    if (!siteId || !opportunityId) {
      throw new Error('siteId and opportunityId are required');
    }

    if (!Array.isArray(fixes) || fixes.length === 0) {
      throw new Error('fixes must be a non-empty array');
    }

    // Validate fix objects
    fixes.forEach((fix, index) => {
      if (!fix.type) {
        throw new Error(`Fix at index ${index} is missing required field: type`);
      }
      if (!fix.changeDetails) {
        throw new Error(`Fix at index ${index} is missing required field: changeDetails`);
      }
    });

    const url = `${this.baseUrl}/sites/${siteId}/opportunities/${opportunityId}/fixes`;

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      body: JSON.stringify(fixes),
    });

    return response.json();
  }

  /**
   * Create a single fix entity for an opportunity
   *
   * @param {string} siteId - Site UUID
   * @param {string} opportunityId - Opportunity UUID
   * @param {object} fix - Fix object
   * @returns {Promise<object>} Created fix entity
   */
  async createFixEntity(siteId, opportunityId, fix) {
    return this.createFixEntities(siteId, opportunityId, [fix]);
  }
}

/**
 * Create a SpaceCat API client instance
 * @param {string} [apiKey] - API key (defaults to SPACECAT_API_KEY env var)
 * @param {string} [baseUrl] - Base URL (defaults to config)
 * @returns {SpaceCatClient}
 */
export function createClient(apiKey = process.env.SPACECAT_API_KEY, baseUrl = API_BASE_URL) {
  return new SpaceCatClient(apiKey, baseUrl);
}

export default createClient;
