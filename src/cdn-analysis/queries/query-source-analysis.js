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
 * Query Source Analysis Athena Queries
 * Analysis of UTM source parameters in URLs for agentic traffic
 */

export const querySourceAnalysisQueries = {
  /**
   * Hourly query source analysis for agentic traffic
   * Extracts utm_source parameter from URLs
   */
  hourlyQuerySource: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
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
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND url LIKE '%utm_source=%'
      GROUP BY url, 
               CASE 
                 WHEN url LIKE '%utm_source=%' THEN 
                   REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1)
                 ELSE NULL 
               END,
               agentic_type
      ORDER BY agentic_traffic_count DESC
    `;
  },

  /**
   * UTM source summary analysis
   */
  utmSourceSummary: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1) as utm_source,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT agentic_type) as unique_platforms,
        -- Platform breakdown
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests,
        -- Success rate
        ROUND(COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) * 100.0 / COUNT(*), 2) as success_rate_percent
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND url LIKE '%utm_source=%'
      GROUP BY REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1)
      ORDER BY total_requests DESC
    `;
  },

  /**
   * Platform mapping analysis based on UTM source
   */
  platformUtmMapping: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        agentic_type as detected_platform,
        REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1) as utm_source,
        COUNT(*) as request_count,
        COUNT(DISTINCT url) as unique_urls,
        -- Check alignment between detected platform and UTM source
        CASE 
          WHEN agentic_type = 'chatgpt' AND REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1) LIKE '%chatgpt%' THEN 'ALIGNED'
          WHEN agentic_type = 'perplexity' AND REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1) LIKE '%perplexity%' THEN 'ALIGNED'
          WHEN agentic_type = 'claude' AND REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1) LIKE '%claude%' THEN 'ALIGNED'
          ELSE 'MISALIGNED'
        END as platform_utm_alignment
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND url LIKE '%utm_source=%'
      GROUP BY agentic_type, REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1)
      ORDER BY request_count DESC
    `;
  },

  /**
   * All UTM parameters extraction (not just utm_source)
   */
  allUtmParameters: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        url,
        -- Extract all common UTM parameters
        REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1) as utm_source,
        REGEXP_EXTRACT(url, 'utm_medium=([^&]+)', 1) as utm_medium,
        REGEXP_EXTRACT(url, 'utm_campaign=([^&]+)', 1) as utm_campaign,
        REGEXP_EXTRACT(url, 'utm_term=([^&]+)', 1) as utm_term,
        REGEXP_EXTRACT(url, 'utm_content=([^&]+)', 1) as utm_content,
        agentic_type,
        COUNT(*) as request_count
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND (url LIKE '%utm_source=%' OR url LIKE '%utm_medium=%' OR url LIKE '%utm_campaign=%')
      GROUP BY url, agentic_type,
               REGEXP_EXTRACT(url, 'utm_source=([^&]+)', 1),
               REGEXP_EXTRACT(url, 'utm_medium=([^&]+)', 1),
               REGEXP_EXTRACT(url, 'utm_campaign=([^&]+)', 1),
               REGEXP_EXTRACT(url, 'utm_term=([^&]+)', 1),
               REGEXP_EXTRACT(url, 'utm_content=([^&]+)', 1)
      ORDER BY request_count DESC
    `;
  },
};
/* c8 ignore stop */
