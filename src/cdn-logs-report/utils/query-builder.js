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
import { loadSql } from './report-utils.js';
import { DEFAULT_PATTERNS } from '../constants/page-patterns.js';
import { getProviderPattern, buildAgentTypeClassificationSQL } from '../constants/user-agent-patterns.js';
import { TOPIC_PATTERNS } from '../constants/topic-patterns.js';

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

function buildWhereClause(conditions = [], provider = null, siteFilters = []) {
  const allConditions = [...conditions];

  if (provider) {
    const pattern = getProviderPattern(provider);
    allConditions.push(`REGEXP_LIKE(user_agent, '${pattern}')`);
  }

  if (siteFilters && siteFilters.length > 0) {
    allConditions.push(siteFilters);
  }

  /* c8 ignore next */
  return allConditions.length > 0 ? `WHERE ${allConditions.join(' AND ')}` : '';
}

function buildWeeklyColumns(periods) {
  return periods.weeks.map((week) => {
    const weekKey = week.weekLabel.replace(' ', '_').toLowerCase();
    const dateFilter = buildDateFilter(week.startDate, week.endDate);
    return `SUM(CASE WHEN ${dateFilter} THEN count ELSE 0 END) as ${weekKey}`;
  }).join(',\n      ');
}

function buildOrderBy(periods) {
  return periods.weeks
    .map((week) => week.weekLabel.replace(' ', '_').toLowerCase())
    .join(' + ');
}

// Page Type Classification
function generatePageTypeClassification(site) {
  /* c8 ignore next */
  const patterns = site?.getConfig()?.getGroupedURLs('cdn-analysis') || DEFAULT_PATTERNS;

  const caseConditions = patterns
    .map((pattern) => `      WHEN REGEXP_LIKE(url, '${pattern.pattern}') THEN '${pattern.name}'`)
    .join('\n');

  return `CASE\n${caseConditions}\n      ELSE 'Uncategorized'\n    END`;
}

// Country Classification
function buildCountryExtractionSQL() {
  const extracts = DEFAULT_COUNTRY_PATTERNS
    .map(({ regex }) => `NULLIF(UPPER(REGEXP_EXTRACT(url, '${regex}', 1)), '')`)
    .join(',\n    ');

  return `COALESCE(\n    ${extracts},\n    'GLOBAL'\n  )`;
}

// Topic Classification
function buildTopicExtractionSQL(site) {
  const siteUrl = site.getBaseURL();
  const domain = new URL(siteUrl).hostname.replace('www.', '');

  const patterns = TOPIC_PATTERNS[domain];

  if (Array.isArray(patterns)) {
    const namedPatterns = [];
    const extractPatterns = [];

    patterns.forEach(({ regex, name }) => {
      if (name) {
        namedPatterns.push(`WHEN REGEXP_LIKE(url, '${regex}') THEN '${name}'`);
      } else {
        extractPatterns.push(`NULLIF(REGEXP_EXTRACT(url, '${regex}', 1), '')`);
      }
    });

    /* c8 ignore next 10 */
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
}

// Query Builders
async function createCountryWeeklyBreakdownQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const dateFilter = buildDateFilter(
    periods.weeks[0].startDate,
    periods.weeks[periods.weeks.length - 1].endDate,
  );
  const whereClause = buildWhereClause([
    dateFilter,
    'url NOT LIKE \'%robots.txt\'',
    'url NOT LIKE \'%sitemap%\'',
  ], provider, siteFilters);

  return loadSql('country-weekly-breakdown', {
    countryExtraction: buildCountryExtractionSQL(),
    agentTypeClassification: buildAgentTypeClassificationSQL(provider),
    weekColumns: buildWeeklyColumns(periods),
    databaseName,
    tableName,
    whereClause,
    orderBy: buildOrderBy(periods),
  });
}

async function createUserAgentWeeklyBreakdownQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    provider,
    siteFilters,
  );

  return loadSql('user-agent-breakdown', {
    agentTypeClassification: buildAgentTypeClassificationSQL(provider),
    databaseName,
    tableName,
    whereClause,
  });
}

async function createError404UrlsQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate), 'status = 404'],
    provider,
    siteFilters,
  );

  return loadSql('individual-urls-by-status', {
    agentTypeClassification: buildAgentTypeClassificationSQL(provider),
    databaseName,
    tableName,
    whereClause,
  });
}

async function createError503UrlsQuery(options) {
  const {
    periods, databaseName, tableName, provider, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate), 'status = 503'],
    provider,
    siteFilters,
  );

  return loadSql('individual-urls-by-status', {
    agentTypeClassification: buildAgentTypeClassificationSQL(provider),
    databaseName,
    tableName,
    whereClause,
  });
}

async function createSuccessUrlsByCategoryQuery(options) {
  const {
    periods, databaseName, tableName, provider, site, siteFilters = [],
  } = options;

  if (!site || !site.getBaseURL().includes('bulk.com')) {
    return null;
  }

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate), 'status = 200', "url LIKE '%/products%'"],
    provider,
    siteFilters,
  );

  return loadSql('individual-urls-by-status', {
    agentTypeClassification: buildAgentTypeClassificationSQL(provider),
    databaseName,
    tableName,
    whereClause,
  });
}

async function createTopUrlsQuery(options) {
  const {
    periods, databaseName, tableName, provider, site, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate), 'url NOT LIKE \'%robots.txt\'', 'url NOT LIKE \'%sitemap%\''],
    provider,
    siteFilters,
  );

  return loadSql('top-urls-by-traffic', {
    agentTypeClassification: buildAgentTypeClassificationSQL(provider),
    topicExtraction: buildTopicExtractionSQL(site),
    databaseName,
    tableName,
    whereClause,
  });
}

async function createHitsByProductAgentTypeQuery(options) {
  const {
    periods, databaseName, tableName, provider, site, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    provider,
    siteFilters,
  );

  return loadSql('hits-by-product-agent-type', {
    topicExtraction: buildTopicExtractionSQL(site),
    agentTypeClassification: buildAgentTypeClassificationSQL(provider),
    databaseName,
    tableName,
    whereClause,
  });
}

async function createHitsByPageCategoryAgentTypeQuery(options) {
  const {
    periods, databaseName, tableName, provider, site, siteFilters = [],
  } = options;

  const lastWeek = periods.weeks[periods.weeks.length - 1];
  const whereClause = buildWhereClause(
    [buildDateFilter(lastWeek.startDate, lastWeek.endDate)],
    provider,
    siteFilters,
  );

  return loadSql('hits-by-page-category-agent-type', {
    pageCategoryClassification: generatePageTypeClassification(site),
    agentTypeClassification: buildAgentTypeClassificationSQL(provider),
    databaseName,
    tableName,
    whereClause,
  });
}

export const weeklyBreakdownQueries = {
  createCountryWeeklyBreakdown: createCountryWeeklyBreakdownQuery,
  createUserAgentWeeklyBreakdown: createUserAgentWeeklyBreakdownQuery,
  createError404Urls: createError404UrlsQuery,
  createError503Urls: createError503UrlsQuery,
  createSuccessUrlsByCategory: createSuccessUrlsByCategoryQuery,
  createTopUrls: createTopUrlsQuery,
  createHitsByProductAgentType: createHitsByProductAgentTypeQuery,
  createHitsByPageCategoryAgentType: createHitsByPageCategoryAgentTypeQuery,
};
