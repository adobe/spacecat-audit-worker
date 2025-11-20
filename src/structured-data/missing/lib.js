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

import * as cheerio from 'cheerio';

// Cache for organization types to avoid fetching schema.org data repeatedly
let organizationTypesCache = null;

async function loadOrganizationTypes() {
  if (organizationTypesCache) {
    return organizationTypesCache;
  }

  const schema = await (await fetch('https://schema.org/version/latest/schemaorg-all-https.jsonld')).json();
  const availableTypes = schema['@graph'].filter(type => type['@type'] === 'rdfs:Class');

  const organizationTypes = new Set();
  let newTypes = new Set(['schema:Organization']);
  while (newTypes.size > 0) {
    const newNewTypes = new Set();

    for (const currentType of newTypes) {
      organizationTypes.add(currentType);

      const subClasses = availableTypes.filter((type) => type['rdfs:subClassOf'] && (type['rdfs:subClassOf']['@id'] === currentType || Array.isArray(type['rdfs:subClassOf']) && type['rdfs:subClassOf'].some((subClass) => subClass['@id'] === currentType)));
      for (const subClass of subClasses) {
        newNewTypes.add(subClass['@id']);
      }
    }

    newTypes = newNewTypes;
  }

  // Remove schema: prefix and cache the result
  organizationTypesCache = new Set(Array.from(organizationTypes).map((type) => type.replace('schema:', '')));
  return organizationTypesCache;
}

export async function isOrganizationSubtype(input) {
  const organizationTypes = await loadOrganizationTypes();
  return organizationTypes.has(input);
}

export function removeLanguageFromPath(pathname) {
  // Check if pathname starts with any of the following patterns, if yes, remove it
  const languagePatterns = [
    /^\/[a-zA-Z]{2}\/[a-zA-Z]{2}(?:\/|$)/, // "/en/us", "/en/US", "/fr/ca", etc. - only if followed by slash or end
    /^\/[a-zA-Z]{2}-[a-zA-Z]{2}(?:\/|$)/, // "/en-us", "/en-US", "/fr-ca", etc. - only if followed by slash or end
    /^\/[a-zA-Z]{2}_[a-zA-Z]{2}(?:\/|$)/, // "/en_us", "/en_US", "/fr_ca", etc. - only if followed by slash or end
    /^\/[a-zA-Z]{2}(?:\/|$)/, // "/en", "/EN", "/fr", etc. - only if followed by slash or end of string
  ];

  for (const pattern of languagePatterns) {
    const match = pathname.match(pattern);
    if (match) {
      const matchedLength = match[0].length;
      const remainingPath = pathname.substring(matchedLength);

      // If the string is only a language pattern, return "/"
      if (remainingPath === '') {
        return '/';
      }

      // Ensure it starts with a slash
      const result = remainingPath.startsWith('/') ? remainingPath : `/${remainingPath}`;

      // Return the remaining path (don't process it further)
      return result;
    }
  }
  return pathname;
}

export function getClickableElements(rawBody) {
  const $ = cheerio.load(rawBody);

  // Remove header and footer tags
  $('header, footer').remove();

  // Clickable elements
  const clickableElements = $('a, button, input[type="submit"], input[type="button"], input[type="image"]');

  // Get href of clickable elements
  const clickableElementsHref = new Set(clickableElements
    .map((i, el) => $(el).attr('href'))
    .get()
    .map((href) => {
      // Try normalize links
      try {
        const url = new URL(href);
        return url.pathname;
      } catch (error) {
        return null;
      }
    })
    .filter((href) => href));

  // Get text of clickable elements
  const clickableElementsText = new Set(clickableElements
    .map((i, el) => $(el).text().trim())
    .get()
    // Remove special characters
    .map((text) => text.replace(/[^a-zA-Z0-9\s]/g, ''))
    // Remove multiple spaces
    .map((text) => text.replace(/\s+/g, ' '))
    // Remove empty strings
    .filter((text) => text.length > 2));

  return {
    href: Array.from(clickableElementsHref),
    text: Array.from(clickableElementsText),
  };
}

export function getCssClasses(rawBody) {
  const $ = cheerio.load(rawBody);

  // Remove header and footer tags
  $('header, footer').remove();

  const allClasses = new Set();
  const allBlocks = new Set();

  $('[class]').each((i, el) => {
    const classAttr = $(el).attr('class');
    if (classAttr) {
      const classes = classAttr.trim().split(/\s+/);

      // If one of the classes is block, add to the allBlocks list
      if (classes.some((cls) => cls === 'block')) {
        allBlocks.add(classAttr);
      }

      classes.forEach((cls) => {
        allClasses.add(cls);
      });
    }
  });

  return [Array.from(allClasses).sort(), Array.from(allBlocks).sort()];
}
