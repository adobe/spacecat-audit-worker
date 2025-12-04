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
 * Generates a unique-ish CSS selector for any DOM element.
 * Strategy mirrors the Heading audit logic and limits depth for readability.
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

  // 1. Check for ID (most specific - return immediately)
  const id = attribs?.id;
  if (id) {
    return `${tag}#${id}`;
  }

  // 2. Add classes if available
  const className = attribs?.class;
  if (className && typeof className === 'string') {
    const classes = className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      const classSelector = classes.slice(0, 2).join('.');
      selectors = [`${tag}.${classSelector}`];
    }
  }

  // 3. Add nth-of-type if multiple siblings of same tag exist
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

  // 4. Build path with parent selectors for more specificity (max 3 levels)
  const pathParts = [selector];
  let current = parent;
  let levels = 0;

  while (current && current.name && current.name.toLowerCase() !== 'html' && levels < 3) {
    let parentSelector = current.name.toLowerCase();

    // If parent has ID, use it and stop (ID is unique enough)
    const parentId = current.attribs?.id;
    if (parentId) {
      pathParts.unshift(`#${parentId}`);
      break;
    }

    // Add parent classes (limit to first 2 for readability)
    const parentClassName = current.attribs?.class;
    if (parentClassName && typeof parentClassName === 'string') {
      const classes = parentClassName.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        const classSelector = classes.slice(0, 2).join('.');
        parentSelector = `${parentSelector}.${classSelector}`;
      }
    }

    pathParts.unshift(parentSelector);
    current = current.parent;
    levels += 1;
  }

  // 5. Join with '>' (direct child combinator)
  return pathParts.join(' > ');
}

/**
 * Normalizes selector(s) into the element payload expected by consumers.
 * @param {string|string[]} selectors
 * @param {number} [limit=Infinity]
 * @returns {Array<{selector: string}>}
 */
export function toElementTargets(selectors, limit = Infinity) {
  if (!selectors) {
    return [];
  }
  const raw = Array.isArray(selectors) ? selectors : [selectors];
  const unique = [];
  raw.forEach((selector) => {
    if (selector && !unique.includes(selector)) {
      unique.push(selector);
    }
  });
  return unique.slice(0, limit).map((selector) => ({ selector }));
}
