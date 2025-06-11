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
 * URL-Status Analysis Athena Queries
 * Simplified analysis of URL and StatusCode breakdown for agentic traffic
 */

export const urlStatusAnalysisQueries = {
  /**
   * Hourly URL-Status analysis for agentic traffic
   */
  hourlyUrlStatus: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        url,
        response_status as status_code,
        COUNT(*) as count,
        -- Additional context
        COUNT(DISTINCT agentic_type) as unique_platforms,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        -- Platform breakdown for this URL-Status combination
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests,
        -- Percentage of total traffic for this combination
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 4) as percentage_of_total
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      GROUP BY url, response_status
      ORDER BY count DESC
    `;
  },

  /**
   * URL status code distribution summary
   */
  urlStatusDistribution: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        url,
        COUNT(*) as total_requests,
        -- Status code breakdown
        COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) as status_2xx,
        COUNT(CASE WHEN response_status BETWEEN 300 AND 399 THEN 1 END) as status_3xx,
        COUNT(CASE WHEN response_status = 401 THEN 1 END) as status_401,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as status_403,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as status_404,
        COUNT(CASE WHEN response_status BETWEEN 500 AND 599 THEN 1 END) as status_5xx,
        -- Success rate
        ROUND(COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) * 100.0 / COUNT(*), 2) as success_rate_percent,
        -- Error rate
        ROUND(COUNT(CASE WHEN response_status >= 400 THEN 1 END) * 100.0 / COUNT(*), 2) as error_rate_percent,
        -- Most common status code for this URL
        (SELECT response_status 
         FROM cdn_logs.${tableName} sub 
         WHERE sub.url = main.url 
         ${whereClause.replace('WHERE', 'AND')}
         AND sub.agentic_type IS NOT NULL
         GROUP BY response_status 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as most_common_status
      FROM cdn_logs.${tableName} main
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      GROUP BY url
      ORDER BY total_requests DESC
    `;
  },

  /**
   * Status code analysis across all URLs
   */
  statusCodeSummaryAcrossUrls: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        response_status as status_code,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT agentic_type) as unique_platforms,
        -- Platform breakdown for this status code
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests,
        -- Percentage of total traffic
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_total,
        -- Top URL for this status code
        (SELECT url 
         FROM cdn_logs.${tableName} sub 
         WHERE sub.response_status = main.response_status 
         ${whereClause.replace('WHERE', 'AND')}
         AND sub.agentic_type IS NOT NULL
         GROUP BY url 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as top_url_for_status
      FROM cdn_logs.${tableName} main
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      GROUP BY response_status
      ORDER BY total_requests DESC
    `;
  },

  /**
   * Error URLs analysis (4xx and 5xx only)
   */
  errorUrlsAnalysis: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        url,
        response_status as status_code,
        COUNT(*) as error_count,
        COUNT(DISTINCT agentic_type) as unique_platforms,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        -- Platform breakdown for errors
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_errors,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_errors,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_errors,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_errors,
        -- Error type classification
        CASE 
          WHEN response_status BETWEEN 400 AND 499 THEN 'CLIENT_ERROR'
          WHEN response_status BETWEEN 500 AND 599 THEN 'SERVER_ERROR'
          ELSE 'OTHER'
        END as error_type
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND response_status >= 400
      GROUP BY url, response_status
      ORDER BY error_count DESC
    `;
  },

  /**
   * Success URLs analysis (2xx only)
   */
  successUrlsAnalysis: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        url,
        response_status as status_code,
        COUNT(*) as success_count,
        COUNT(DISTINCT agentic_type) as unique_platforms,
        -- Platform breakdown for successful requests
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_success,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_success,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_success,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_success,
        -- Percentage of total successful requests
        ROUND(COUNT(*) * 100.0 / 
              SUM(COUNT(*)) OVER (), 2) as percentage_of_success_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IS NOT NULL 
      AND agentic_type != ''
      AND response_status BETWEEN 200 AND 299
      GROUP BY url, response_status
      ORDER BY success_count DESC
    `;
  },
};
/* c8 ignore stop */
