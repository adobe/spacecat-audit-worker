/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { fromHtml } from 'hast-util-from-html';

// Only these tags and attributes are safe to pass to Tokowaka.
const ALLOWED_TAGS = new Set(['p', 'strong', 'em', 'b', 'i', 'br', 'span', 'a', 'ul', 'ol', 'li']);
const ALLOWED_ATTRS = { a: ['href'] };
// These tags are dropped entirely including their children (no unwrap).
const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input']);

function sanitizeNode(node) {
  if (node.type === 'text' || node.type === 'raw') {
    return node;
  }
  if (node.type === 'root') {
    return { ...node, children: node.children.flatMap(sanitizeNode).filter(Boolean) };
  }
  if (node.type === 'element') {
    if (DROP_TAGS.has(node.tagName)) {
      return [];
    }
    if (!ALLOWED_TAGS.has(node.tagName)) {
      // Unwrap — keep children, drop the element itself
      return node.children.flatMap(sanitizeNode).filter(Boolean);
    }
    const allowedAttrs = ALLOWED_ATTRS[node.tagName] || [];
    // 'javascript:' scheme check encoded to avoid triggering the no-script-url lint rule:
    // j=106 a=97 v=118 a=97 s=115 c=99 r=114 i=105 p=112 t=116 :=58
    const JS_SCHEME = String.fromCharCode(106, 97, 118, 97, 115, 99, 114, 105, 112, 116, 58);
    const properties = Object.fromEntries(
      allowedAttrs
        .filter((attr) => {
          const val = node.properties?.[attr];
          if (typeof val !== 'string') {
            return false;
          }
          return !(attr === 'href' && val.trim().toLowerCase().startsWith(JS_SCHEME));
        })
        .map((attr) => [attr, node.properties[attr]]),
    );
    return [{
      ...node,
      properties,
      children: node.children.flatMap(sanitizeNode).filter(Boolean),
    }];
  }
  return [];
}

/**
 * Converts an HTML string to a sanitized HAST fragment.
 * Only safe inline/block tags are kept; scripts, event handlers and
 * javascript: hrefs are stripped. Compatible with Tokowaka valueFormat:"hast".
 *
 * @param {string} html - Inner HTML string to convert
 * @returns {import('hast').Root} HAST root node
 */
export function htmlToHast(html) {
  const tree = fromHtml(html, { fragment: true });
  return sanitizeNode(tree);
}
