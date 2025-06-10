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
 * User Agent Analysis Athena Queries
 * Detects and classifies agentic traffic from various AI sources
 */

export const userAgentAnalysisQueries = {
  /**
   * Hourly user agent analysis with agentic detection
   */
  hourlyUserAgents: (hourToProcess, tableName = 'raw_logs') => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        url,
        request_user_agent,
        response_status,
        COUNT(*) as count,
        CASE 
          WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' THEN 'chatgpt'
          WHEN request_user_agent LIKE '%Perplexity%' THEN 'perplexity'
          WHEN request_user_agent LIKE '%Claude%' OR request_user_agent LIKE '%Anthropic%' THEN 'claude'
          WHEN request_user_agent LIKE '%GoogleOther%' OR request_user_agent LIKE '%Bard%' THEN 'gemini'
          WHEN request_user_agent LIKE '%BingBot%' OR request_user_agent LIKE '%msnbot%' THEN 'bing'
          ELSE 'human'
        END as agent_type,
        CASE 
          WHEN request_user_agent LIKE '%ChatGPT%' OR 
               request_user_agent LIKE '%Perplexity%' OR 
               request_user_agent LIKE '%Claude%' OR
               request_user_agent LIKE '%GPTBot%' OR
               request_user_agent LIKE '%Anthropic%' OR
               request_user_agent LIKE '%GoogleOther%' OR
               request_user_agent LIKE '%BingBot%' THEN 'true'
          ELSE 'false'
        END as is_agentic,
        host,
        geo_country
      FROM cdn_logs.${tableName} 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
      GROUP BY url, request_user_agent, response_status, host, geo_country
      ORDER BY count DESC
    `;
  },

  /**
   * Agentic traffic breakdown by source
   */
  agenticBreakdown: (hourToProcess) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        CASE 
          WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' THEN 'chatgpt'
          WHEN request_user_agent LIKE '%Perplexity%' THEN 'perplexity'
          WHEN request_user_agent LIKE '%Claude%' OR request_user_agent LIKE '%Anthropic%' THEN 'claude'
          WHEN request_user_agent LIKE '%GoogleOther%' OR request_user_agent LIKE '%Bard%' THEN 'gemini'
          WHEN request_user_agent LIKE '%BingBot%' OR request_user_agent LIKE '%msnbot%' THEN 'bing'
        END as agentic_source,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests
      FROM raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
        AND (request_user_agent LIKE '%ChatGPT%' OR 
             request_user_agent LIKE '%Perplexity%' OR 
             request_user_agent LIKE '%Claude%' OR
             request_user_agent LIKE '%GPTBot%' OR
             request_user_agent LIKE '%Anthropic%' OR
             request_user_agent LIKE '%GoogleOther%' OR
             request_user_agent LIKE '%BingBot%')
      GROUP BY 1
      ORDER BY total_requests DESC
    `;
  },

  /**
   * Top user agents by request count
   */
  topUserAgents: (hourToProcess, limit = 100) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        request_user_agent,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        CASE 
          WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' THEN 'chatgpt'
          WHEN request_user_agent LIKE '%Perplexity%' THEN 'perplexity'
          WHEN request_user_agent LIKE '%Claude%' OR request_user_agent LIKE '%Anthropic%' THEN 'claude'
          WHEN request_user_agent LIKE '%GoogleOther%' OR request_user_agent LIKE '%Bard%' THEN 'gemini'
          WHEN request_user_agent LIKE '%BingBot%' OR request_user_agent LIKE '%msnbot%' THEN 'bing'
          ELSE 'human'
        END as agent_type,
        CASE 
          WHEN request_user_agent LIKE '%ChatGPT%' OR 
               request_user_agent LIKE '%Perplexity%' OR 
               request_user_agent LIKE '%Claude%' OR
               request_user_agent LIKE '%GPTBot%' OR
               request_user_agent LIKE '%Anthropic%' OR
               request_user_agent LIKE '%GoogleOther%' OR
               request_user_agent LIKE '%BingBot%' THEN 'true'
          ELSE 'false'
        END as is_agentic
      FROM raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
      GROUP BY request_user_agent
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;
  },

  /**
   * User agent patterns for a specific URL
   */
  userAgentsByUrl: (hourToProcess, targetUrl) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        request_user_agent,
        response_status,
        COUNT(*) as count,
        CASE 
          WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' THEN 'chatgpt'
          WHEN request_user_agent LIKE '%Perplexity%' THEN 'perplexity'
          WHEN request_user_agent LIKE '%Claude%' OR request_user_agent LIKE '%Anthropic%' THEN 'claude'
          WHEN request_user_agent LIKE '%GoogleOther%' OR request_user_agent LIKE '%Bard%' THEN 'gemini'
          WHEN request_user_agent LIKE '%BingBot%' OR request_user_agent LIKE '%msnbot%' THEN 'bing'
          ELSE 'human'
        END as agent_type,
        geo_country
      FROM raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
        AND url = '${targetUrl}'
      GROUP BY request_user_agent, response_status, geo_country
      ORDER BY count DESC
    `;
  },
};
/* c8 ignore stop */
