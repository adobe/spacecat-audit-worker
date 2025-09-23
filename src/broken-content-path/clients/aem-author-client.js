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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { ContentPath } from '../domain/content/content-path.js';
import { Locale } from '../domain/language/locale.js';
import { PathUtils } from '../utils/path-utils.js';

export class AemAuthorClient {
  static API_SITES_BASE = '/adobe/sites/cf';

  static API_SITES_FRAGMENTS = `${AemAuthorClient.API_SITES_BASE}/fragments`;

  // Safety limit to prevent too many paginated queries
  static MAX_PAGES = 10;

  // Delay between pagination requests for rate limiting
  static PAGINATION_DELAY_MS = 100;

  constructor(authorUrl, authToken, pathIndex = null) {
    this.authorUrl = authorUrl;
    this.authToken = authToken;
    this.pathIndex = pathIndex;
  }

  static createFrom(context, pathIndex = null) {
    const { env } = context;
    const authorUrl = env.AEM_AUTHOR_URL;
    const authToken = env.AEM_AUTHOR_TOKEN;

    if (!authorUrl || !authToken) {
      throw new Error('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    }

    return new AemAuthorClient(authorUrl, authToken, pathIndex);
  }

  static isBreakingPoint(path) {
    return !path || !path.startsWith('/content/dam/') || path === '/content/dam';
  }

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
   * Simple delay utility for rate limiting
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  static async delay(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(), ms);
    });
  }

  async isAvailable(path) {
    try {
      const response = await fetch(this.createUrl(path).toString(), {
        headers: this.createAuthHeaders(),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      // If != 1, it is either not existing or a folder access
      const isAvailable = data?.items && data.items.length === 1;

      // If there is content, cache it
      if (data?.items && this.pathIndex) {
        for (const item of data.items) {
          const contentPath = new ContentPath(
            item.path,
            AemAuthorClient.parseContentStatus(item.status),
            Locale.fromPath(item.path),
          );
          this.pathIndex.insertContentPath(contentPath);
        }
      }

      return isAvailable;
    } catch (error) {
      throw new Error(`Failed to check AEM Author availability for ${path}: ${error.message}`);
    }
  }

  async fetchContent(path, context = null) {
    try {
      return await this.fetchContentWithPagination(path, context);
    } catch (error) {
      throw new Error(`Failed to fetch AEM Author content for ${path}: ${error.message}`);
    }
  }

  /**
   * Crawl all content from a path using cursor-based pagination
   * @param {string} path - The path to crawl
   * @param {Object} context - Optional context for logging
   * @returns {Promise<Array>} - All content items found
   */
  async fetchContentWithPagination(path, context = null) {
    const { log } = context;

    const allItems = [];
    let cursor = null;
    let pageCount = 0;

    log.debug(`Starting crawl for path: ${path}`);

    do {
      try {
        pageCount += 1;

        log.debug(`Fetching page ${pageCount} for path: ${path}${cursor ? ` (cursor: ${cursor})` : ''}`);

        // eslint-disable-next-line no-await-in-loop
        const response = await this.fetchWithPagination(path, cursor);

        if (response.items && response.items.length > 0) {
          allItems.push(...response.items);
          log.debug(`Page ${pageCount}: Found ${response.items.length} items (total: ${allItems.length})`);
        }

        cursor = response.cursor;

        // Add small delay to implement rate limiting
        if (cursor) {
          // eslint-disable-next-line no-await-in-loop
          await AemAuthorClient.delay(AemAuthorClient.PAGINATION_DELAY_MS);
        }
      } catch (error) {
        log.error(`Error fetching page ${pageCount} for path ${path}: ${error.message}`);
        // Return what we have so far instead of failing completely
        break;
      }
    } while (cursor && pageCount < AemAuthorClient.MAX_PAGES);

    // Cache items
    if (this.pathIndex) {
      for (const item of allItems) {
        const contentPath = new ContentPath(
          item.path,
          AemAuthorClient.parseContentStatus(item.status),
          Locale.fromPath(item.path),
        );
        this.pathIndex.insertContentPath(contentPath);
      }
    }

    log.info(`Complete crawl finished for path: ${path}. Found ${allItems.length} total items across ${pageCount} pages`);
    return allItems;
  }

  /**
   * Fetch a single page of content with optional cursor
   * @param {string} path - The path to fetch
   * @param {string|null} cursor - The cursor for pagination
   * @returns {Promise<{items: Array, cursor: string|null}>} - Response with items and next cursor
   */
  async fetchWithPagination(path, cursor = null) {
    const url = this.createUrlWithPagination(path, cursor);

    const response = await fetch(url.toString(), {
      headers: this.createAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      items: data?.items || [],
      cursor: data?.cursor || null,
    };
  }

  async getChildrenFromPath(parentPath, context) {
    const { log } = context;
    log.debug(`Getting children paths from parent: ${parentPath}`);

    if (!this.pathIndex) {
      log.debug('PathIndex not available, returning empty list');
      return [];
    }

    if (AemAuthorClient.isBreakingPoint(parentPath)) {
      log.debug(`Reached breaking point: ${parentPath}`);
      return [];
    }

    const cachedChildren = this.pathIndex.findChildren(parentPath);
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
        await this.fetchContent(parentPath, context);
        log.debug(`Fetched all content for parent path: ${parentPath}`);
      } catch (error) {
        log.warn(`Failed to fetch complete content for ${parentPath}: ${error.message}`);
        // Continue with cached data if available
      }

      return this.pathIndex.findChildren(parentPath);
    }

    const nextParent = PathUtils.getParentPath(parentPath);
    if (!nextParent) {
      log.debug(`No next parent found for: ${parentPath}`);
      return [];
    }

    // Try the next parent up the hierarchy
    log.debug(`Parent path not available, trying next parent up: ${nextParent}`);
    return this.getChildrenFromPath(nextParent, context);
  }

  /**
   * Create URL with pagination parameters
   * @param {string} path - The path to fetch
   * @param {string|null} cursor - The cursor for pagination
   * @returns {string} - Complete URL with pagination
   */
  createUrlWithPagination(fragmentPath, cursor = null) {
    const url = this.createUrl(fragmentPath);

    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    return url;
  }

  createUrl(fragmentPath) {
    const url = new URL(AemAuthorClient.API_SITES_FRAGMENTS, this.authorUrl);
    url.searchParams.set('path', fragmentPath);
    url.searchParams.set('projection', 'minimal');
    return url;
  }

  createAuthHeaders() {
    return {
      Authorization: `Bearer ${this.authToken}`,
      Accept: 'application/json',
    };
  }
}
