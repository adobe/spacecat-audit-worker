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

import { DEFAULT_COUNTRY_PATTERNS } from '../constants/country-patterns.js';
import { loadSql, fetchRemotePatterns, buildSiteFilters } from './report-utils.js';
import { PROVIDER_USER_AGENT_PATTERNS, buildAgentTypeClassificationSQL, buildUserAgentDisplaySQL } from '../constants/user-agent-patterns.js';

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

function buildWhereClause(conditions = [], siteFilters = []) {
  const allConditions = [...conditions];

  // Filter for ChatGPT and Perplexity
  const chatgptPattern = PROVIDER_USER_AGENT_PATTERNS.chatgpt;
  const perplexityPattern = PROVIDER_USER_AGENT_PATTERNS.perplexity;
  allConditions.push(`(REGEXP_LIKE(user_agent, '${chatgptPattern}') OR REGEXP_LIKE(user_agent, '${perplexityPattern}'))`);

  if (siteFilters && siteFilters.length > 0) {
    allConditions.push(siteFilters);
  }

  /* c8 ignore next */
  return allConditions.length > 0 ? `WHERE ${allConditions.join(' AND ')}` : '';
}

// Page Type Classification
function generatePageTypeClassification(remotePatterns = null) {
  /* c8 ignore start */
  const patterns = remotePatterns?.pagePatterns || [];

  if (patterns.length === 0) {
    return "'Uncategorized'";
  }

  const caseConditions = patterns
    .map((pattern) => `      WHEN REGEXP_LIKE(url, '${pattern.regex}') THEN '${pattern.name}'`)
    .join('\n');

  return `CASE\n${caseConditions}\n      ELSE 'Uncategorized'\n    END`;
  /* c8 ignore stop */
}

// Country Classification
function buildCountryExtractionSQL() {
  const extracts = DEFAULT_COUNTRY_PATTERNS
    .map(({ regex }) => `NULLIF(UPPER(REGEXP_EXTRACT(url, '${regex}', 1)), '')`)
    .join(',\n    ');

  return `COALESCE(\n    ${extracts},\n    'GLOBAL'\n  )`;
}

// Topic Classification
function buildTopicExtractionSQL(remotePatterns = null) {
  /* c8 ignore start */
  const patterns = remotePatterns?.topicPatterns || [];

  if (Array.isArray(patterns) && patterns.length > 0) {
    const namedPatterns = [];
    const extractPatterns = [];

    patterns.forEach(({ regex, name }) => {
      if (name) {
        namedPatterns.push(`WHEN REGEXP_LIKE(url, '${regex}') THEN '${name}'`);
      } else {
        extractPatterns.push(`NULLIF(REGEXP_EXTRACT(url, '${regex}', 1), '')`);
      }
    });

    if (namedPatterns.length > 0 && extractPatterns.length > 0) {
      const caseClause = `CASE\n          ${namedPatterns.join('\n          ')}\n          ELSE NULL\n        END`;
      const coalesceClause = extractPatterns.join(',\n    ');
      return `COALESCE(\n    ${caseClause},\n    ${coalesceClause},\n    'Other'\n  )`;
    } else if (namedPatterns.length > 0) {
      return `CASE\n          ${namedPatterns.join('\n          ')}\n          ELSE 'Other'\n        END`;
    } else {
      return `COALESCE(\n    ${extractPatterns.join(',\n    ')},\n    'Other'\n  )`;
    }
  }
  return "CASE WHEN url IS NOT NULL THEN 'Other' END";
  /* c8 ignore stop */
}

async function createAgenticReportQuery(options) {
  const {
    periods, databaseName, tableName, site,
  } = options;

  const filters = site.getConfig().getLlmoCdnlogsFilter();
  const siteFilters = buildSiteFilters(filters);

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    siteFilters,
  );

  const remotePatterns = await fetchRemotePatterns(site);

  return loadSql('agentic-traffic-report', {
    agentTypeClassification: buildAgentTypeClassificationSQL(),
    userAgentDisplay: buildUserAgentDisplaySQL(),
    countryExtraction: buildCountryExtractionSQL(),
    topicExtraction: buildTopicExtractionSQL(remotePatterns),
    pageCategoryClassification: generatePageTypeClassification(remotePatterns),
    databaseName,
    tableName,
    whereClause,
  });
}

function buildWhereClauseReferral(conditions = [], siteFilters = []) {
  const allConditions = [...conditions];

  if (siteFilters && siteFilters.length > 0) {
    allConditions.push(siteFilters);
  }

  /* c8 ignore next */
  return allConditions.length > 0 ? `WHERE ${allConditions.join(' AND ')}` : '';
}

async function createReferralReportQuery(options) {
  const {
    periods, databaseName, tableName, site,
  } = options;

  /* c8 ignore next */
  const filters = site.getConfig().getLlmoCdnlogsFilter();
  const siteFilters = buildSiteFilters(filters);
  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClauseReferral(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    siteFilters,
  );

  return loadSql('referral-traffic-report', {
    databaseName,
    tableName,
    whereClause,
    countryExtraction: buildCountryExtractionSQL(),
  });
}

export const weeklyBreakdownQueries = {
  createAgenticReportQuery,
  createReferralReportQuery,
};
