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

export function cleanupStructuredDataMarkup($) {
  const main = $('body');

  // Remove HTML comments
  main.find('*').contents().filter((i, el) => el.type === 'comment').remove();

  const allowedAttributes = ['itemtype', 'itemprop', 'typeof', 'property', 'about', 'href', 'resource', 'itemid', 'src', 'content'];

  // Remove all non-allowed attributes
  main.find('*').each((i, el) => {
    Object.keys(el.attribs).forEach((attr) => {
      if (!allowedAttributes.includes(attr)) {
        $(el).removeAttr(attr);
      }
    });
  });

  // Remove all tags without attributes
  main.find('*').each((i, el) => {
    // Skip if tag in essential list
    if (Object.keys(el.attribs).length > 0) {
      return;
    }
    $(el).replaceWith($(el).contents());
  });

  return main.html();
}
