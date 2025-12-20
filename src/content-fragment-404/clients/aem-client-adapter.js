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

// eslint-disable-next-line import/no-unresolved -- TODO: Package pending publication
import { AemClientBuilder, API_SITES_CF_FRAGMENTS } from '@adobe/spacecat-shared-aem-client';
import { NoOpCache } from '../cache/noop-cache.js';
import { PathUtils } from '../utils/path-utils.js';

/**
 * Adapter that wraps the shared AEM client package and provides specialized
 * functionality for the content-fragment-404 audit, including fragment listing,
 * availability checks, and cache integration.
 */
export class AemClientAdapter {
  // Safety limit to prevent too many paginated queries
  static MAX_PAGES = 10;

  // Delay between pagination requests for rate limiting
  static PAGINATION_DELAY_MS = 100;

  #context;

  #client;

  #cache;

  /**
   * Creates a new AemClientAdapter instance.
   * @param {Object} context - The execution context.
   * @param {Object} builtClient - The built client from AemClientBuilder.
   * @param {Object} builtClient.client - The base AEM client.
   * @param {Object} cache - Cache implementation for storing fragment data.
   */
  constructor(context, builtClient, cache = new NoOpCache()) {
    this.#context = context;
    this.#client = builtClient.client;
    this.#cache = cache;
  }

  /**
   * Factory method to create an AemClientAdapter from a context object.
   * @param {Object} context - The execution context.
   * @param {Object} context.site - Site object with getDeliveryConfig() method.
   * @param {Object} context.env - Environment variables containing IMS configuration.
   * @param {Object} context.log - Logger instance.
   * @param {Object} [cache] - Optional cache implementation.
   * @returns {AemClientAdapter} A configured adapter instance.
   */
  static createFrom(context, cache = new NoOpCache()) {
    const builtClient = AemClientBuilder.create(context).build();

    return new AemClientAdapter(context, builtClient, cache);
  }

  /**
   * Checks if a path is a breaking point for hierarchy traversal.
   * @param {string} path - The path to check.
   * @returns {boolean} True if the path is a breaking point.
   */
  static isBreakingPoint(path) {
    return !path || !path.startsWith('/content/dam/') || path === '/content/dam';
  }

  /**
   * Parses content status from the API response.
   * @param {string} status - The status string from the API.
   * @returns {string} Normalized status value.
   */
  static parseContentStatus(status) {
    if (!status) {
      return 'UNKNOWN';
    }

    const upperStatus = status.toUpperCase();
    switch (upperStatus) {
      case 'PUBLISHED': return 'PUBLISHED';
      case 'MODIFIED': return 'MODIFIED';
      case 'DRAFT': return 'DRAFT';
      case 'ARCHIVED': return 'ARCHIVED';
      case 'DELETED': return 'DELETED';
      default: return 'UNKNOWN';
    }
  }

