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

import { ContentPath } from '../domain/content/content-path.js';
import { Locale } from '../domain/language/locale.js';
import { CacheStrategy } from './cache-strategy.js';

/**
 * Cache implementation that uses PathIndex for storage.
 * Provides hierarchical path caching and lookup capabilities.
 */
export class PathIndexCache extends CacheStrategy {
  constructor(pathIndex) {
    super();
    this.pathIndex = pathIndex;
  }

  findChildren(parentPath) {
    return this.pathIndex.findChildren(parentPath);
  }

  cacheItems(items, statusParser) {
    if (!items || items.length === 0) {
      return;
    }

    for (const item of items) {
      const contentPath = new ContentPath(
        item.path,
        statusParser(item.status),
        Locale.fromPath(item.path),
      );
      this.pathIndex.insertContentPath(contentPath);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  isAvailable() {
    return true;
  }
}
