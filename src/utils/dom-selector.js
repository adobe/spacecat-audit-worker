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
 * Helper function to find the nearest <cq> element with data-path attribute.
 * In AEM Cloud Service, <cq> elements are typically siblings that follow the content.
 * @param {Element} element
 * @returns {string|null} The data-path value or null
 */
function findNearestCqDataPath(element) {
  // First check parents
  let current = element.parent;
  while (current) {
    // Look for cq sibling in current level
    if (current.children) {
      const cqSibling = current.children.find(
        (child) => child.type === 'tag' && child.name === 'cq' && child.attribs?.['data-path'],
      );
      if (cqSibling) {
        return cqSibling.attribs['data-path'];
      }
    }

    // Move up to parent
    current = current.parent;
  }

  return null;
}

/**
 * Generates a unique-ish CSS selector for any DOM element.
 * Strategy mirrors the Heading audit logic and limits depth for readability.
 * Priority order:
 * 1. Cloud Service: cq[data-path] (AEM CS context)
 * 2. Universal Editor: data-aue-* attributes
 * 3. Standard CSS: id, classes, nth-of-type
 * @param {Element} element
 * @returns {string|null}
 */
export function getDomElementSelector(element) {
  // Works with cheerio elements only
  if (!element || !element.name) {
    return null;
  }

  const { name, attribs, parent } = element;
  const tag = name.toLowerCase();
  let selectors = [tag];

  // 1. Check for Cloud Service <cq data-path> (highest priority for AEM CS)
  const cqDataPath = findNearestCqDataPath(element);
  if (cqDataPath) {
    return `cq[data-path="${cqDataPath}"]`;
  }

  // 2. Check for Universal Editor data attributes
  const aueResource = attribs?.['data-aue-resource'];
  if (aueResource) {
    return `${tag}[data-aue-resource="${aueResource}"]`;
  }

  const aueProp = attribs?.['data-aue-prop'];
  if (aueProp) {
    // If element has data-aue-prop, it's a specific property within a component
    return `${tag}[data-aue-prop="${aueProp}"]`;
  }

  // 3. Check for ID (most specific - return immediately)
  const id = attribs?.id;
  if (id) {
    return `${tag}#${cssEscape(id)}`;
  }

  // 4. Add classes if available
  const className = attribs?.class;
  if (className && typeof className === 'string') {
    const classes = className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      const classSelector = classes.slice(0, 2).map((c) => cssEscape(c)).join('.');
      selectors = [`${tag}.${classSelector}`];
    }
  }

  // 5. Add nth-of-type if multiple siblings of same tag exist
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

  // 6. Build path with parent selectors for more specificity (max 3 levels)
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

  // 7. Join with '>' (direct child combinator)
  return pathParts.join(' > ');
}

/**
 * Normalizes selector(s) into the payload expected by consumers.
 * Returns a unified format for spreading into opportunity objects
 * across all selector types (Cloud Service, Universal Editor, or standard).
 *
 * Cloud Service: { elements: [{ selector: "cq[data-path=\"...\"]" }, ...] }
 * Universal Editor: { elements: [{ selector: "div[data-aue-resource=\"...\"]" }, ...] }
 * Standard CSS: { elements: [{ selector: "body > div.content > a" }, ...] }
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

  // Always return unified format: { elements: [{ selector: "..." }, ...] }
  return { elements: limited.map((selector) => ({ selector })) };
}