  /**
   * Simple delay utility for rate limiting.
   * @param {number} ms - Milliseconds to delay.
   * @returns {Promise<void>}
   */
  static async delay(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(), ms);
    });
  }

  /**
   * Checks if content exists at the specified path.
   * @param {string} path - The fragment path to check.
   * @returns {Promise<boolean>} True if content exists at the path.
   */
  async isAvailable(path) {
    const { log } = this.#context;

    try {
      const url = `${API_SITES_CF_FRAGMENTS}?path=${encodeURIComponent(path)}&projection=minimal`;
      const data = await this.#client.request('GET', url);

      // Sites API returns 200 with empty items array when path doesn't exist
      const isAvailable = data?.items && data.items.length !== 0;

      // If there is content, cache it
      if (data?.items) {
        this.#cache.cacheItems(data.items, AemClientAdapter.parseContentStatus);
      }

      return isAvailable;
    } catch (error) {
      log.error(`AEM Author request failed for ${path}: ${error.message}`);
      return false;
    }
  }

  /**
   * Fetches all content from a path using cursor-based pagination.
   * @param {string} path - The path to fetch content from.
   * @returns {Promise<Array>} All content items found.
   */
  async fetchContent(path) {
    try {
      return await this.#fetchContentWithPagination(path);
    } catch (error) {
      throw new Error(`Failed to fetch AEM Author content for ${path}: ${error.message}`);
    }
  }

  /**
   * Crawl all content from a path using cursor-based pagination.
   * @param {string} path - The path to crawl.
   * @returns {Promise<Array>} All content items found.
   */
  async #fetchContentWithPagination(path) {
    const { log } = this.#context;

    const allItems = [];
    let cursor = null;
    let pageCount = 0;

    log.debug(`Starting crawl for path: ${path}`);

    do {
      try {
        pageCount += 1;

        log.debug(`Fetching page ${pageCount} for path: ${path}${cursor ? ` (cursor: ${cursor})` : ''}`);

        // eslint-disable-next-line no-await-in-loop
        const response = await this.#fetchWithPagination(path, cursor);

        if (response.items && response.items.length > 0) {
          allItems.push(...response.items);
          log.debug(`Page ${pageCount}: Found ${response.items.length} items (total: ${allItems.length})`);
        }

        cursor = response.cursor;

        // Add small delay to implement rate limiting
        if (cursor) {
          // eslint-disable-next-line no-await-in-loop
          await AemClientAdapter.delay(AemClientAdapter.PAGINATION_DELAY_MS);
        }
      } catch (error) {
        log.error(`Error fetching page ${pageCount} for path ${path}: ${error.message}`);
        // Return what we have so far instead of failing completely
        break;
      }
    } while (cursor && pageCount < AemClientAdapter.MAX_PAGES);

    // Cache items
    this.#cache.cacheItems(allItems, AemClientAdapter.parseContentStatus);

    log.info(`Complete crawl finished for path: ${path}. Found ${allItems.length} total items across ${pageCount} pages`);
    return allItems;
  }

  /**
   * Fetch a single page of content with optional cursor.
   * @param {string} path - The path to fetch.
   * @param {string|null} cursor - The cursor for pagination.
   * @returns {Promise<{items: Array, cursor: string|null}>} Response with items and next cursor.
   */
  async #fetchWithPagination(path, cursor = null) {
    let url = `${API_SITES_CF_FRAGMENTS}?path=${encodeURIComponent(path)}&projection=minimal`;

    if (cursor) {
      url += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const data = await this.#client.request('GET', url);

    return {
      items: data?.items || [],
      cursor: data?.cursor || null,
    };
  }

  /**
   * Gets children paths from a parent path, traversing up the hierarchy if needed.
   * @param {string} parentPath - The parent path to get children from.
   * @returns {Promise<Array>} Array of child content paths.
   */
  async getChildrenFromPath(parentPath) {
    const { log } = this.#context;

    log.debug(`Getting children paths from parent: ${parentPath}`);

    if (!this.#cache.isAvailable()) {
      log.debug('Cache not available, returning empty list');
      return [];
    }

    if (AemClientAdapter.isBreakingPoint(parentPath)) {
      log.debug(`Reached breaking point: ${parentPath}`);
      return [];
    }

    const cachedChildren = this.#cache.findChildren(parentPath);
    if (cachedChildren.length > 0) {
      log.debug(`Found ${cachedChildren.length} children in cache for parent: ${parentPath}`);
      return cachedChildren;
    }

    log.debug('No children found in cache');

    let isAvailable = false;
    try {
      isAvailable = await this.isAvailable(parentPath);
    } catch (error) {
      log.error(`Error getting children from path ${parentPath}:`, error);
      return [];
    }

    if (isAvailable) {
      log.info(`Parent path is available on Author: ${parentPath}`);

      // Cache content here since it is available
      try {
        await this.fetchContent(parentPath);
        log.debug(`Fetched all content for parent path: ${parentPath}`);
      } catch (error) {
        log.warn(`Failed to fetch complete content for ${parentPath}: ${error.message}`);
        // Continue with cached data if available
      }

      return this.#cache.findChildren(parentPath);
    }

    const nextParent = PathUtils.getParentPath(parentPath);
    if (!nextParent) {
      log.debug(`No next parent found for: ${parentPath}`);
      return [];
    }

    // Try the next parent up the hierarchy
    log.debug(`Parent path not available, trying next parent up: ${nextParent}`);
    return this.getChildrenFromPath(nextParent);
  }
}
