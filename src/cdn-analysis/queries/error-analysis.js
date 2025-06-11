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
import { getHourlyPartitionFilter, QUERY_LIMITS } from './query-helpers.js';

/**
 * Error Analysis Athena Queries
 * Analyzes error patterns in agentic traffic
 */

export const errorAnalysisQueries = {
  /**
   * Error analysis for agentic traffic by type and status
   */
  hourlyErrors: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
        SELECT 
          response_status,
          agentic_type,
          geo_country,
          url,
          request_user_agent,
          COUNT(*) as error_count,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_errors
        FROM cdn_logs.${tableName}
        ${whereClause}
          AND response_status >= 400
        GROUP BY 
          response_status,
          agentic_type,
          geo_country,
          url,
          request_user_agent
        ORDER BY error_count DESC
        LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
      `;
  },

  /**
   * Error summary by agentic type
   */
  errorsByAgentType: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        agentic_type,
        COUNT(*) as total_errors,
        COUNT(DISTINCT url) as unique_error_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_errors,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_errors,
        COUNT(CASE WHEN response_status = 429 THEN 1 END) as rate_limit_errors,
        COUNT(CASE WHEN response_status >= 500 THEN 1 END) as server_errors,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_all_errors
      FROM cdn_logs.${tableName}
      ${whereClause}
        AND response_status >= 400
      GROUP BY agentic_type
      ORDER BY total_errors DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Top error URLs by agentic traffic
   */
  topErrorUrls: (hourToProcess, tableName = 'formatted_logs', limit = 50) => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        url,
        host,
        response_status,
        COUNT(*) as error_count,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        COUNT(DISTINCT geo_country) as unique_countries,
        -- Most common agentic type causing errors for this URL
        (SELECT agentic_type 
         FROM cdn_logs.${tableName} sub 
         WHERE sub.url = main.url 
           AND sub.response_status = main.response_status 
           ${whereClause.replace('WHERE', 'AND')}
           AND sub.response_status >= 400
         GROUP BY agentic_type 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as primary_error_agent,
        -- Breakdown by agentic type
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_errors,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_errors,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_errors,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_errors
      FROM cdn_logs.${tableName} main
      ${whereClause}
        AND response_status >= 400
      GROUP BY url, host, response_status
      ORDER BY error_count DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Error patterns by time of day for agentic traffic
   */
  errorsByTimeOfDay: (startDate, endDate, tableName = 'formatted_logs') => `
      SELECT 
        HOUR(PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as hour_of_day,
        response_status,
        agentic_type,
        COUNT(*) as error_count,
        COUNT(DISTINCT url) as unique_error_urls
      FROM cdn_logs.${tableName}
      WHERE timestamp >= '${startDate.toISOString()}'
        AND timestamp < '${endDate.toISOString()}'
        AND response_status >= 400
      GROUP BY 1, 2, 3
      ORDER BY 1, error_count DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `,

  /**
   * Geographic distribution of errors for agentic traffic
   */
  errorsByCountry: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        geo_country,
        agentic_type,
        response_status,
        COUNT(*) as error_count,
        COUNT(DISTINCT url) as unique_error_urls,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY geo_country), 2) as percentage_of_country_errors
      FROM cdn_logs.${tableName}
      ${whereClause}
        AND response_status >= 400
        AND geo_country IS NOT NULL
      GROUP BY geo_country, agentic_type, response_status
      ORDER BY geo_country, error_count DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },
};
/* c8 ignore stop */
