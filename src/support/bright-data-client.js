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

import { hasText, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

/**
 * Bright Data SERP API Client
 * Documentation: https://docs.brightdata.com/scraping-automation/serp-api/introduction
 */
export default class BrightDataClient {
  constructor(apiKey, zone, log) {
    this.apiKey = apiKey;
    this.zone = zone;
    this.log = log;
    this.baseUrl = 'https://api.brightdata.com/request';
  }

  static createFrom(context) {
    const { env, log } = context;

    if (!hasText(env.BRIGHT_DATA_API_KEY)) {
      throw new Error('BRIGHT_DATA_API_KEY is not configured');
    }

    if (!hasText(env.BRIGHT_DATA_ZONE)) {
      throw new Error('BRIGHT_DATA_ZONE is not configured');
    }

    return new BrightDataClient(
      env.BRIGHT_DATA_API_KEY,
      env.BRIGHT_DATA_ZONE,
      log,
    );
  }

  /**
   * Extract locale from URL path
   *
   * @param {string} brokenUrl - Broken backlink URL
   * @returns {string|null} Locale code (e.g., "en_us", "de_ch") or null
   *
   * Example:
   *   Input: "https://www.lexmark.com/en_us/about-us.html"
   *   Output: "en_us"
   */
  extractLocale(brokenUrl) {
    try {
      const urlObj = new URL(brokenUrl);
      const path = urlObj.pathname;

      // Match locale patterns: en_us, de_ch, en_US, fr_ca, etc.
      const localeMatch = path.match(/^\/([a-z]{2}_[a-z]{2})\//i);
      if (localeMatch) {
        return localeMatch[1].toLowerCase();
      }

      return null;
    } catch (error) {
      this.log.error(`Failed to extract locale from ${brokenUrl}:`, error);
      return null;
    }
  }

  /**
   * Extract keywords from broken URL path
   *
   * @param {string} brokenUrl - Broken backlink URL
   * @returns {string} Keywords extracted from URL
   *
   * Example:
   *   Input: "https://okta.com/blog/2017/05/modernizing-government-identity/"
   *   Output: "modernizing government identity"
   */
  extractKeywords(brokenUrl) {
    try {
      const urlObj = new URL(brokenUrl);
      let path = urlObj.pathname;

      // Remove trailing slash
      if (path.endsWith('/')) {
        path = path.slice(0, -1);
      }

      // Remove locale prefix (will be added separately to search query)
      path = path.replace(/^\/[a-z]{2}_[a-z]{2}\//i, '/');

      // Remove dates (YYYY/MM/DD or YYYY/MM)
      path = path.replace(/\/\d{4}\/\d{2}(\/\d{2})?/g, '/');

      // Remove common blog/resource prefixes
      path = path.replace(/^\/(blog|news|article|post|resources?|guides?|docs?)\//i, '/');

      // Split by / and filter
      const segments = path
        .split('/')
        .filter((segment) => (
          // Filter out short segments, numbers, common words
          segment.length > 3
            && !/^\d+$/.test(segment) // Not just numbers
            && !['blog', 'news', 'post', 'page', 'index'].includes(segment.toLowerCase())
        ));

      // Convert hyphens/underscores to spaces and join
      const keywords = segments
        .map((segment) => segment.replace(/-/g, ' ').replace(/_/g, ' '))
        .join(' ')
        .trim();

      if (keywords) {
        this.log.debug(`Extracted keywords from ${brokenUrl}: "${keywords}"`);
      }

      return keywords;
    } catch (error) {
      this.log.error(`Failed to extract keywords from ${brokenUrl}:`, error);
      return '';
    }
  }

  /**
   * Build Google Search query for Bright Data
   *
   * @param {string} siteDomain - Domain to search within (e.g., "okta.com")
   * @param {string} keywords - Keywords to search for
   * @param {string|null} locale - Locale code (e.g., "en_us", "de_ch")
   * @returns {string} Google search query
   *
   * Example:
   *   buildSearchQuery("lexmark.com", "about us", "en_us")
   *   → "site:lexmark.com en_us about us"
   */
  buildSearchQuery(siteDomain, keywords, locale = null) {
    const parts = [`site:${siteDomain}`];

    // Add locale if present
    if (locale) {
      parts.push(locale);
    }

    // Add keywords if present
    if (keywords) {
      parts.push(keywords);
    }

    const query = parts.join(' ');

    if (!keywords && !locale) {
      this.log.debug(`No keywords or locale provided, searching whole site: ${siteDomain}`);
    }

    return query;
  }

  /**
   * Google Search via Bright Data SERP API
   *
   * @param {string} siteBaseURL - Base URL of the site (e.g., "https://okta.com")
   * @param {string} brokenUrl - Broken backlink URL
   * @param {number} numResults - Number of results to return (default: 10)
   * @returns {Promise<Array>} Array of search results
   *
   * Example response:
   * [
   *   {
   *     link: "https://okta.com/blog/modernizing-identity/",
   *     title: "Modernizing Identity | Okta",
   *     description: "...",
   *     global_rank: 1
   *   },
   *   ...
   * ]
   */
  async googleSearch(siteBaseURL, brokenUrl, numResults = 10) {
    // 1. Extract site domain
    const siteDomain = new URL(siteBaseURL).hostname;

    // 2. Extract locale from broken URL
    const locale = this.extractLocale(brokenUrl);

    // 3. Extract keywords from broken URL
    const keywords = this.extractKeywords(brokenUrl);

    if (!keywords && !locale) {
      this.log.warn(`No keywords or locale extracted from ${brokenUrl}, will search whole site`);
    }

    // 4. Build search query: "site:lexmark.com en_us about us"
    const searchQuery = this.buildSearchQuery(siteDomain, keywords, locale);

    this.log.debug(`Bright Data query: "${searchQuery}"`);

    // 5. Build Google Search URL
    const googleUrl = new URL('https://www.google.com/search');
    googleUrl.searchParams.set('q', searchQuery);
    googleUrl.searchParams.set('hl', 'en'); // Language: English
    googleUrl.searchParams.set('gl', 'us'); // Country: US
    googleUrl.searchParams.set('num', numResults); // Number of results

    try {
      // 6. Call Bright Data API with extended timeout
      // Note: SERP API can take 10-30 seconds for complex queries
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          zone: this.zone,
          url: googleUrl.toString(),
          format: 'raw',
          data_format: 'parsed_light', // Fast: Top results only
        }),
        timeout: 30000, // 30 seconds (default is 10s)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bright Data API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      // 7. Extract organic results
      const results = data.organic || [];

      this.log.info(`Bright Data returned ${results.length} results for "${searchQuery}"`);

      if (results.length === 0) {
        this.log.warn(`No results found for "${searchQuery}"`);
      }

      return results;
    } catch (error) {
      this.log.error(`Bright Data SERP request failed for "${searchQuery}":`, error);
      return [];
    }
  }

  /**
   * Get enriched data for Mystique message
   *
   * @param {string} siteBaseURL - Base URL of the site
   * @param {string} brokenUrl - Broken backlink URL
   * @param {number} numResults - Number of results (default: 10)
   * @returns {Promise<Object>} Data ready for Mystique
   */
  async getTopResultsForMystique(siteBaseURL, brokenUrl, numResults = 10) {
    const siteDomain = new URL(siteBaseURL).hostname;
    const locale = this.extractLocale(brokenUrl);
    const keywords = this.extractKeywords(brokenUrl);
    const searchQuery = this.buildSearchQuery(siteDomain, keywords, locale);

    const searchResults = await this.googleSearch(siteBaseURL, brokenUrl, numResults);

    return {
      siteDomain, // "lexmark.com"
      locale, // "en_us" or null
      keywords, // "about us"
      searchQuery, // "site:lexmark.com en_us about us"
      topResults: searchResults, // Full data with titles, descriptions
    };
  }
}
