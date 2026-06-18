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

const COMMON_TAGS = ['isElmo', 'llm', 'Availability'];

const OPPORTUNITY_CONFIG = {
  404: {
    title: 'LLM Agents Hitting Missing Pages (404)',
    description: 'LLM agents are encountering 404 (Not Found) errors on these URLs, '
      + 'preventing them from retrieving content for users.',
    guidance: {
      steps: [
        'Review the broken URLs and identify the most appropriate replacement.',
        'Apply the AI-suggested redirect or update internal links.',
        'Verify the redirect resolves correctly for both browsers and LLM agents.',
      ],
    },
  },
  403: {
    title: 'LLM Agents Blocked by Access Restrictions (403)',
    description: 'LLM agents are receiving 403 (Forbidden) responses, indicating that '
      + 'access policies, robots rules, or authentication are blocking content retrieval.',
    guidance: {
      steps: [
        'Check robots.txt, firewall rules, and bot-protection settings for these URLs.',
        'Decide whether the content should be accessible to LLM agents.',
        'If accessible, relax the rule. If protected, document the policy explicitly.',
      ],
    },
  },
  '5xx': {
    title: 'LLM Agents Encountering Server Errors (5xx)',
    description: 'LLM agents are receiving server-side errors (5xx) on these URLs, '
      + 'indicating availability or backend issues that block content retrieval.',
    guidance: {
      steps: [
        'Investigate server logs for the affected URLs.',
        'Check upstream dependencies, deployments, and capacity for the time of the errors.',
        'Resolve the underlying failure and re-validate the URLs.',
      ],
    },
  },
};

export function createOpportunityData({ statusCode, totalErrors }) {
  const config = OPPORTUNITY_CONFIG[statusCode];
  return {
    origin: 'AUTOMATION',
    title: config.title,
    description: config.description,
    guidance: config.guidance,
    tags: COMMON_TAGS,
    data: { statusCode, totalErrors },
  };
}
