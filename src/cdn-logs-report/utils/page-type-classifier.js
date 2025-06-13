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
import { extractCustomerDomain } from './aws-utils.js';
import { DEFAULT_PATTERNS, DOMAIN_SPECIFIC_PATTERNS, FALLBACK_CASE_STATEMENT } from '../constants/index.js';

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
  const domain = site ? extractCustomerDomain(site) : 'default';
  return getPatterns(domain);
}

/* c8 ignore end */
