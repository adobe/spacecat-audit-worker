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
 * Frequency Analysis Athena Queries
 * Supports agentic request pattern analysis for pre-filtered agentic data
 */

export const frequencyAnalysisQueries = {
  /**
   * Request frequency patterns for agentic traffic by agent type
   */
  hourlyFrequencyPatterns: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        agentic_type,
        request_user_agent,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        ROUND(COUNT(*) / 60.0, 2) as requests_per_minute,
        ROUND(COUNT(DISTINCT url) * 100.0 / COUNT(*), 2) as url_diversity_percentage,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        CASE 
          WHEN COUNT(*) >= 1000 THEN 'Very High (1000+/hour)'
          WHEN COUNT(*) >= 500 THEN 'High (500-999/hour)'
          WHEN COUNT(*) >= 100 THEN 'Medium (100-499/hour)'
          WHEN COUNT(*) >= 10 THEN 'Low (10-99/hour)'
          ELSE 'Very Low (<10/hour)'
        END as frequency_category
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY agentic_type, request_user_agent
      ORDER BY total_requests DESC
    `;
  },

  /**
   * Agentic behavior analysis - frequency patterns by agent type
   */
  agenticFrequencyAnalysis: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        agentic_type,
        CASE 
          WHEN agentic_type = 'chatgpt' AND request_user_agent LIKE '%ChatGPT-User%' THEN 'ChatGPT User Mode'
          WHEN agentic_type = 'chatgpt' THEN 'ChatGPT Bot'
          WHEN agentic_type = 'perplexity' AND request_user_agent LIKE '%Perplexity-User%' THEN 'Perplexity User Mode'
          WHEN agentic_type = 'perplexity' THEN 'Perplexity Bot'
          WHEN agentic_type = 'claude' THEN 'Claude'
          WHEN agentic_type = 'gemini' THEN 'Google AI'
          ELSE CONCAT(UPPER(SUBSTRING(agentic_type, 1, 1)), SUBSTRING(agentic_type, 2))
        END as agent_display_name,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls_accessed,
        COUNT(DISTINCT geo_country) as unique_countries,
        ROUND(COUNT(*) / 60.0, 2) as requests_per_minute,
        ROUND(COUNT(DISTINCT url) * 100.0 / COUNT(*), 2) as url_diversity_ratio,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        CASE 
          WHEN COUNT(*) / 60.0 >= 50 THEN 'Aggressive (50+/min)'
          WHEN COUNT(*) / 60.0 >= 10 THEN 'Moderate (10-49/min)'
          WHEN COUNT(*) / 60.0 >= 1 THEN 'Light (1-9/min)'
          ELSE 'Minimal (<1/min)'
        END as request_intensity
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY agentic_type, 
        CASE 
          WHEN agentic_type = 'chatgpt' AND request_user_agent LIKE '%ChatGPT-User%' THEN 'ChatGPT User Mode'
          WHEN agentic_type = 'chatgpt' THEN 'ChatGPT Bot'
          WHEN agentic_type = 'perplexity' AND request_user_agent LIKE '%Perplexity-User%' THEN 'Perplexity User Mode'
          WHEN agentic_type = 'perplexity' THEN 'Perplexity Bot'
          WHEN agentic_type = 'claude' THEN 'Claude'
          WHEN agentic_type = 'gemini' THEN 'Google AI'
          ELSE CONCAT(UPPER(SUBSTRING(agentic_type, 1, 1)), SUBSTRING(agentic_type, 2))
        END
      ORDER BY total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * URL access patterns - identify popular vs rare URLs accessed by agentic traffic
   */
  urlAccessPatterns: (hourToProcess, tableName = 'formatted_logs', limit = 100) => {
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
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        CASE 
          WHEN COUNT(*) >= 100 THEN 'High Traffic'
          WHEN COUNT(*) >= 20 THEN 'Medium Traffic'
          WHEN COUNT(*) >= 5 THEN 'Low Traffic'
          ELSE 'Rare Access'
        END as traffic_level,
        -- Most common agentic type accessing this URL
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
   * Time-based request distribution within the hour for agentic traffic
   */
  minuteByMinuteDistribution: (hourToProcess, tableName = 'formatted_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        MINUTE(PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as minute_of_hour,
        COUNT(*) as total_requests,
        COUNT(DISTINCT agentic_type) as unique_agent_types,
        COUNT(DISTINCT url) as unique_urls,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as forbidden_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        -- Breakdown by agentic type
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        COUNT(CASE WHEN agentic_type = 'gemini' THEN 1 END) as gemini_requests
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY minute_of_hour
      ORDER BY minute_of_hour
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },
};
/* c8 ignore stop */
