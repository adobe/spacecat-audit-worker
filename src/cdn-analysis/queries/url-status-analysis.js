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
import { getHourlyPartitionFilter, createUnloadQuery } from './query-helpers.js';

/**
 * URL-Status Analysis Athena Queries
 * Simplified analysis of URL and StatusCode breakdown for agentic traffic
 */

export const urlStatusAnalysisQueries = {
  /**
   * Hourly URL-Status analysis for agentic traffic
   */
  hourlyUrlStatus: (hourToProcess, tableName, s3Config) => {
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    const selectQuery = `
      SELECT 
        url,
        response_status as status_code,
        COUNT(*) as count,
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests
      FROM cdn_logs_${s3Config.customerDomain}.${tableName} 
      ${whereClause}
      AND agentic_type IN ('chatgpt', 'perplexity', 'claude')
      GROUP BY url, response_status
      ORDER BY count DESC
    `;

    return createUnloadQuery(selectQuery, 'reqCountByUrlStatus', hourToProcess, s3Config);
  },
};
/* c8 ignore stop */
