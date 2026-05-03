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
 * Per-status-code configuration for LLM error pages Opportunities.
 * Drives the title, description, and guided remediation steps shown in the UI.
 *
 * Keys: 404 | 403 | '5xx'
 */
const OPPORTUNITY_CONFIG = {
  404: {
    title: 'LLM Agents Hitting Missing Pages (404)',
    description: 'LLM agents are requesting pages that no longer exist. '
      + 'These 404 errors reduce content discoverability and degrade AI-powered experiences. '
      + 'AI-suggested alternative URLs are provided for each broken page.',
    guidance: {
      steps: [
        'Review the list of URLs returning 404 errors to LLM agents',
        'Check AI-suggested alternative URLs for each broken page',
        'Implement redirects from broken URLs to the best matching alternatives',
        'Prioritise fixes for high-traffic URLs (ranked by LLM agent hit count)',
        'Monitor 404 recovery after redirects are deployed',
      ],
    },
  },
  403: {
    title: 'LLM Agents Blocked by Access Restrictions (403)',
    description: 'LLM agents are being blocked from accessing pages due to access control rules. '
      + 'These 403 errors may prevent AI tools from indexing or referencing your content.',
    guidance: {
      steps: [
        'Review the list of URLs returning 403 errors to LLM agents',
        'Determine whether the access restriction is intentional for each URL',
        'Update robots.txt or access control rules to allow legitimate LLM agent access',
        'Verify LLM agent user agents are correctly identified in your access rules',
      ],
    },
  },
  '5xx': {
    title: 'LLM Agents Encountering Server Errors (5xx)',
    description: 'LLM agents are hitting server-side errors on your site. '
      + 'These failures prevent AI tools from accessing your content reliably.',
    guidance: {
      steps: [
        'Review the list of URLs returning 5xx errors to LLM agents',
        'Investigate server logs for the affected URLs to identify root causes',
        'Prioritise fixes for high-traffic URLs (ranked by LLM agent hit count)',
        'Monitor error rates after server-side fixes are deployed',
      ],
    },
  },
};

/**
 * Creates the Opportunity data payload for a given LLM error status code bucket.
 *
 * Signature matches the llm-blocked mapper pattern: receives a props object whose
 * fields are passed as the 6th argument to convertToOpportunity.
 *
 * @param {Object} props
 * @param {number|string} props.statusCode - The HTTP status bucket: 404, 403, or '5xx'.
 * @param {number} props.totalErrors - Total number of unique error URLs in this bucket.
 * @returns {Object} Opportunity data object ready for convertToOpportunity.
 */
export function createOpportunityData({ statusCode, totalErrors }) {
  const config = OPPORTUNITY_CONFIG[statusCode];
  return {
    origin: 'AUTOMATION',
    title: config.title,
    description: config.description,
    guidance: config.guidance,
    tags: ['isElmo', 'llm', 'Availability'],
    data: { statusCode, totalErrors },
  };
}
