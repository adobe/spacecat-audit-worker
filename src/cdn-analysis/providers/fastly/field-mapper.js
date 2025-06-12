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
export const FASTLY_AGENTIC_PATTERNS = {
  TYPE_CLASSIFICATION: `CASE 
    WHEN request_user_agent LIKE '%ChatGPT%' THEN 'ChatGPT'
    WHEN request_user_agent LIKE '%GPTBot%' THEN 'GPTBot'
    WHEN request_user_agent LIKE '%Perplexity%' THEN 'Perplexity'
    WHEN request_user_agent LIKE '%Claude%' THEN 'Claude'
    WHEN request_user_agent LIKE '%Anthropic%' THEN 'Anthropic'
    ELSE 'Other'
  END`,

  DETECTION_CLAUSE: `(request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' OR
                     request_user_agent LIKE '%Anthropic%')`,

  COUNT_AGENTIC: 'COUNT(*)',
  USER_AGENT_FIELD: 'request_user_agent',
};

/**
 * Maps raw Fastly log fields to standardized fields for filtered logs
 */
export function mapFastlyFieldsForUnload() {
  return {
    selectFields: [
      'timestamp',
      'geo_country',
      'host',
      'url',
      'request_method',
      'request_protocol',
      'request_user_agent',
      'response_state',
      'response_status',
      'response_reason',
      'request_referer',
      `${FASTLY_AGENTIC_PATTERNS.TYPE_CLASSIFICATION} as agentic_type`,
    ].join(',\n          '),
  };
}
/* c8 ignore stop */
