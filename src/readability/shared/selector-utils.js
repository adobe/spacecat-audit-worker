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

/**
 * Generates a CSS selector for a given DOM element with optimal specificity.
 * Builds a path that includes parent context for better element identification.
 *
 * @param {Element} element - The DOM element to generate a selector for
 * @returns {string} A CSS selector string, or empty string if element is invalid or error occurs
 */
export function getElementSelector(element) {
  try {
    if (!element || !element.tagName) {
      return '';
    }

    const tag = element.tagName.toLowerCase();
    let selectors = [tag];

    // 1. Check for ID (most specific - return immediately)
    if (element.id) {
      return `${tag}#${element.id}`;
    }

    // 2. Add classes if available
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        // Limit to first 2 classes for readability
        const classSelector = classes.slice(0, 2).join('.');
        selectors = [`${tag}.${classSelector}`];
      }
    }

    // 3. Add nth-of-type if multiple siblings of same tag exist
    const parent = element.parentElement;
    if (parent) {
      // Get all sibling elements of the same tag type (direct children only)
      const siblingsOfSameTag = Array.from(parent.children).filter(
        (child) => child.tagName === element.tagName,
      );

      if (siblingsOfSameTag.length > 1) {
        const index = siblingsOfSameTag.indexOf(element) + 1;
        selectors.push(`:nth-of-type(${index})`);
      }
    }

    const selector = selectors.join('');

    // 4. Build path with parent selectors for more specificity (max 3 levels)
    const pathParts = [selector];
    let current = parent;
    let levels = 0;

    while (current && current.tagName && levels < 3) {
      const parentTag = current.tagName.toLowerCase();

      // Stop at body or html
      if (parentTag === 'body' || parentTag === 'html') {
        break;
      }

      let parentSelector = parentTag;

      // If parent has ID, use it and stop (ID is unique enough)
      if (current.id) {
        pathParts.unshift(`#${current.id}`);
        break;
      }

      // Add parent classes (limit to first 2 for readability)
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(Boolean);
        if (classes.length > 0) {
          const classSelector = classes.slice(0, 2).join('.');
          parentSelector = `${parentSelector}.${classSelector}`;
        }
      }

      pathParts.unshift(parentSelector);
      current = current.parentElement;
      levels += 1;
    }

    // 5. Join with '>' (direct child combinator)
    return pathParts.join(' > ');
  } catch (error) {
    // Return empty string on any error
    return '';
  }
}
