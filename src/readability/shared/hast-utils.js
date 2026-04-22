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

/**
 * Converts an HTML string to a HAST (Hypertext Abstract Syntax Tree) fragment.
 * The resulting tree is compatible with Tokowaka's `valueFormat: "hast"` patch format.
 *
 * @param {string} html - Inner HTML string to convert
 * @returns {import('hast').Root} HAST root node
 */
export function htmlToHast(html) {
  return fromHtml(html, { fragment: true });
}
