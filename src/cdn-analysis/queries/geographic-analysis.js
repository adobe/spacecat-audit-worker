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
import { getHourlyPartitionFilter, AGENTIC_PATTERNS, QUERY_LIMITS } from './query-helpers.js';

export const geographicAnalysisQueries = {
  /**
   * Traffic by country for a specific hour
   */
  hourlyByCountry: (hourToProcess, tableName = 'raw_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        geo_country,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status >= 400 THEN 1 END) as error_requests,
        ${AGENTIC_PATTERNS.COUNT_AGENTIC} as agentic_requests,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage_of_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND geo_country IS NOT NULL
      GROUP BY geo_country
      ORDER BY total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Agentic AI traffic by country
   */
  agenticByCountry: (hourToProcess, tableName = 'raw_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        geo_country,
        COUNT(*) as agentic_requests,
        COUNT(DISTINCT url) as unique_urls_accessed,
        COUNT(DISTINCT request_user_agent) as unique_ai_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests,
        ${AGENTIC_PATTERNS.TYPE_CLASSIFICATION} as primary_ai_source
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND geo_country IS NOT NULL
        AND ${AGENTIC_PATTERNS.DETECTION_CLAUSE}
      GROUP BY geo_country
      ORDER BY agentic_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Country-specific URL patterns
   */
  countryUrlPatterns: (hourToProcess, tableName = 'raw_logs', limit = 100) => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        geo_country,
        url,
        host,
        COUNT(*) as request_count,
        COUNT(DISTINCT request_user_agent) as unique_user_agents,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        ${AGENTIC_PATTERNS.COUNT_AGENTIC} as agentic_requests,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND geo_country IS NOT NULL
      GROUP BY geo_country, url, host
      ORDER BY request_count DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Geographic patterns over time
   * Note: For longer-term analysis, consider using partition filtering
   */
  countryPatternsOverTime: (startDate, endDate, tableName = 'raw_logs') => `
      SELECT 
        DATE_TRUNC('hour', PARSE_DATETIME(timestamp, 'yyyy-MM-dd''T''HH:mm:ss''+0000')) as hour,
        geo_country,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        ${AGENTIC_PATTERNS.COUNT_AGENTIC} as agentic_requests
      FROM cdn_logs.${tableName} 
      WHERE timestamp >= '${startDate.toISOString()}'
        AND timestamp < '${endDate.toISOString()}'
        AND geo_country IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `,
};
/* c8 ignore stop */
