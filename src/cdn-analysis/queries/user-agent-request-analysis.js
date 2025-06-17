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
import { BaseQuery } from './base-query.js';
import { getHourlyPartitionFilter } from './query-helpers.js';

export class UserAgentRequestAnalysisQuery extends BaseQuery {
  static analysisType = 'reqCountByUserAgent';

  getSelectQuery() {
    const { whereClause } = getHourlyPartitionFilter(this.hourToProcess);
    return `
      SELECT 
        request_user_agent as user_agent,
        response_status as status_code,
        COUNT(*) as count,
        agentic_type
      FROM ${this.getFullTableName()}
      ${whereClause}
      AND agentic_type IN ('chatgpt', 'perplexity', 'claude')
      GROUP BY request_user_agent, response_status, agentic_type
      ORDER BY count DESC
    `;
  }
}
/* c8 ignore stop */
