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

export const geographicAnalysisQueries = {
  /**
   * Agentic traffic by country for a specific hour
   */
  hourlyByCountry: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        geo_country,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_traffic,
        -- Breakdown by agentic type
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND geo_country IS NOT NULL
      GROUP BY geo_country
      ORDER BY total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Agentic traffic by agent type and country
   */
  agenticByCountry: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        geo_country,
        agentic_type,
        COUNT(*) as requests,
        COUNT(DISTINCT url) as unique_urls_accessed,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY geo_country), 2) as percentage_of_country_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND geo_country IS NOT NULL
      GROUP BY geo_country, agentic_type
      ORDER BY geo_country, requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Country-specific URL patterns for agentic traffic
   */
  countryUrlPatterns: (hourToProcess, tableName = 'formatted_logs', limit = 100) => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        geo_country,
        url,
        host,
        COUNT(*) as request_count,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        -- Most common agentic type for this country/URL combination
        (SELECT agentic_type 
         FROM cdn_logs.${tableName} sub 
         WHERE sub.geo_country = main.geo_country 
           AND sub.url = main.url 
           ${whereClause.replace('WHERE', 'AND')}
         GROUP BY agentic_type 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as primary_agent_type
      FROM cdn_logs.${tableName} main
      ${whereClause}
        AND geo_country IS NOT NULL
      GROUP BY geo_country, url, host
      ORDER BY request_count DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Geographic patterns over time for agentic traffic
   * Note: For longer-term analysis, consider using partition filtering
   */
  countryPatternsOverTime: (startDate, endDate, tableName = 'formatted_logs') => `
      SELECT 
        DATE_TRUNC('hour', PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as hour,
        geo_country,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
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
        AND geo_country IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `,

  /**
   * Top countries by agentic type
   */
  topCountriesByAgentType: (hourToProcess, agentType, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        geo_country,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_agent_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND geo_country IS NOT NULL
        AND agentic_type = '${agentType}'
      GROUP BY geo_country
      ORDER BY total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },
};
/* c8 ignore stop */
