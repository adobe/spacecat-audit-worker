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
 * Minimal CSS identifier escape helper.
 * Escapes characters that could break a CSS selector (#, ., :, spaces, etc.).
 * @param {string} value
 * @returns {string}
 */
function escapeCssIdentifier(value) {
  if (!value) {
    return '';
  }
  return `${value}`.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

/**
 * Build a selector segment for a DOM element (tag with optional classes/nth-of-type).
 * @param {Element} element
 * @returns {string}
 */
function buildSelectorSegment(element) {
  const tag = element.tagName.toLowerCase();

  if (element.id) {
    return `${tag}#${escapeCssIdentifier(element.id)}`;
  }

  if (typeof element.className === 'string' && element.className.trim()) {
    const classSelector = element.className
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((cls) => escapeCssIdentifier(cls))
      .join('.');
    if (classSelector) {
      return `${tag}.${classSelector}`;
    }
  }

  return tag;
}

/**
 * Returns children of `parent` that share the same tagName.
 * @param {Element} parent
 * @param {string} tagName
 * @returns {Element[]}
 */
function getSameTagSiblings(parent, tagName) {
  return Array.from(parent.children).filter((child) => child.tagName === tagName);
}

/**
 * Generates a unique-ish CSS selector for any DOM element.
 * Strategy mirrors the Heading audit logic and limits depth for readability.
 * @param {Element} element
 * @returns {string|null}
 */
export function getDomElementSelector(element) {
  if (!element || !element.tagName) {
    return null;
  }

  const tagName = element.tagName.toLowerCase();
  if (!tagName) {
    return null;
  }

  const parent = element.parentElement;
  const selectors = [buildSelectorSegment(element)];

  if (parent) {
    const siblings = getSameTagSiblings(parent, element.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(element) + 1;
      selectors.push(`:nth-of-type(${index})`);
    }
  }

  const selector = selectors.join('');
  const pathParts = [selector];
  let current = parent;
  let levels = 0;

  while (
    current
    && current.tagName
    && current.tagName.toLowerCase() !== 'html'
    && levels < 3
  ) {
    const segment = buildSelectorSegment(current);
    const parentParent = current.parentElement;

    if (current.id) {
      pathParts.unshift(segment);
      break;
    }

    if (parentParent) {
      const siblings = getSameTagSiblings(parentParent, current.tagName);

      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        pathParts.unshift(`${segment}:nth-of-type(${index})`);
      } else {
        pathParts.unshift(segment);
      }
    } else {
      pathParts.unshift(segment);
    }

    current = parentParent;
    levels += 1;
  }

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
