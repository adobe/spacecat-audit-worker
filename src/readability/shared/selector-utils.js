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
 * Generates a CSS selector for a single element (without parent context).
 * Works with cheerio elements.
 *
 * @param {Element} element - The cheerio element to generate a selector for
 * @param {boolean} includeTag - Whether to include tag name with ID (for target element vs parent)
 * @returns {string} A CSS selector string for the element
 */
function getSingleElementSelector(element, includeTag = true) {
  const {
    name, attribs, parent,
  } = element;
  const tag = name.toLowerCase();
  const id = attribs?.id;
  const className = attribs?.class;

  // 1. Check for ID (highest priority)
  if (id) {
    return includeTag ? `${tag}#${id}` : `#${id}`;
  }

  // 2. Handle body element
  if (tag === 'body') {
    return 'body';
  }

  // 3. Start with tag name
  let selector = tag;

  // 4. Add classes if available (limit to first 2 for readability)
  if (className && typeof className === 'string') {
    const classes = className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      const classSelector = classes.slice(0, 2).join('.');
      selector = `${tag}.${classSelector}`;
    }
  }

  // 5. Add position information based on siblings of the same type (nth-of-type)
  if (!parent) {
    return selector;
  }

  // Get all sibling elements of the same tag type
  const siblingsOfSameTag = parent.children.filter(
    (child) => child.type === 'tag' && child.name === name,
  );

  // Only one element of this type, no position needed
  if (siblingsOfSameTag.length === 1) {
    return selector;
  }

  // Multiple siblings of same type - add nth-of-type
  const index = siblingsOfSameTag.indexOf(element) + 1;
  return `${selector}:nth-of-type(${index})`;
}

/**
 * Recursively builds a CSS selector path by traversing up the DOM tree.
 * Works with cheerio elements.
 *
 * @param {Element} element - The cheerio element to generate a selector path for
 * @param {number} depth - Current depth level (for limiting path length)
 * @param {boolean} isTarget - Whether this is the target element (affects ID format)
 * @returns {string} A CSS selector path string
 */
function buildSelectorPath(element, depth = 0, isTarget = true) {
  if (!element || !element.name) {
    return '';
  }

  const { name, attribs, parent } = element;
  const tag = name.toLowerCase();

  // Base case: reached html element
  if (tag === 'html') {
    return 'html';
  }

  // Base case: reached body element
  if (tag === 'body') {
    return 'body';
  }

  // Get selector for current element (include tag with ID only for target element)
  const selector = getSingleElementSelector(element, isTarget);

  // Stop condition: element with ID (stop after including it in path)
  if (attribs?.id) {
    return selector;
  }

  // Check parent
  if (!parent || !parent.name) {
    return selector;
  }

  const parentTag = parent.name.toLowerCase();

  // Stop before html or at body element
  if (parentTag === 'html' || parentTag === 'body') {
    return selector;
  }

  // Limit path depth to 3 total elements
  // (depth 0 = target, depth 1 = 1st parent, depth 2 = 2nd parent)
  if (depth >= 2) {
    return selector;
  }

  // Recursively get parent selector (not the target, so ID won't include tag)
  const parentSelector = buildSelectorPath(parent, depth + 1, false);

  // If parent selector is empty or html, just return current selector
  if (!parentSelector || parentSelector === 'html') {
    return selector;
  }

  // Combine parent and current selector with child combinator
  return `${parentSelector} > ${selector}`;
}

/**
 * Generates a CSS selector for a given cheerio element with optimal specificity.
 * Uses recursion to build a path that includes parent context for better element identification.
 *
 * @param {Element} element - The cheerio element to generate a selector for
 * @returns {string} A CSS selector string, or empty string if element is invalid or error occurs
 */
export function getElementSelector(element) {
  try {
    if (!element || !element.name) {
      return '';
    }

    return buildSelectorPath(element);
  } catch (error) {
    // Return empty string on any error
    return '';
  }
}
