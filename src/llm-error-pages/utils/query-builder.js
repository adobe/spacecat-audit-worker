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

import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { buildLlmUserAgentFilter } from '../constants/user-agent-patterns.js';

function buildDateFilter(startDate, endDate) {
  const formatPart = (date) => ({
    year: date.getUTCFullYear().toString(),
    month: (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    day: date.getUTCDate().toString().padStart(2, '0'),
  });

  const start = formatPart(startDate);
  const end = formatPart(endDate);

  return start.year === end.year && start.month === end.month
    ? `(year = '${start.year}' AND month = '${start.month}' AND day >= '${start.day}' AND day <= '${end.day}')`
    : `((year = '${start.year}' AND month = '${start.month}' AND day >= '${start.day}')
       OR (year = '${end.year}' AND month = '${end.month}' AND day <= '${end.day}'))`;
}

function buildWhereClause(conditions = [], llmProviders = null, siteFilters = []) {
  const allConditions = [...conditions];

  // Add LLM user agent filter
  if (llmProviders) {
    const llmFilter = buildLlmUserAgentFilter(llmProviders);
    if (llmFilter) {
      allConditions.push(llmFilter);
    }
  }

  if (siteFilters && siteFilters.length > 0) {
    allConditions.push(siteFilters);
  }

  return allConditions.length > 0 ? `WHERE ${allConditions.join(' AND ')}` : '';
}

export async function loadSql(filename, variables) {
  return getStaticContent(variables, `./src/llm-error-pages/sql/${filename}.sql`);
}

export async function buildLlmErrorPagesQuery(options) {
  const {
    databaseName,
    tableName,
    startDate,
    endDate,
    llmProviders = null,
    siteFilters = [],
    errorStatuses = null,
  } = options;

  const conditions = [];

  // Date range filter
  if (startDate && endDate) {
    conditions.push(buildDateFilter(startDate, endDate));
  }

  // Error status filter (placeholder for future expansion)
  if (errorStatuses && errorStatuses.length > 0) {
    const statusFilter = `status IN (${errorStatuses.join(',')})`;
    conditions.push(statusFilter);
  }

  const whereClause = buildWhereClause(conditions, llmProviders, siteFilters);

  return loadSql('llm-error-pages', {
    databaseName,
    tableName,
    whereClause,
  });
}
