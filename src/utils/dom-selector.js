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
    return `${tag}#${id}`;
  }

  // 3. Add classes if available
  const className = attribs?.class;
  if (className && typeof className === 'string') {
    const classes = className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      const classSelector = classes.slice(0, 2).join('.');
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
 * Normalizes selector(s) into the element payload expected by consumers.
 * Detects context (Cloud Service, Universal Editor, or standard) and returns
 * appropriate format for spreading into opportunity objects.
 *
 * Cloud Service format: { selector: { elements: ["cq[data-path=\"...\"]", ...] } }
 * Universal Editor format: { selector: { elements: ["div[data-aue-resource=\"...\"]", ...] } }
 * Standard format: { elements: [{ selector: "..." }, ...] }
 *
 * @param {string|string[]} selectors
 * @param {number} [limit=Infinity]
 * @param {string} [context] Optional context description
 * @returns {{elements?: Array<{selector: string}>,
 *           selector?: {elements: string[], context?: string}}}
 */
export function toElementTargets(selectors, limit = Infinity, context = undefined) {
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

  // Detect if we're in Cloud Service context (cq[data-path="..."])
  const isCloudService = limited.some((sel) => sel.startsWith('cq[data-path='));

  // Detect if we're in Universal Editor context (data-aue-*)
  const isUniversalEditor = !isCloudService && limited.some(
    (sel) => sel.includes('[data-aue-resource=') || sel.includes('[data-aue-prop='),
  );

  // Return structured format for Cloud Service or Universal Editor
  if (isCloudService || isUniversalEditor) {
    const result = { elements: limited };
    if (context) {
      result.context = context;
    }
    return { selector: result };
  }

  // Return standard format for regular CSS selectors
  return { elements: limited.map((selector) => ({ selector })) };
}
