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
import { getHourlyPartitionFilter, createUnloadQuery } from './query-helpers.js';

/**
 * Query Source Analysis Athena Queries
 * Analysis of UTM source parameters in URLs for agentic traffic
 */

export const querySourceAnalysisQueries = {
  /**
   * Hourly query source analysis for agentic traffic
   * Extracts utm_source parameter from URLs
   */
  hourlyQuerySource: (hourToProcess, tableName, s3Config) => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    const selectQuery = `
      SELECT 
        '${hourLabel}' as hour,
        url,
        -- Extract utm_source parameter using URL parsing
        CASE 
          WHEN url LIKE '%utm_source=%' THEN 
            REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1)
          ELSE NULL 
        END as query_source,
        COUNT(*) as agentic_traffic_count,
        -- Platform breakdown
        agentic_type,
        -- Status breakdown
        COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) as successful_requests,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IN ('chatgpt', 'perplexity', 'claude')
      AND (
        url LIKE '%utm_source=%chatgpt%' OR 
        url LIKE '%utm_source=%perplexity%' OR
        request_referer = 'https://chatgpt.com' OR 
        request_referer = 'https://perplexity.ai'
      )
      GROUP BY url, 
               CASE 
                 WHEN url LIKE '%utm_source=%' THEN 
                   REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1)
                 ELSE NULL 
               END,
               agentic_type
      ORDER BY agentic_traffic_count DESC
    `;

    return createUnloadQuery(selectQuery, 'querySource', hourToProcess, s3Config);
  },
};
/* c8 ignore stop */
