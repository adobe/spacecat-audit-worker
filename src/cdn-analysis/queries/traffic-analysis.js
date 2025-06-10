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
 * Traffic Analysis Athena Queries
 * Supports weekly traffic patterns, request counts, and success rates
 */

export const trafficAnalysisQueries = {
  /**
   * Hourly traffic analysis for a specific hour
   */
  hourlyTraffic: (hourToProcess, tableName = 'raw_logs') => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        '${startHour}' as hour,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT host) as unique_hosts,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        COUNT(CASE WHEN response_status = 503 THEN 1 END) as service_unavailable_requests,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests
      FROM cdn_logs.${tableName} 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
    `;
  },

  /**
   * Weekly traffic analysis
   */
  weeklyTraffic: (startDate, endDate) => `
      SELECT 
        DATE_TRUNC('week', PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as week,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT host) as unique_hosts,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startDate.toISOString()}'
        AND timestamp < '${endDate.toISOString()}'
      GROUP BY 1 
      ORDER BY 1
    `,

  /**
   * Top URLs by traffic volume
   */
  topUrlsByTraffic: (hourToProcess, limit = 50) => {
    const startHour = `${hourToProcess.toISOString().slice(0, 13)}:00:00`;
    const endHour = `${new Date(hourToProcess.getTime() + 60 * 60 * 1000).toISOString().slice(0, 13)}:00:00`;

    return `
      SELECT 
        url,
        host,
        COUNT(*) as total_requests,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_count
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startHour}'
        AND timestamp < '${endHour}'
      GROUP BY url, host
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Traffic by hour of day pattern
   */
  trafficByHour: (startDate, endDate) => `
      SELECT 
        HOUR(PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as hour_of_day,
        COUNT(*) as total_requests,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN request_user_agent LIKE '%ChatGPT%' OR 
                     request_user_agent LIKE '%Perplexity%' OR 
                     request_user_agent LIKE '%Claude%' OR
                     request_user_agent LIKE '%GPTBot%' THEN 1 END) as agentic_requests
      FROM cdn_logs.raw_logs 
      WHERE timestamp >= '${startDate.toISOString()}'
        AND timestamp < '${endDate.toISOString()}'
      GROUP BY 1 
      ORDER BY 1
    `,
};
/* c8 ignore stop */
