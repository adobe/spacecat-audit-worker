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
import { getPageTypePatterns, generatePageTypeCaseStatement } from '../utils/page-type-utils.js';

export class PageTypeAnalysisQuery extends BaseQuery {
  static analysisType = 'reqCountByPageType';

  constructor(hourToProcess, tableName, s3Config, site) {
    super(hourToProcess, tableName, s3Config);
    this.site = site;
  }

  getSelectQuery() {
    const { whereClause } = getHourlyPartitionFilter(this.hourToProcess);
    const patterns = getPageTypePatterns(this.site);
    const pageTypeCaseStatement = generatePageTypeCaseStatement(patterns);

    return `
      SELECT 
        ${pageTypeCaseStatement} as page_type,
        COUNT(*) as request_count,
        COUNT(CASE WHEN agentic_type = 'chatgpt' THEN 1 END) as chatgpt_requests,
        COUNT(CASE WHEN agentic_type = 'perplexity' THEN 1 END) as perplexity_requests,
        COUNT(CASE WHEN agentic_type = 'claude' THEN 1 END) as claude_requests
      FROM ${this.getFullTableName()}
      ${whereClause}
      AND agentic_type IN ('chatgpt', 'perplexity', 'claude')
      AND url IS NOT NULL
      GROUP BY ${pageTypeCaseStatement}
      ORDER BY request_count DESC
    `;
  }
}
/* c8 ignore stop */
