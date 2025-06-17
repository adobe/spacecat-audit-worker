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

/* c8 ignore start */
import { BaseProvider } from '../providers/base-provider.js';

export const DEFAULT_PATTERNS = [
  {
    name: 'Robots',
    pattern: '.*/robots\\.txt$',
  },
  {
    name: 'Sitemap',
    pattern: '.*/sitemap.*\\.xml$',
  },
];

export const DOMAIN_SPECIFIC_PATTERNS = {
  bulk_com: [
    {
      name: 'Homepage',
      pattern: '.*/[a-z]{2}/$',
    },
    {
      name: 'Product Detail Page',
      pattern: '.*/products/.*',
    },
    {
      name: 'The Core Blog',
      pattern: '.*/the-core/.*',
    },
    ...DEFAULT_PATTERNS,
    {
      name: 'Product Listing Page',
      pattern: '.*/.*',
    },
  ],
};

export const FALLBACK_CASE_STATEMENT = `
  CASE 
    WHEN url LIKE '%robots%' THEN 'Robots'
    WHEN url LIKE '%sitemap%' THEN 'Sitemap'
    ELSE 'Uncategorized'
  END`;

function getPatterns(domain) {
  return DOMAIN_SPECIFIC_PATTERNS[domain] || DEFAULT_PATTERNS;
}

function buildCaseConditions(patterns) {
  return patterns
    .map((pattern) => `      WHEN REGEXP_LIKE(url, '${pattern.pattern}') THEN '${pattern.name}'`)
    .join('\n');
}

export function generatePageTypeCaseStatement(patterns) {
  if (!patterns || patterns.length === 0) {
    return FALLBACK_CASE_STATEMENT;
  }

  const caseConditions = buildCaseConditions(patterns);

  return `CASE
${caseConditions}
      ELSE 'Uncategorized'
    END`;
}

export function getPageTypePatterns(site) {
  const domain = site ? BaseProvider.extractCustomerDomain(site) : 'default';
  return getPatterns(domain);
}

/* c8 ignore end */
