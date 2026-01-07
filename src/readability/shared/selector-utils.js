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
 * CSS.escape polyfill for Node.js environment.
 * Based on https://drafts.csswg.org/cssom/#serialize-an-identifier
 *
 * @param {string} value - The string to escape
 * @returns {string} The escaped CSS identifier
 */
function cssEscape(value) {
  const string = String(value);
  const { length } = string;
  let result = '';

  for (let index = 0; index < length; index += 1) {
    const codeUnit = string.charCodeAt(index);

    // If the character is NULL (U+0000), replace with U+FFFD
    if (codeUnit === 0x0000) {
      result += '\uFFFD';
    } else if (
      // If the character is in the range [\1-\1F] (U+0001 to U+001F) or is U+007F
      (codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit === 0x007F
      // Or is a digit and is the first character or second character after a hyphen
    ) {
      result += `\\${codeUnit.toString(16)} `;
    } else if (
      // If the character is the first character and is a hyphen, and there is no second character
      index === 0 && codeUnit === 0x002D && length === 1
    ) {
      result += `\\${string.charAt(index)}`;
    } else if (
      // If the character is not handled by one of the above rules and is
      // greater than or equal to U+0080, is `-` (U+002D) or `_` (U+005F), or
      // is in one of the ranges [0-9] (U+0030 to U+0039), [A-Z] (U+0041 to
      // U+005A), or [a-z] (U+0061 to U+007A), emit the character as-is.
      codeUnit >= 0x0080
      || codeUnit === 0x002D
      || codeUnit === 0x005F
      || (codeUnit >= 0x0030 && codeUnit <= 0x0039)
      || (codeUnit >= 0x0041 && codeUnit <= 0x005A)
      || (codeUnit >= 0x0061 && codeUnit <= 0x007A)
    ) {
      result += string.charAt(index);
    } else {
      // Otherwise, the character needs to be escaped
      result += `\\${string.charAt(index)}`;
    }
  }

  return result;
}

/**
 * Common attributes that can help uniquely identify elements.
 * Checked in order of preference before falling back to nth-of-type.
 */
const UNIQUE_ATTRIBUTES = ['data-testid', 'data-id', 'data-name', 'name', 'role', 'aria-label'];

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
    return includeTag ? `${tag}#${cssEscape(id)}` : `#${cssEscape(id)}`;
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
      const classSelector = classes
        .slice(0, 2)
        .map((c) => `.${cssEscape(c.trim())}`)
        .join('');
      selector = `${tag}${classSelector}`;
    }
  }

  // 5. Check for unique attributes before falling back to nth-of-type
  if (!parent) {
    return selector;
  }

  // 6. Try unique attributes first (data-testid, role, etc.)
  for (const attr of UNIQUE_ATTRIBUTES) {
    const attrValue = attribs?.[attr];
    if (attrValue && typeof attrValue === 'string' && attrValue.trim()) {
      return `${selector}[${attr}="${cssEscape(attrValue.trim())}"]`;
    }
  }

  // 7. Add position information based on siblings of the same type (nth-of-type)
  // Get all direct sibling elements of the same tag type (case-insensitive)
  const siblingsOfSameTag = parent.children.filter(
    (child) => child.type === 'tag' && child.name.toLowerCase() === tag,
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
 * @param {boolean} isTarget - Whether this is the target element (affects ID format)
 * @returns {string} A CSS selector path string
 */
function buildSelectorPath(element, isTarget = true) {
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

  // Recursively get parent selector (not the target, so ID won't include tag)
  const parentSelector = buildSelectorPath(parent, false);

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
