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
import { getHourlyPartitionFilter } from './query-helpers.js';

/**
 * Error Analysis for CDN logs
 * Analyzes HTTP error patterns by source (AI bots vs humans)
 */

export const errorAnalysisQueries = {
  /**
   * Generate SQL query for hourly error analysis
   */
  hourlyErrors(hourToProcess, tableName = 'raw_logs') {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
        SELECT 
          response_status,
          CASE 
            WHEN LOWER(request_user_agent) LIKE '%chatgpt%' 
              OR LOWER(request_user_agent) LIKE '%gpt-%'
              OR LOWER(request_user_agent) LIKE '%openai%'
              OR LOWER(request_user_agent) LIKE '%perplexity%'
              OR LOWER(request_user_agent) LIKE '%claude%'
              OR LOWER(request_user_agent) LIKE '%anthropic%'
              OR LOWER(request_user_agent) LIKE '%gemini%'
              OR LOWER(request_user_agent) LIKE '%bard%'
              OR LOWER(request_user_agent) LIKE '%bing%'
              OR LOWER(request_user_agent) LIKE '%copilot%'
            THEN 'AI Bot'
            ELSE 'Human'
          END as source_type,
          geo_country,
          url,
          request_user_agent,
          COUNT(*) as error_count
        FROM cdn_logs.${tableName}
        ${whereClause}
          AND response_status >= 400
        GROUP BY 
          response_status,
          CASE 
            WHEN LOWER(request_user_agent) LIKE '%chatgpt%' 
              OR LOWER(request_user_agent) LIKE '%gpt-%'
              OR LOWER(request_user_agent) LIKE '%openai%'
              OR LOWER(request_user_agent) LIKE '%perplexity%'
              OR LOWER(request_user_agent) LIKE '%claude%'
              OR LOWER(request_user_agent) LIKE '%anthropic%'
              OR LOWER(request_user_agent) LIKE '%gemini%'
              OR LOWER(request_user_agent) LIKE '%bard%'
              OR LOWER(request_user_agent) LIKE '%bing%'
              OR LOWER(request_user_agent) LIKE '%copilot%'
            THEN 'AI Bot'
            ELSE 'Human'
          END,
          geo_country,
          url,
          request_user_agent
        ORDER BY error_count DESC;
      `;
  },
};
/* c8 ignore stop */
