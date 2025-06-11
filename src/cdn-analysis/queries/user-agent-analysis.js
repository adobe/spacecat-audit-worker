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
 * User Agent Analysis Athena Queries
 * Analyzes agentic traffic patterns from pre-filtered agentic data
 */

export const userAgentAnalysisQueries = {
  /**
   * Hourly user agent analysis for agentic traffic
   */
  hourlyUserAgents: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        url,
        request_user_agent,
        agentic_type,
        response_status,
        COUNT(*) as count,
        host,
        geo_country
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY url, request_user_agent, agentic_type, response_status, host, geo_country
      ORDER BY count DESC
    `;
  },

  /**
   * Agentic traffic breakdown by type
   */
  agenticBreakdown: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        agentic_type,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status >= 500 THEN 1 END) as server_error_requests,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY agentic_type
      ORDER BY total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Top user agents by request count (within agentic traffic)
   */
  topUserAgents: (hourToProcess, tableName = 'formatted_logs', limit = 100) => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        request_user_agent,
        agentic_type,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY request_user_agent, agentic_type
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;
  },

  /**
   * User agent patterns for a specific URL (within agentic traffic)
   */
  userAgentsByUrl: (hourToProcess, targetUrl, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        request_user_agent,
        agentic_type,
        response_status,
        COUNT(*) as count,
        geo_country
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND url = '${targetUrl}'
      GROUP BY request_user_agent, agentic_type, response_status, geo_country
      ORDER BY count DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Agentic agent version analysis
   */
  agentVersionAnalysis: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        agentic_type,
        request_user_agent,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        -- Extract version information where possible
        CASE 
          WHEN agentic_type = 'chatgpt' AND request_user_agent LIKE '%GPTBot/%' THEN 
            REGEXP_EXTRACT(request_user_agent, 'GPTBot/([0-9.]+)', 1)
          WHEN agentic_type = 'perplexity' AND request_user_agent LIKE '%PerplexityBot/%' THEN 
            REGEXP_EXTRACT(request_user_agent, 'PerplexityBot/([0-9.]+)', 1)
          ELSE 'Unknown'
        END as agent_version
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY agentic_type, request_user_agent
      HAVING COUNT(*) >= 5  -- Filter out very low traffic agents
      ORDER BY total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },
};
/* c8 ignore stop */
