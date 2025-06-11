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
 * Request Analysis Athena Queries
 * Focused on platform-specific requests, status codes, and traffic metrics
 */

export const requestAnalysisQueries = {
  /**
   * Hourly request analysis for a specific hour
   * Tracks requests per platform, status codes, and traffic totals
   */
  hourlyRequests: (hourToProcess, tableName = 'filtered_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        -- Platform-specific requests
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests,
        -- Status code distribution
        COUNT(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 END) as status_2xx,
        COUNT(CASE WHEN response_status BETWEEN 300 AND 399 THEN 1 END) as status_3xx,
        COUNT(CASE WHEN response_status = 401 THEN 1 END) as status_401,
        COUNT(CASE WHEN response_status = 403 THEN 1 END) as status_403,
        COUNT(CASE WHEN response_status = 404 THEN 1 END) as status_404,
        COUNT(CASE WHEN response_status BETWEEN 500 AND 599 THEN 1 END) as status_5xx,
        -- Traffic totals
        COUNT(CASE WHEN agentic_type IN ('chatgpt', 'perplexity', 'claude') THEN 1 END) as total_agentic_requests,
        COUNT(*) as total_overall_traffic
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IN ('chatgpt', 'perplexity', 'claude')
    `;
  },
};
/* c8 ignore stop */
