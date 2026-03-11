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
 * Generates a unique CSS selector for any DOM element.
 * Priority order:
 * 1. Universal Editor: data-aue-* attributes
 * 2. Standard CSS: id, classes, nth-of-type, parent chain (max 3 levels)
 *
 * @param {Element} element
 * @returns {string|null} A CSS selector string, or null.
 */
export function getDomElementSelector(element) {
  // Works with cheerio elements only
  if (!element || !element.name) {
    return null;
  }

  const { name, attribs, parent } = element;
  const tag = name.toLowerCase();
  let selectors = [tag];

  // 1. Check for Universal Editor data attributes
  const aueResource = attribs?.['data-aue-resource'];
  if (aueResource) {
    return `${tag}[data-aue-resource="${aueResource}"]`;
  }

  const aueProp = attribs?.['data-aue-prop'];
  if (aueProp) {
    // If element has data-aue-prop, it's a specific property within a component
    return `${tag}[data-aue-prop="${aueProp}"]`;
  }

  // 2. Check for ID (most specific - return immediately)
  const id = attribs?.id;
  if (id) {
    return `${tag}#${cssEscape(id)}`;
  }

  // 3. Add classes if available
  const className = attribs?.class;
  if (className && typeof className === 'string') {
    const classes = className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      const classSelector = classes.slice(0, 2).map((c) => cssEscape(c)).join('.');
      selectors = [`${tag}.${classSelector}`];
    }
  }

  // 4. Add nth-of-type if multiple siblings of same tag exist
  if (parent && parent.children) {
    const siblingsOfSameTag = parent.children.filter(
      (child) => child.type === 'tag' && child.name === name,
    );

    if (siblingsOfSameTag.length > 1) {
      const index = siblingsOfSameTag.indexOf(element) + 1;
      selectors.push(`:nth-of-type(${index})`);
    }
  }

  const selector = selectors.join('');

  // 5. Build path with parent selectors for more specificity (max 3 levels)
  const pathParts = [selector];
  let current = parent;
  let levels = 0;

  while (current && current.name && current.name.toLowerCase() !== 'html' && levels < 3) {
    let parentSelector = current.name.toLowerCase();

    // If parent has Universal Editor attribute, use it and stop
    const parentAueResource = current.attribs?.['data-aue-resource'];
    if (parentAueResource) {
      pathParts.unshift(`${parentSelector}[data-aue-resource="${parentAueResource}"]`);
      break;
    }

    // If parent has ID, use it and stop (ID is unique enough)
    const parentId = current.attribs?.id;
    if (parentId) {
      pathParts.unshift(`#${cssEscape(parentId)}`);
      break;
    }

    // Add parent classes (limit to first 2 for readability)
    const parentClassName = current.attribs?.class;
    if (parentClassName && typeof parentClassName === 'string') {
      const classes = parentClassName.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        const classSelector = classes.slice(0, 2).map((c) => cssEscape(c)).join('.');
        parentSelector = `${parentSelector}.${classSelector}`;
      }
    }

    // Add nth-of-type for parent if it has multiple siblings of same tag
    if (current.parent && current.parent.children) {
      const parentSiblingsOfSameTag = current.parent.children.filter(
        // eslint-disable-next-line no-loop-func
        (child) => child.type === 'tag' && child.name === current.name,
      );

      if (parentSiblingsOfSameTag.length > 1) {
        const parentIndex = parentSiblingsOfSameTag.indexOf(current) + 1;
        parentSelector = `${parentSelector}:nth-of-type(${parentIndex})`;
      }
    }

    pathParts.unshift(parentSelector);
    current = current.parent;
    levels += 1;
  }

  // 6. Join with '>' (direct child combinator)
  return pathParts.join(' > ');
}

/**
 * Normalizes selector(s) into the payload expected by consumers.
 * Returns a unified format for spreading into opportunity objects
 * across all selector types (Universal Editor or standard CSS).
 *
 * @param {string|string[]} selectors
 * @param {number} [limit=Infinity]
 * @returns {{elements?: Array<{selector: string}>}}
 */
export function toElementTargets(selectors, limit = Infinity) {
  if (!selectors) {
    return {};
  }
  const raw = Array.isArray(selectors) ? selectors : [selectors];
  const unique = [];
  raw.forEach((selector) => {
    if (selector && !unique.includes(selector)) {
      unique.push(selector);
    }
  });

  const limited = unique.slice(0, limit);

  if (limited.length === 0) {
    return {};
  }

  return { elements: limited.map((selector) => ({ selector })) };
}
