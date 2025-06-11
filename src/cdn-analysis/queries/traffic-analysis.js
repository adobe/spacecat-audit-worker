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
 * Traffic Analysis Athena Queries
 * Supports agentic traffic patterns, request counts, and success rates
 */

export const trafficAnalysisQueries = {
  /**
   * Hourly agentic traffic analysis for a specific hour
   */
  hourlyTraffic: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT host) as unique_hosts,
        COUNT(DISTINCT geo_country) as unique_countries,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status = 503 THEN 1 END) as service_unavailable_requests,
        -- Breakdown by agentic type
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests
      FROM cdn_logs.${tableName} 
      ${whereClause}
    `;
  },

  /**
   * Weekly agentic traffic analysis
   * Note: Multi-day queries use timestamp filtering (slower but necessary)
   */
  weeklyTraffic: (startDate, endDate, tableName = 'formatted_logs') => `
      SELECT 
        DATE_TRUNC('week', PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as week,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT host) as unique_hosts,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        -- Breakdown by agentic type
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests
      FROM cdn_logs.${tableName} 
      WHERE timestamp >= '${startDate.toISOString()}'
        AND timestamp < '${endDate.toISOString()}'
      GROUP BY 1 
      ORDER BY 1
    `,

  /**
   * Top URLs by agentic traffic volume
   */
  topUrlsByTraffic: (hourToProcess, tableName = 'formatted_logs', limit = 50) => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        url,
        host,
        COUNT(*) as total_requests,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_count,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_count,
        -- Most common agentic type for this URL
        (SELECT agentic_type 
         FROM cdn_logs.${tableName} sub 
         WHERE sub.url = main.url ${whereClause.replace('WHERE', 'AND')}
         GROUP BY agentic_type 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as primary_agent_type
      FROM cdn_logs.${tableName} main
      ${whereClause}
      GROUP BY url, host
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Agentic traffic by hour of day pattern
   * Note: Multi-day queries use timestamp filtering (slower but necessary)
   */
  trafficByHour: (startDate, endDate, tableName = 'formatted_logs') => `
      SELECT 
        HOUR(PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as hour_of_day,
        COUNT(*) as total_requests,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        -- Breakdown by agentic type
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests
      FROM cdn_logs.${tableName} 
      WHERE timestamp >= '${startDate.toISOString()}'
        AND timestamp < '${endDate.toISOString()}'
      GROUP BY 1 
      ORDER BY 1
    `,

  /**
   * Agentic traffic by type analysis
   */
  trafficByAgentType: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        agentic_type,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT host) as unique_hosts,
        COUNT(DISTINCT geo_country) as unique_countries,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status >= 500 THEN 1 END) as server_error_requests,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_traffic,
        ROUND(COUNT(*) / 60.0, 2) as requests_per_minute
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY agentic_type
      ORDER BY total_requests DESC
    `;
  },
};
/* c8 ignore stop */
