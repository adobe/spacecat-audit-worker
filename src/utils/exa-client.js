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

import { createUrl, context as h2, h1 } from '@adobe/fetch';
import { hasText, isValidUrl } from '@adobe/spacecat-shared-utils';

/* c8 ignore next 3 */
const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? h1()
  : h2();

const EXA_API_BASE_URL = 'https://api.exa.ai';

/**
 * Sanitizes headers for logging by masking sensitive values
 * @param {Object} headers - Headers object
 * @returns {Object} Sanitized headers
 */
function sanitizeHeaders(headers) {
  return {
    ...headers,
    ...(headers['x-api-key'] && { 'x-api-key': '***' }),
  };
}

/**
 * Validates the find similar response from Exa API
 * @param {Object} response - API response
 * @returns {boolean} True if valid
 */
function validateFindSimilarResponse(response) {
  return response
    && typeof response === 'object'
    && Array.isArray(response.results)
    && response.requestId;
}

/**
 * Exa AI Client for finding similar links and content discovery
 * Based on Exa API: https://docs.exa.ai/reference/find-similar-links
 */
export default class ExaClient {
  /**
   * Creates an ExaClient from context
   * @param {Object} context - Context object with env and log
   * @returns {ExaClient} - The Exa client instance
   */
  static createFrom(context) {
    const { log = console } = context;
    const { EXA_API_KEY: apiKey } = context.env;

    if (!hasText(apiKey)) {
      throw new Error('Missing Exa API key');
    }

    return new ExaClient({ apiKey }, log);
  }

  /**
   * Creates a new Exa AI client
   *
   * @param {Object} config - The configuration object
   * @param {string} config.apiKey - The API key for Exa AI
   * @param {Object} log - The logger
   * @returns {ExaClient} - The Exa AI client
   */
  constructor(config, log) {
    this.config = config;
    this.log = log;
  }

  /**
   * Logs the duration of an operation
   * @param {string} message - Log message
   * @param {bigint} startTime - Start time from process.hrtime.bigint()
   * @private
   */
  #logDuration(message, startTime) {
    const endTime = process.hrtime.bigint();
    const duration = (endTime - startTime) / BigInt(1e6);
    this.log.debug(`${message}: took ${duration}ms`);
  }

  /**
   * Makes a POST request to the Exa API
   * @param {string} path - API path
   * @param {Object} body - Request body
   * @returns {Promise<Object>} API response
   * @private
   */
  async #makeRequest(path, body) {
    const url = createUrl(`${EXA_API_BASE_URL}${path}`);
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
    };

    this.log.debug(`[Exa API Call]: ${url}, Headers: ${JSON.stringify(sanitizeHeaders(headers))}`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Exa API call failed with status ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  /**
   * Find similar links to a given URL
   * @param {string} url - The URL to find similar links for
   * @param {Object} options - Optional parameters
   * @param {number} options.numResults - Number of results to return (default: 10, max: 100)
   * @param {boolean} options.text - Include page text content
   * @param {boolean} options.highlights - Include highlights
   * @param {boolean} options.summary - Include page summaries
   * @param {string} options.excludeDomains - Comma-separated list of domains to exclude
   * @param {string} options.includeDomains - Comma-separated list of domains to include
   * @param {string} options.startCrawlDate - Start date for content (YYYY-MM-DD)
   * @param {string} options.endCrawlDate - End date for content (YYYY-MM-DD)
   * @param {string} options.startPublishedDate - Start published date (YYYY-MM-DD)
   * @param {string} options.endPublishedDate - End published date (YYYY-MM-DD)
   * @param {boolean} options.excludeSourceDomain - Exclude the source domain from results
   * @param {string} options.category - Category filter
   * @param {number} options.livecrawl - Livecrawl mode (never, fallback, always)
   * @param {Object} options.contents - Content options
   * @param {number} options.contents.maxCharacters - Max characters per result
   * @param {boolean} options.contents.subpages - Include subpages
   * @param {number} options.contents.subpageTarget - Target number of subpages
   * @param {Object|boolean} options.contents.context - Context string options
   * @returns {Promise<Object>} Exa API response with similar links
   */
  async findSimilar(url, options = {}) {
    // Validate URL
    if (!isValidUrl(url)) {
      throw new Error('Invalid URL provided');
    }

    const {
      numResults = 10,
      text = false,
      highlights = false,
      summary = false,
      excludeDomains,
      includeDomains,
      startCrawlDate,
      endCrawlDate,
      startPublishedDate,
      endPublishedDate,
      excludeSourceDomain = false,
      category,
      livecrawl,
      contents,
    } = options;

    // Build request body
    const body = {
      url,
      numResults,
    };

    // Add content retrieval options
    if (text) body.text = true;
    if (highlights) body.highlights = true;
    if (summary) body.summary = true;

    // Add filtering options
    if (excludeDomains) body.excludeDomains = excludeDomains;
    if (includeDomains) body.includeDomains = includeDomains;
    if (startCrawlDate) body.startCrawlDate = startCrawlDate;
    if (endCrawlDate) body.endCrawlDate = endCrawlDate;
    if (startPublishedDate) body.startPublishedDate = startPublishedDate;
    if (endPublishedDate) body.endPublishedDate = endPublishedDate;
    if (excludeSourceDomain) body.excludeSourceDomain = true;
    if (category) body.category = category;
    if (livecrawl) body.livecrawl = livecrawl;

    // Add contents options if provided
    if (contents) {
      body.contents = contents;
    }

    let response;
    try {
      const startTime = process.hrtime.bigint();
      response = await this.#makeRequest('/findSimilar', body);
      this.#logDuration('Exa API findSimilar call', startTime);
    } catch (error) {
      this.log.error('Error while fetching similar links from Exa API:', error.message);
      throw error;
    }

    // Validate response
    if (!validateFindSimilarResponse(response)) {
      this.log.error('Invalid response format from Exa API');
      throw new Error('Invalid response format from Exa API');
    }

    return response;
  }

  /**
   * Find similar links with full content
   * Convenience method that includes text, highlights, and summary
   * @param {string} url - The URL to find similar links for
   * @param {Object} options - Optional parameters (same as findSimilar)
   * @returns {Promise<Object>} Exa API response with full content
   */
  async findSimilarWithContent(url, options = {}) {
    return this.findSimilar(url, {
      ...options,
      text: true,
      highlights: true,
      summary: true,
    });
  }

  /**
   * Find similar links for content optimization
   * Returns results with summaries and highlights for content analysis
   * @param {string} url - The URL to analyze
   * @param {number} numResults - Number of similar pages to return (default: 5)
   * @returns {Promise<Object>} Exa API response optimized for content analysis
   */
  async findSimilarForContentOptimization(url, numResults = 5) {
    return this.findSimilar(url, {
      numResults,
      text: true,
      summary: true,
      highlights: true,
      excludeSourceDomain: true, // Don't include the same domain
      contents: {
        maxCharacters: 5000, // Limit content length
      },
    });
  }
}
