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
export const AKAMAI_AGENTIC_PATTERNS = {
  TYPE_CLASSIFICATION: `CASE 
    WHEN ua LIKE '%ChatGPT%' THEN 'ChatGPT'
    WHEN ua LIKE '%GPTBot%' THEN 'GPTBot'
    WHEN ua LIKE '%Perplexity%' THEN 'Perplexity'
    WHEN ua LIKE '%Claude%' THEN 'Claude'
    WHEN ua LIKE '%Anthropic%' THEN 'Anthropic'
    ELSE 'Other'
  END`,

  DETECTION_CLAUSE: `(ua LIKE '%ChatGPT%' OR 
                     ua LIKE '%Perplexity%' OR 
                     ua LIKE '%Claude%' OR
                     ua LIKE '%GPTBot%' OR
                     ua LIKE '%Anthropic%')`,

  COUNT_AGENTIC: 'COUNT(*)',
  USER_AGENT_FIELD: 'ua',
};

/**
 * Maps raw Akamai log fields to standardized fields for filtered logs
 */
export function mapAkamaiFieldsForUnload() {
  return {
    selectFields: [
      'reqtimesec as timestamp',
      'country as geo_country',
      'reqhost as host',
      'CONCAT(reqpath, CASE WHEN querystr IS NOT NULL AND querystr != \'\' THEN CONCAT(\'?\', querystr) ELSE \'\' END) as url',
      'reqmethod as request_method',
      'proto as request_protocol',
      'ua as request_user_agent',
      `CASE 
        WHEN statuscode < '400' THEN 'HIT'
        ELSE 'ERROR'
      END as response_state`,
      'statuscode as response_status',
      `CASE 
        WHEN statuscode = '200' THEN 'OK'
        WHEN statuscode = '404' THEN 'Not Found'
        WHEN statuscode >= '500' THEN 'Server Error'
        ELSE 'Other'
      END as response_reason`,
      'referer as request_referer',
      `${AKAMAI_AGENTIC_PATTERNS.TYPE_CLASSIFICATION} as agentic_type`,
    ].join(',\n          '),
  };
}
/* c8 ignore stop */
