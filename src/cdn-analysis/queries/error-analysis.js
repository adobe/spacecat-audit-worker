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
 * Error Analysis for CDN logs
 * Analyzes HTTP error patterns by source (AI bots vs humans)
 */

export const errorAnalysisQueries = {
  /**
     * Generate SQL query for hourly error analysis
     */
  hourlyErrors(hourToProcess, tableName = 'raw_logs') {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

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
        WHERE timestamp >= '${startHour}'
          AND timestamp < '${endHour}'
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
        ORDER BY error_count DESC
        LIMIT 1000;
      `;
  },
};
/* c8 ignore stop */
