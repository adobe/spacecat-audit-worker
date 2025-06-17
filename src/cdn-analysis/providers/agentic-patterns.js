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
export const AGENTIC_TECH_MAPPING = [
  { name: 'chatgpt', pattern: '%ChatGPT%' },
  { name: 'gptbot', pattern: '%GPTBot%' },
  { name: 'perplexity', pattern: '%Perplexity%' },
  { name: 'claude', pattern: '%Claude%' },
  { name: 'anthropic', pattern: '%Anthropic%' },
];

/**
 * Builds the WHERE clause that detects any of the mapped agentic patterns.
 * @param {string} userAgentField – the column to inspect
 */
export function buildDetectionClause(userAgentField) {
  const clauses = AGENTIC_TECH_MAPPING
    .map(({ pattern }) => `${userAgentField} LIKE '${pattern}'`)
    .join(' OR\n    ');
  return `(${clauses})`;
}
/* c8 ignore end */
