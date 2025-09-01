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

  async isAvailable(path) {
    try {
      const response = await fetch(this.createUrl(path), {
        headers: this.createAuthHeaders(),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const isAvailable = data?.items && data.items.length > 0;

      // If content is available and we have a PathIndex, cache it
      if (isAvailable && this.pathIndex) {
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

  async fetchContent(path) {
    try {
      // TODO: Implement crawling with pagination, as AEM returns only 50 items at a time
      const response = await fetch(this.createUrl(path), {
        headers: this.createAuthHeaders(),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data?.items || [];
    } catch (error) {
      throw new Error(`Failed to fetch AEM Author content for ${path}: ${error.message}`);
    }
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

    log.debug(`No children found in cache, checking parent path: ${parentPath}`);

    let isAvailable = false;
    try {
      isAvailable = await this.isAvailable(parentPath);
    } catch (error) {
      log.error(`Error getting children from path ${parentPath}:`, error);
      return [];
    }

    if (isAvailable) {
      log.info(`Parent path is available on Author: ${parentPath}`);
      return this.pathIndex.findChildren(parentPath);
    }

    // Try the next parent up the hierarchy
    log.debug(`Parent path not available, trying next parent up: ${parentPath}`);
    const nextParent = PathUtils.getParentPath(parentPath);
    return this.getChildrenFromPath(nextParent, context);
  }

  createUrl(fragmentPath) {
    const url = new URL(AemAuthorClient.API_SITES_FRAGMENTS, this.authorUrl);
    url.searchParams.set('path', fragmentPath);
    url.searchParams.set('projection', 'minimal');
    return url.toString();
  }

  createAuthHeaders() {
    return {
      Authorization: `Bearer ${this.authToken}`,
      Accept: 'application/json',
    };
  }
}
