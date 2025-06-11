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
 * Updated for pre-filtered agentic data with agentic_type field
 */
export const AGENTIC_PATTERNS = {
  // Since data is pre-filtered, we can use agentic_type directly
  TYPE_FROM_FIELD: 'agentic_type',

  // Keep for backwards compatibility with mixed data sources
  DETECTION_CLAUSE: `(request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' OR
                     request_user_agent LIKE '%Anthropic%' OR
                     request_user_agent LIKE '%GoogleOther%' OR
                     request_user_agent LIKE '%Bard%' OR
                     request_user_agent LIKE '%Gemini%' OR
                     request_user_agent LIKE '%BingBot%')`,

  // Updated to use agentic_type field directly
  TYPE_CLASSIFICATION: 'agentic_type',

  // For agentic-only data, all records are agentic
  IS_AGENTIC_FLAG: "'true'",

  // For agentic-only data, count all records
  COUNT_AGENTIC: 'COUNT(*)',
};

/**
 * User type classification for agentic-only data
 * Since all data is agentic, we classify by agentic_type
 */
export const USER_TYPE_CLASSIFICATION = 'agentic_type';

// Add convenience property for counting
USER_TYPE_CLASSIFICATION.COUNT_AGENTIC = AGENTIC_PATTERNS.COUNT_AGENTIC;

/**
 * Standard query performance optimization settings
 */
export const QUERY_LIMITS = {
  DEFAULT_LIMIT: 1000,
  SMALL_LIMIT: 100,
  LARGE_LIMIT: 5000,
};
/* c8 ignore stop */
