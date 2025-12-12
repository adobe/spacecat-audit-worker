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

import {
  hasText, isObject, isValidUrl, tracingFetch as httpFetch,
} from '@adobe/spacecat-shared-utils';

const EXA_API_BASE_URL = 'https://api.exa.ai';
const EXA_FIND_SIMILAR_ENDPOINT = '/findSimilar';
const EXA_GET_CONTENTS_ENDPOINT = '/contents';

/**
 * Validates the Exa API response for find similar links
 * @param {Object} response - The API response
 * @returns {boolean} - True if response is valid
 */
function validateFindSimilarResponse(response) {
  return isObject(response)
    && Array.isArray(response?.results)
    && hasText(response?.requestId);
}

/**
 * Validates the Exa API response for get contents
 * @param {Object} response - The API response
 * @returns {boolean} - True if response is valid
 */
function validateGetContentsResponse(response) {
  return isObject(response)
    && Array.isArray(response?.results)
    && hasText(response?.requestId);
}

/**
 * Sanitize headers for logging (remove API key)
 * @param {Object} headers - Headers object
 * @returns {Object} - Sanitized headers
 */
function sanitizeHeaders(headers) {
  const sanitized = { ...headers };
  if (sanitized['x-api-key']) {
    sanitized['x-api-key'] = '***';
  }
  return sanitized;
}

/**
 * Exa AI Client for finding similar links
 * Implements the Exa AI Find Similar Links API
 * @see https://docs.exa.ai/reference/find-similar-links
 */
export default class ExaClient {
  /**
   * Factory method to create an ExaClient from context
   * @param {Object} context - The context object containing env and log
   * @returns {ExaClient} - The Exa client instance
   */
  static createFrom(context) {
    const { log = console } = context;

    const {
      EXA_API_KEY: apiKey,
      EXA_API_ENDPOINT: apiEndpoint = EXA_API_BASE_URL,
    } = context.env;

    if (!hasText(apiKey)) {
      throw new Error('Missing Exa API key (EXA_API_KEY)');
    }

    if (!isValidUrl(apiEndpoint)) {
      throw new Error('Invalid Exa API endpoint');
    }

    return new ExaClient({
      apiKey,
      apiEndpoint,
    }, log);
  }

  /**
   * Creates a new Exa client
   *
   * @param {Object} config - The configuration object
   * @param {string} config.apiKey - The API Key for Exa
   * @param {string} config.apiEndpoint - The API endpoint for Exa (default: https://api.exa.ai)
   * @param {Object} log - The Logger
   * @returns {ExaClient} - The Exa client instance
   */
  constructor(config, log) {
    this.config = config;
    this.log = log;
  }

