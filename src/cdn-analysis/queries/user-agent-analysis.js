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

/**
 * User Agent Analysis Athena Queries
 * Detects and classifies agentic traffic from various AI sources
 */

export const userAgentAnalysisQueries = {
  /**
   * Hourly user agent analysis with agentic detection
   */
  hourlyUserAgents: (hourToProcess, tableName = 'raw_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        url,
        request_user_agent,
        response_status,
        COUNT(*) as count,
        ${AGENTIC_PATTERNS.TYPE_CLASSIFICATION} as agent_type,
        ${AGENTIC_PATTERNS.IS_AGENTIC_FLAG} as is_agentic,
        host,
        geo_country
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY url, request_user_agent, response_status, host, geo_country
      ORDER BY count DESC
    `;
  },

  /**
   * Agentic traffic breakdown by source
   */
  agenticBreakdown: (hourToProcess, tableName = 'raw_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        ${AGENTIC_PATTERNS.TYPE_CLASSIFICATION} as agentic_source,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as not_found_requests
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND ${AGENTIC_PATTERNS.DETECTION_CLAUSE}
      GROUP BY 1
      ORDER BY total_requests DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },

  /**
   * Top user agents by request count
   */
  topUserAgents: (hourToProcess, tableName = 'raw_logs', limit = 100) => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        request_user_agent,
        COUNT(*) as total_requests,
        COUNT(DISTINCT url) as unique_urls,
        COUNT(DISTINCT geo_country) as unique_countries,
        AVG(CASE WHEN response_status = 200 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
        ${AGENTIC_PATTERNS.TYPE_CLASSIFICATION} as agent_type,
        ${AGENTIC_PATTERNS.IS_AGENTIC_FLAG} as is_agentic
      FROM cdn_logs.${tableName} 
      ${whereClause}
      GROUP BY request_user_agent
      ORDER BY total_requests DESC
      LIMIT ${limit}
    `;
  },

  /**
   * User agent patterns for a specific URL
   */
  userAgentsByUrl: (hourToProcess, targetUrl, tableName = 'raw_logs') => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        request_user_agent,
        response_status,
        COUNT(*) as count,
        ${AGENTIC_PATTERNS.TYPE_CLASSIFICATION} as agent_type,
        geo_country
      FROM cdn_logs.${tableName} 
      ${whereClause}
        AND url = '${targetUrl}'
      GROUP BY request_user_agent, response_status, geo_country
      ORDER BY count DESC
      LIMIT ${QUERY_LIMITS.DEFAULT_LIMIT}
    `;
  },
};
/* c8 ignore stop */
