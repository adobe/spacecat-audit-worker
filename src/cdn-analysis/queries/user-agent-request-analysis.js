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
 * User-Agent Request Analysis Athena Queries
 * Analysis of user agent strings for agentic traffic only
 */

export const userAgentRequestAnalysisQueries = {
  /**
   * Hourly user agent analysis for agentic traffic
   */
  hourlyUserAgentRequests: (hourToProcess, tableName = 'filtered_logs') => {
    const { whereClause, hourLabel } = getHourlyPartitionFilter(hourToProcess);

    return `
      SELECT 
        '${hourLabel}' as hour,
        request_user_agent as user_agent,
        response_status as status_code,
        COUNT(*) as count,
        agentic_type
      FROM cdn_logs.${tableName} 
      ${whereClause}
      AND agentic_type IN ('chatgpt', 'perplexity', 'claude')
      GROUP BY request_user_agent, response_status, agentic_type
      ORDER BY count DESC
    `;
  },
};
/* c8 ignore stop */
