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
