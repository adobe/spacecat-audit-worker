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

export const geographicAnalysisQueries = {
  /**
   * Traffic by country for a specific hour
   */
  hourlyByCountry: (hourToProcess) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        geo_country,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_traffic
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
        AND geo_country IS NOT NULL
      GROUP BY geo_country
      ORDER BY total_requests DESC
    `;
  },

  /**
   * Agentic AI traffic by country
   */
  agenticByCountry: (hourToProcess) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        geo_country,
        COUNT(*) as agentic_requests,
        COUNT(DISTINCT url) as unique_urls_accessed,
        COUNT(DISTINCT request_user_agent) as unique_ai_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        CASE 
          WHEN COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR request_user_agent LIKE '%GPTBot%' THEN 1 END) > 0 THEN 'ChatGPT'
          WHEN COUNT(CASE WHEN request_user_agent LIKE '%Perplexity%' THEN 1 END) > 0 THEN 'Perplexity'
          WHEN COUNT(CASE WHEN request_user_agent LIKE '%Claude%' THEN 1 END) > 0 THEN 'Claude'
          ELSE 'Mixed AI'
        END as primary_ai_source
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
        AND geo_country IS NOT NULL
        AND (request_user_agent LIKE '%ChatGPT%' 
             OR request_user_agent LIKE '%GPTBot%'
             OR request_user_agent LIKE '%Perplexity%'
             OR request_user_agent LIKE '%Claude%'
             OR request_user_agent LIKE '%Bard%'
             OR request_user_agent LIKE '%Gemini%')
      GROUP BY geo_country
      ORDER BY agentic_requests DESC
    `;
  },

  /**
   * Country-specific URL patterns
   */
  countryUrlPatterns: (hourToProcess, limit = 100) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        geo_country,
        url,
        host,
        COUNT(*) as request_count,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
        AND geo_country IS NOT NULL
      GROUP BY geo_country, url, host
      ORDER BY request_count DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Geographic patterns over time
   */
  countryPatternsOverTime: (startDate, endDate) => `
      SELECT 
        DATE_TRUNC('hour', PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as hour,
        geo_country,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startDate.toISOString()}'
        AND timestamp < '${endDate.toISOString()}'
        AND geo_country IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, total_requests DESC
    `,
};
