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
 * Frequency Analysis Athena Queries
 * Supports request pattern analysis, bot vs human behavior
 */

export const frequencyAnalysisQueries = {
  /**
   * Request frequency patterns for a specific hour
   */
  hourlyFrequencyPatterns: (hourToProcess, tableName = 'raw_logs') => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        request_user_agent,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        ROUND(COUNT(*) / 60.0, 2) as requests_per_minute,
        ROUND(COUNT(DISTINCT url) * 100.0 / COUNT(*), 2) as url_diversity_percentage,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        CASE 
          WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' 
               OR request_user_agent LIKE '%Perplexity%' OR request_user_agent LIKE '%Claude%'
               OR request_user_agent LIKE '%Bard%' OR request_user_agent LIKE '%Gemini%' THEN 'Agentic AI'
          WHEN request_user_agent LIKE '%bot%' OR request_user_agent LIKE '%Bot%' 
               OR request_user_agent LIKE '%spider%' OR request_user_agent LIKE '%Spider%'
               OR request_user_agent LIKE '%crawler%' OR request_user_agent LIKE '%Crawler%' THEN 'Traditional Bot'
          WHEN request_user_agent LIKE '%Mozilla%' AND request_user_agent LIKE '%Chrome%' THEN 'Human Browser'
          ELSE 'Unknown'
        END as user_type,
        CASE 
          WHEN COUNT(*) >= 1000 THEN 'Very High (1000+/hour)'
          WHEN COUNT(*) >= 500 THEN 'High (500-999/hour)'
          WHEN COUNT(*) >= 100 THEN 'Medium (100-499/hour)'
          WHEN COUNT(*) >= 10 THEN 'Low (10-99/hour)'
          ELSE 'Very Low (<10/hour)'
        END as frequency_category
      FROM cdn_logs.${tableName} 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
      GROUP BY request_user_agent
      ORDER BY total_requests DESC
    `;
  },

  /**
   * Bot behavior analysis - frequency patterns
   */
  botFrequencyAnalysis: (hourToProcess) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        CASE 
          WHEN request_user_agent LIKE '%ChatGPT-User%' THEN 'ChatGPT User Mode'
          WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' THEN 'ChatGPT Bot'
          WHEN request_user_agent LIKE '%Perplexity-User%' THEN 'Perplexity User Mode'
          WHEN request_user_agent LIKE '%Perplexity%' THEN 'Perplexity Bot'
          WHEN request_user_agent LIKE '%Claude%' THEN 'Claude'
          WHEN request_user_agent LIKE '%Bard%' OR request_user_agent LIKE '%Gemini%' THEN 'Google AI'
          ELSE 'Other AI'
        END as ai_agent_type,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls_accessed,
        COUNT(DISTINCT geo_country) as unique_countries,
        ROUND(COUNT(*) / 60.0, 2) as requests_per_minute,
        ROUND(COUNT(DISTINCT url) * 100.0 / COUNT(*), 2) as url_diversity_ratio,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        CASE 
          WHEN COUNT(*) / 60.0 >= 50 THEN 'Aggressive (50+/min)'
          WHEN COUNT(*) / 60.0 >= 10 THEN 'Moderate (10-49/min)'
          WHEN COUNT(*) / 60.0 >= 1 THEN 'Light (1-9/min)'
          ELSE 'Minimal (<1/min)'
        END as request_intensity
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
        AND (request_user_agent LIKE '%ChatGPT%' 
             OR request_user_agent LIKE '%GPTBot%'
             OR request_user_agent LIKE '%Perplexity%'
             OR request_user_agent LIKE '%Claude%'
             OR request_user_agent LIKE '%Bard%'
             OR request_user_agent LIKE '%Gemini%')
      GROUP BY ai_agent_type
      ORDER BY total_requests DESC
    `;
  },

  /**
   * URL access patterns - identify popular vs rare URLs
   */
  urlAccessPatterns: (hourToProcess, limit = 100) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        url,
        host,
        COUNT(*) as total_requests,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        COUNT(DISTINCT geo_country) as unique_countries,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests,
        ROUND(COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                           request_user_agent LIKE '%Perplexity%' OR 
                           request_user_agent LIKE '%Claude%' OR
                           request_user_agent LIKE '%GPTBot%' THEN 1 END) * 100.0 / COUNT(*), 2) as agentic_percentage,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        CASE 
          WHEN COUNT(*) >= 100 THEN 'High Traffic'
          WHEN COUNT(*) >= 20 THEN 'Medium Traffic'
          WHEN COUNT(*) >= 5 THEN 'Low Traffic'
          ELSE 'Rare Access'
        END as traffic_level
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
      GROUP BY url, host
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Time-based request distribution within the hour
   */
  minuteByMinuteDistribution: (hourToProcess) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        MINUTE(PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as minute_of_hour,
        COUNT(*) as total_requests,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests,
        COUNT(CASE WHEN request_user_agent LIKE '%bot%' OR request_user_agent LIKE '%Bot%' 
                     OR request_user_agent LIKE '%spider%' OR request_user_agent LIKE '%Spider%'
                     OR request_user_agent LIKE '%crawler%' OR request_user_agent LIKE '%Crawler%' THEN 1 END) as bot_requests,
        COUNT(CASE WHEN request_user_agent LIKE '%Mozilla%' AND request_user_agent LIKE '%Chrome%' THEN 1 END) as human_requests,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
      GROUP BY minute_of_hour
      ORDER BY minute_of_hour
    `;
  },
};
/* c8 ignore stop */
