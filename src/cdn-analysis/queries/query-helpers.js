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
/**
 * Common query helpers for CDN analysis
 * Provides consistent partition filtering and query patterns
 */

/**
 * Generate partition WHERE clause for hourly data
 * Uses partition pruning for optimal performance
 */
export function getHourlyPartitionFilter(hourToProcess) {
  // Use UTC methods since CDN logs are stored in UTC folders
  const year = hourToProcess.getUTCFullYear();
  const month = String(hourToProcess.getUTCMonth() + 1).padStart(2, '0');
  const day = String(hourToProcess.getUTCDate()).padStart(2, '0');
  const hour = String(hourToProcess.getUTCHours()).padStart(2, '0');

  return {
    year,
    month,
    day,
    hour,
    whereClause: `WHERE year = '${year}' AND month = '${month}' AND day = '${day}' AND hour = '${hour}'`,
    hourLabel: `${year}-${month}-${day}T${hour}:00:00Z`, // Added Z to indicate UTC
  };
}

/**
 * Common agentic AI detection patterns
 */
export const AGENTIC_PATTERNS = {
  DETECTION_CLAUSE: `(request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' OR
                     request_user_agent LIKE '%Anthropic%' OR
                     request_user_agent LIKE '%GoogleOther%' OR
                     request_user_agent LIKE '%Bard%' OR
                     request_user_agent LIKE '%Gemini%' OR
                     request_user_agent LIKE '%BingBot%')`,

  TYPE_CLASSIFICATION: `CASE 
    WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' THEN 'chatgpt'
    WHEN request_user_agent LIKE '%Perplexity%' THEN 'perplexity'
    WHEN request_user_agent LIKE '%Claude%' OR request_user_agent LIKE '%Anthropic%' THEN 'claude'
    WHEN request_user_agent LIKE '%GoogleOther%' OR request_user_agent LIKE '%Bard%' OR request_user_agent LIKE '%Gemini%' THEN 'gemini'
    WHEN request_user_agent LIKE '%BingBot%' OR request_user_agent LIKE '%msnbot%' THEN 'bing'
    ELSE 'human'
  END`,

  IS_AGENTIC_FLAG: `CASE 
    WHEN request_user_agent LIKE '%ChatGPT%' OR 
         request_user_agent LIKE '%Perplexity%' OR 
         request_user_agent LIKE '%Claude%' OR
         request_user_agent LIKE '%GPTBot%' OR
         request_user_agent LIKE '%Anthropic%' OR
         request_user_agent LIKE '%GoogleOther%' OR
         request_user_agent LIKE '%Bard%' OR
         request_user_agent LIKE '%Gemini%' OR
         request_user_agent LIKE '%BingBot%' THEN 'true'
    ELSE 'false'
  END`,

  COUNT_AGENTIC: `COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                               request_user_agent LIKE '%Perplexity%' OR 
                               request_user_agent LIKE '%Claude%' OR
                               request_user_agent LIKE '%GPTBot%' THEN 1 END)`,
};

/**
 * Common user agent type classification
 */
export const USER_TYPE_CLASSIFICATION = `CASE 
  WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' 
       OR request_user_agent LIKE '%Perplexity%' OR request_user_agent LIKE '%Claude%'
       OR request_user_agent LIKE '%Bard%' OR request_user_agent LIKE '%Gemini%' THEN 'Agentic AI'
  WHEN request_user_agent LIKE '%bot%' OR request_user_agent LIKE '%Bot%' 
       OR request_user_agent LIKE '%spider%' OR request_user_agent LIKE '%Spider%'
       OR request_user_agent LIKE '%crawler%' OR request_user_agent LIKE '%Crawler%' THEN 'Traditional Bot'
  WHEN request_user_agent LIKE '%Mozilla%' AND request_user_agent LIKE '%Chrome%' THEN 'Human Browser'
  ELSE 'Unknown'
END`;

/**
 * Standard query performance optimization settings
 */
export const QUERY_LIMITS = {
  DEFAULT_LIMIT: 1000,
  SMALL_LIMIT: 100,
  LARGE_LIMIT: 5000,
};
/* c8 ignore stop */