  /**
   * Log duration of API call
   * @param {string} message - Log message
   * @param {BigInt} startTime - Start time from process.hrtime.bigint()
   */
  #logDuration(message, startTime) {
    const endTime = process.hrtime.bigint();
    const duration = (endTime - startTime) / BigInt(1e6);
    this.log.debug(`${message}: took ${duration}ms`);
  }

  /**
   * Submit a request to the Exa API
   * @param {string} endpoint - The API endpoint path
   * @param {Object} body - The request body
   * @returns {Promise<Object>} - The API response
   */
  async #submitRequest(endpoint, body) {
    const url = `${this.config.apiEndpoint}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
    };

    this.log.debug(`[Exa API Call]: ${url}, Headers: ${JSON.stringify(sanitizeHeaders(headers))}`);
    this.log.debug(`[Exa API Call]: Request body: ${JSON.stringify(body)}`);

    const response = await httpFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.text();
      } catch (e) {
        errorBody = 'Unable to read error body';
      }
      this.log.error(`[Exa API Error]: Status ${response.status}, Body: ${errorBody}`);
      throw new Error(`Exa API call failed with status code ${response.status}: ${errorBody}`);
    }

    return response.json();
  }

  /**
   * Find similar links to the provided URL
   * @see https://docs.exa.ai/reference/find-similar-links
   *
   * @param {string} url - The URL to find similar links for
   * @param {Object} options - Optional parameters
   * @param {number} options.numResults - Number of results to return (default: 10, max: 100)
   * @param {boolean} options.text - Whether to include full content text (default: false)
   * @param {boolean} options.highlights - Whether to include highlights (default: false)
   * @param {boolean} options.summary - Whether to include AI-generated summary (default: false)
   * @param {number|boolean} options.subpages - Number of subpages to crawl (default: 0)
   * @param {string[]} options.excludeDomains - Array of domains to exclude from results
   * @param {string[]} options.includeDomains - Array of domains to include in results
   * @param {string} options.startPublishedDate - Filter for content published after this date
   * @param {string} options.endPublishedDate - Filter for content published before this date
   * @param {boolean} options.context - Return contents as context string for LLM (default: false)
   * @returns {Promise<Object>} - The find similar response
   */
  async findSimilar(url, options = {}) {
    const startTime = process.hrtime.bigint();

    // Validate URL
    if (!isValidUrl(url)) {
      throw new Error(`Invalid URL provided: ${url}`);
    }

    // Build request body
    const body = {
      url,
      numResults: options.numResults || 10,
    };

    // Add optional parameters
    if (options.text === true) {
      body.text = true;
    }

    if (options.highlights === true) {
      body.highlights = true;
    }

    if (options.summary === true) {
      body.summary = true;
    }

    if (typeof options.subpages === 'number' && options.subpages > 0) {
      body.subpages = options.subpages;
    }

    if (Array.isArray(options.excludeDomains) && options.excludeDomains.length > 0) {
      body.excludeDomains = options.excludeDomains;
    }

    if (Array.isArray(options.includeDomains) && options.includeDomains.length > 0) {
      body.includeDomains = options.includeDomains;
    }

    if (hasText(options.startPublishedDate)) {
      body.startPublishedDate = options.startPublishedDate;
    }

    if (hasText(options.endPublishedDate)) {
      body.endPublishedDate = options.endPublishedDate;
    }

    if (options.context === true) {
      body.contents = {
        context: true,
      };
    }

    let response;
    try {
      response = await this.#submitRequest(EXA_FIND_SIMILAR_ENDPOINT, body);
      this.#logDuration('Exa API Find Similar call', startTime);
    } catch (error) {
      this.log.error('Error while fetching data from Exa API: ', error.message);
      throw error;
    }

    // Validate response
    if (!validateFindSimilarResponse(response)) {
      this.log.error('Could not obtain data from Exa API: Invalid response format.');
      throw new Error('Invalid response format from Exa API');
    }

    // Log cost information if available
    if (response.costDollars) {
      this.log.debug(`[Exa API Cost]: $${response.costDollars.total}`);
    }

    this.log.debug(`[Exa API Success]: Found ${response.results.length} similar links`);

    return response;
  }

  /**
   * Find similar links with full text content
   * Convenience method that sets text: true
   *
   * @param {string} url - The URL to find similar links for
   * @param {Object} options - Optional parameters (see findSimilar)
   * @returns {Promise<Object>} - The find similar response with full text
   */
  async findSimilarWithContent(url, options = {}) {
    return this.findSimilar(url, { ...options, text: true });
  }

  /**
   * Find similar links with AI-generated summaries
   * Convenience method that sets summary: true
   *
   * @param {string} url - The URL to find similar links for
   * @param {Object} options - Optional parameters (see findSimilar)
   * @returns {Promise<Object>} - The find similar response with summaries
   */
  async findSimilarWithSummary(url, options = {}) {
    return this.findSimilar(url, { ...options, summary: true });
  }

  /**
   * Find similar links with full text and summaries
   * Convenience method that sets text: true and summary: true
   *
   * @param {string} url - The URL to find similar links for
   * @param {Object} options - Optional parameters (see findSimilar)
   * @returns {Promise<Object>} - The find similar response with full text and summaries
   */
  async findSimilarWithFullContent(url, options = {}) {
    return this.findSimilar(url, { ...options, text: true, summary: true });
  }

  /**
   * Get contents for a list of URLs
   * @see https://docs.exa.ai/reference/get-contents
   *
   * @param {string[]} urls - Array of URLs to fetch content for
   * @param {Object} options - Optional parameters
   * @param {boolean} options.text - Whether to include full content text (default: false)
   * @param {boolean|Object} options.highlights - Whether to include highlights or highlights config
   * @param {boolean} options.summary - Whether to include AI-generated summary (default: false)
   * @param {number|boolean} options.subpages - Number of subpages to crawl (default: 0)
   * @param {string} options.livecrawl - Livecrawl mode: "always", "fallback", "never"
   * @param {boolean|Object} options.context - Return contents as context string for LLM
   * @returns {Promise<Object>} - The get contents response
   */
  async getContents(urls, options = {}) {
    const startTime = process.hrtime.bigint();

    // Validate URLs
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('URLs must be a non-empty array');
    }

    const invalidUrls = urls.filter((url) => !isValidUrl(url));
    if (invalidUrls.length > 0) {
      throw new Error(`Invalid URLs provided: ${invalidUrls.join(', ')}`);
    }

    // Build request body
    const body = {
      urls,
    };

    // Add optional parameters
    if (options.text === true) {
      body.text = true;
    }

    if (options.highlights === true || isObject(options.highlights)) {
      body.highlights = options.highlights;
    }

    if (options.summary === true) {
      body.summary = true;
    }

    if (typeof options.subpages === 'number' && options.subpages > 0) {
      body.subpages = options.subpages;
    }

    if (hasText(options.livecrawl) && ['always', 'fallback', 'never'].includes(options.livecrawl)) {
      body.livecrawl = options.livecrawl;
    }

    if (options.context === true || isObject(options.context)) {
      body.contents = isObject(options.context) ? options.context : { context: true };
    }

    let response;
    try {
      response = await this.#submitRequest(EXA_GET_CONTENTS_ENDPOINT, body);
      this.#logDuration('Exa API Get Contents call', startTime);
    } catch (error) {
      this.log.error('Error while fetching contents from Exa API: ', error.message);
      throw error;
    }

    // Validate response
    if (!validateGetContentsResponse(response)) {
      this.log.error('Could not obtain contents from Exa API: Invalid response format.');
      throw new Error('Invalid response format from Exa API');
    }

    // Log cost information if available
    if (response.costDollars) {
      this.log.debug(`[Exa API Cost]: $${response.costDollars.total}`);
    }

    // Log status information
    if (response.statuses) {
      const successCount = response.statuses.filter((s) => s.status === 'success').length;
      const errorCount = response.statuses.filter((s) => s.status === 'error').length;
      this.log.debug(`[Exa API Contents]: ${successCount} successful, ${errorCount} errors out of ${urls.length} URLs`);

      // Log specific errors
      response.statuses.filter((s) => s.status === 'error').forEach((status) => {
        const logFn = this.log.warn || this.log.error || this.log.debug;
        logFn.call(this.log, `[Exa API Contents Error]: ${status.id} - ${status.error?.tag} (HTTP ${status.error?.httpStatusCode})`);
      });
    }

    this.log.debug(`[Exa API Success]: Retrieved contents for ${response.results.length} URLs`);

    return response;
  }

  /**
   * Get contents with full text
   * Convenience method that sets text: true
   *
   * @param {string[]} urls - Array of URLs to fetch content for
   * @param {Object} options - Optional parameters (see getContents)
   * @returns {Promise<Object>} - The get contents response with full text
   */
  async getContentsWithText(urls, options = {}) {
    return this.getContents(urls, { ...options, text: true });
  }

  /**
   * Get contents with AI-generated summaries
   * Convenience method that sets summary: true
   *
   * @param {string[]} urls - Array of URLs to fetch content for
   * @param {Object} options - Optional parameters (see getContents)
   * @returns {Promise<Object>} - The get contents response with summaries
   */
  async getContentsWithSummary(urls, options = {}) {
    return this.getContents(urls, { ...options, summary: true });
  }

  /**
   * Get contents with full text and summaries
   * Convenience method that sets text: true and summary: true
   *
   * @param {string[]} urls - Array of URLs to fetch content for
   * @param {Object} options - Optional parameters (see getContents)
   * @returns {Promise<Object>} - The get contents response with full text and summaries
   */
  async getContentsWithFullContent(urls, options = {}) {
    return this.getContents(urls, { ...options, text: true, summary: true });
  }
}
