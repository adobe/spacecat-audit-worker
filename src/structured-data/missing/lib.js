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