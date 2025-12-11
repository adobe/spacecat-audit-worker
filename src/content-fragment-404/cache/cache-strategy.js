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

export class CacheStrategy {
  /**
   * Find direct children of a parent path
   * @param {string} parentPath - The parent path
   * @returns {Array<ContentPath>} Array of child ContentPath objects
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  findChildren(parentPath) {
    throw new Error('findChildren() must be implemented by subclass');
  }

  /**
   * Cache content items.
   * @param {Array} items - Array of content items
   * @param {Function} statusParser - Function to parse content status
   * @returns {void}
   */
  // eslint-disable-next-line no-unused-vars, class-methods-use-this
  cacheItems(items, statusParser) {
    throw new Error('cacheItems() must be implemented by subclass');
  }

  /**
   * Check if this cache strategy is available.
   * @returns {boolean}
   */
  // eslint-disable-next-line class-methods-use-this
  isAvailable() {
    throw new Error('isAvailable() must be implemented by subclass');
  }
}
