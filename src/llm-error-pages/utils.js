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
import { extractCustomerDomain } from '../utils/cdn-utils.js';

// ============================================================================
// CONSTANTS
// ============================================================================

export const LLM_USER_AGENT_PATTERNS = {
  chatgpt: '(?i)ChatGPT|GPTBot|OAI-SearchBot',
  perplexity: '(?i)Perplexity',
  claude: '(?i)Claude|Anthropic',
  gemini: '(?i)Gemini',
  copilot: '(?i)Copilot',
};

const TIME_CONSTANTS = {
  ISO_MONDAY: 1,
  ISO_SUNDAY: 0,
  DAYS_PER_WEEK: 7,
};

const REGEX_PATTERNS = {
  URL_SANITIZATION: /[^a-zA-Z0-9]/g,
  BUCKET_SANITIZATION: /[._]/g,
};

const CDN_LOGS_PREFIX = 'cdn-logs-';

// Country patterns for URL-based country extraction
const DEFAULT_COUNTRY_PATTERNS = [
  // Matches locale with dash format: /en-us/, /fr-fr/, https://example.com/de-de/page
  { name: 'locale_dash_full', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?[a-z]{2}-([a-z]{2})(?:/|$)' },

  // Matches locale with underscore format: /en_us/, /fr_fr/, https://example.com/de_de/page
  { name: 'locale_underscore_full', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?[a-z]{2}_([a-z]{2})(?:/|$)' },

  // Matches locale files: /en_us.html, /fr_ca.jsp, etc.
  { name: 'locale_underscore_file', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?[a-z]{2}_([a-z]{2})\\.[a-z]+$' },

  // Matches global/international prefix: /global/us/, /international/fr/, https://example.com/global/de/
  { name: 'global_prefix', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)(?:global|international)/([a-z]{2})(?:/|$)' },

  // Matches countries/regions prefix: /countries/us/, /regions/fr/, https://example.com/country/de/
  { name: 'countries_prefix', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)(?:countries?|regions?)/([a-z]{2})(?:/|$)' },

  // Matches country/language format: /us/en/, /ca/fr/, https://example.com/de/en/page
  { name: 'country_lang', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)([a-z]{2})/[a-z]{2}(?:/|$)' },

  // Matches 2-letter country codes: /us/, /fr/, /de/, https://example.com/gb/page
  { name: 'path_2letter_full', regex: '(?i)^(?:/|(?:https?:\\/\\/|\\/\\/)?[^/]+/)?([a-z]{2})(?:/|$)' },

  // Matches country query parameter: ?country=us, &country=fr, ?country=usa
  { name: 'query_country', regex: '(?i)[?&]country=([a-z]{2,3})(?:&|$)' },

  // Matches locale query parameter: ?locale=en-us, &locale=fr-fr
  { name: 'query_locale', regex: '(?i)[?&]locale=[a-z]{2}-([a-z]{2})(?:&|$)' },
];

// ============================================================================
// LLM USER AGENT UTILITIES
// ============================================================================

export function getLlmProviderPattern(provider) {
  if (typeof provider !== 'string' || !provider.trim()) {
    return null;
  }
  return LLM_USER_AGENT_PATTERNS[provider.toLowerCase()] || null;
}

export function getAllLlmProviders() {
  return Object.keys(LLM_USER_AGENT_PATTERNS);
}

export function buildLlmUserAgentFilter(providers = null) {
  const targetProviders = providers || getAllLlmProviders();
  const patterns = targetProviders
    .map((provider) => getLlmProviderPattern(provider))
    .filter(Boolean);

  if (patterns.length === 0) {
    return null;
  }

  return `REGEXP_LIKE(user_agent, '${patterns.join('|')}')`;
}

/**
 * User agent display name mappings for better readability in reports
 * Each entry maps a pattern to a display name
 */
const USER_AGENT_DISPLAY_PATTERNS = [
  // ChatGPT/OpenAI
  { pattern: /chatgpt-user/i, displayName: 'ChatGPT-User' },
  { pattern: /gptbot/i, displayName: 'GPTBot' },
  { pattern: /oai-searchbot/i, displayName: 'OAI-SearchBot' },

  // Perplexity
  { pattern: /perplexitybot/i, displayName: 'PerplexityBot' },
  { pattern: /perplexity-user/i, displayName: 'Perplexity-User' },
  { pattern: /perplexity/i, displayName: 'Perplexity' },

  // Other providers
  { pattern: /claude/i, displayName: 'Claude' },
  { pattern: /anthropic/i, displayName: 'Anthropic' },
  { pattern: /gemini/i, displayName: 'Gemini' },
  { pattern: /copilot/i, displayName: 'Copilot' },
];

/**
 * User agent display patterns for SQL LIKE matching (from CDN logs report pattern)
 */
const USER_AGENT_DISPLAY_PATTERNS_SQL = [
  // ChatGPT/OpenAI
  { pattern: '%chatgpt-user%', displayName: 'ChatGPT-User' },
  { pattern: '%gptbot%', displayName: 'GPTBot' },
  { pattern: '%oai-searchbot%', displayName: 'OAI-SearchBot' },

  // Perplexity
  { pattern: '%perplexitybot%', displayName: 'PerplexityBot' },
  { pattern: '%perplexity-user%', displayName: 'Perplexity-User' },
];

export function normalizeUserAgentToProvider(rawUserAgent) {
  if (!rawUserAgent || typeof rawUserAgent !== 'string') return 'Unknown';

  // Find matching display pattern
  for (const { pattern, displayName } of USER_AGENT_DISPLAY_PATTERNS) {
    if (pattern.test(rawUserAgent)) {
      return displayName;
    }
  }

  // Return truncated original if no pattern matches
  return rawUserAgent.length > 50 ? rawUserAgent.substring(0, 50) : rawUserAgent;
}

// ============================================================================
// SQL BUILDING UTILITIES (from CDN logs report pattern)
// ============================================================================

/**
 * Builds SQL CASE statement for user agent display names
 * @returns {string} SQL CASE statement
 */
function buildUserAgentDisplaySQL() {
  const cases = USER_AGENT_DISPLAY_PATTERNS_SQL
    .map((p) => `WHEN LOWER(user_agent) LIKE '${p.pattern}' THEN '${p.displayName}'`)
    .join('\n    ');

  return `CASE 
    ${cases}
    ELSE SUBSTR(user_agent, 1, 100)
  END`;
}

/**
 * Builds SQL CASE statement for agent type classification
 * @returns {string} SQL CASE statement
 */
function buildAgentTypeClassificationSQL() {
  const patterns = [
    // ChatGPT/OpenAI
    { pattern: '%gptbot%', result: 'Training bots' },
    { pattern: '%oai-searchbot%', result: 'Web search crawlers' },
    { pattern: '%chatgpt-user%', result: 'Chatbots' },
    { pattern: '%chatgpt%', result: 'Chatbots' },
    // Perplexity
    { pattern: '%perplexitybot%', result: 'Web search crawlers' },
    { pattern: '%perplexity-user%', result: 'Chatbots' },
    { pattern: '%perplexity%', result: 'Chatbots' },
  ];

  const cases = patterns.map((p) => `WHEN LOWER(user_agent) LIKE '${p.pattern}' THEN '${p.result}'`).join('\n          ');

  return `CASE\n          ${cases}\n          ELSE 'Other'\n        END`;
}

/**
 * Builds country extraction SQL using patterns from CDN logs report
 */
function buildCountryExtractionSQL() {
  const extracts = DEFAULT_COUNTRY_PATTERNS
    .map(({ regex }) => `NULLIF(UPPER(REGEXP_EXTRACT(url, '${regex}', 1)), '')`)
    .join(',\n    ');

  return `COALESCE(\n    ${extracts},\n    'GLOBAL'\n  )`;
}

/**
 * Builds topic extraction SQL using remote patterns
 */
function buildTopicExtractionSQL(remotePatterns = null) {
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
}

/**
 * Builds page category classification SQL using remote patterns
 */
function generatePageTypeClassification(remotePatterns = null) {
  const patterns = remotePatterns?.pagePatterns || [];

  if (patterns.length === 0) {
    return "'Uncategorized'";
  }

  const caseConditions = patterns
    .map((pattern) => `      WHEN REGEXP_LIKE(url, '${pattern.regex}') THEN '${pattern.name}'`)
    .join('\n');

  return `CASE\n${caseConditions}\n      ELSE 'Uncategorized'\n    END`;
}

/**
 * Fetches remote patterns for a site (local implementation)
 * @param {Object} site - Site object
 * @returns {Promise<Object|null>} Remote patterns or null
 */
async function fetchRemotePatterns(site) {
  const dataFolder = site.getConfig()?.getLlmoDataFolder();

  if (!dataFolder) {
    return null;
  }

  try {
    const url = `https://main--project-elmo-ui-data--adobe.aem.live/${dataFolder}/agentic-traffic/patterns/patterns.json`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'spacecat-audit-worker',
        Authorization: `token ${process.env.ADMIN_HLX_API_KEY}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch pattern data from ${url}: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    return {
      pagePatterns: data.pagetype?.data || [],
      topicPatterns: data.products?.data || [],
    };
  } catch {
    return null;
  }
}

// ============================================================================
// QUERY BUILDING UTILITIES
// ============================================================================

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

  // Error status filter - get all error status codes (400-599)
  allConditions.push('status BETWEEN 400 AND 599');

  // Exclude robots and sitemap URLs (simple LIKEs)
  allConditions.push("NOT (url LIKE '%robots.txt' OR url LIKE '%sitemap%')");

  return `WHERE ${allConditions.join(' AND ')}`;
}

export async function buildLlmErrorPagesQuery(options) {
  const {
    databaseName,
    tableName,
    startDate,
    endDate,
    llmProviders = null,
    siteFilters = [],
    site,
  } = options;

  const conditions = [];

  // Date range filter
  if (startDate && endDate) {
    conditions.push(buildDateFilter(startDate, endDate));
  }

  const whereClause = buildWhereClause(conditions, llmProviders, siteFilters);

  // Fetch remote patterns for product/category classification
  const remotePatterns = site ? await fetchRemotePatterns(site) : null;

  return getStaticContent({
    agentTypeClassification: buildAgentTypeClassificationSQL(),
    userAgentDisplay: buildUserAgentDisplaySQL(),
    countryExtraction: buildCountryExtractionSQL(),
    topicExtraction: buildTopicExtractionSQL(remotePatterns),
    pageCategoryClassification: generatePageTypeClassification(remotePatterns),
    databaseName,
    tableName,
    whereClause,
  }, './src/llm-error-pages/sql/llm-error-pages.sql');
}

// ============================================================================
// SITE AND CONFIGURATION UTILITIES
// ============================================================================

export function getAnalysisBucket(customerDomain) {
  const bucketCustomer = customerDomain.replace(REGEX_PATTERNS.BUCKET_SANITIZATION, '-');
  return `${CDN_LOGS_PREFIX}${bucketCustomer}`;
}

export function getS3Config(site) {
  const customerDomain = extractCustomerDomain(site);
  const customerName = customerDomain.split(/[._]/)[0];
  const { bucketName: bucket } = site.getConfig().getCdnLogsConfig()
    || { bucketName: getAnalysisBucket(customerDomain) };

  return {
    bucket,
    customerName,
    customerDomain,
    aggregatedLocation: `s3://${bucket}/aggregated/`,
    databaseName: `cdn_logs_${customerDomain}`,
    tableName: `aggregated_logs_${customerDomain}`,
    getAthenaTempLocation: () => `s3://${bucket}/temp/athena-results/`,
  };
}

// ============================================================================
// DATE AND TIME UTILITIES
// ============================================================================

export function formatDateString(date) {
  return date.toISOString().split('T')[0];
}

function getWeekNumber(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  /* c8 ignore next */
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export function getWeekRange(offsetWeeks = 0, referenceDate = new Date()) {
  const refDate = new Date(referenceDate);
  const isSunday = refDate.getUTCDay() === TIME_CONSTANTS.ISO_SUNDAY;
  const daysToMonday = isSunday ? 6 : refDate.getUTCDay() - TIME_CONSTANTS.ISO_MONDAY;

  const weekStart = new Date(refDate);
  const totalOffset = daysToMonday - (offsetWeeks * TIME_CONSTANTS.DAYS_PER_WEEK);
  weekStart.setUTCDate(refDate.getUTCDate() - totalOffset);
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

export function createDateRange(startInput, endInput) {
  const startDate = new Date(startInput);
  const endDate = new Date(endInput);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid date format provided');
  }

  if (startDate >= endDate) {
    throw new Error('Start date must be before end date');
  }

  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);

  return { startDate, endDate };
}

export function generatePeriodIdentifier(startDate, endDate) {
  const start = formatDateString(startDate);
  const end = formatDateString(endDate);

  const diffDays = Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000));
  if (diffDays === 7) {
    const year = startDate.getUTCFullYear();
    const weekNum = getWeekNumber(startDate);
    return `w${String(weekNum).padStart(2, '0')}-${year}`;
  }

  return `${start}_to_${end}`;
}

export function generateReportingPeriods(referenceDate = new Date()) {
  const { weekStart, weekEnd } = getWeekRange(-1, referenceDate);

  const weekNumber = getWeekNumber(weekStart);
  const year = weekStart.getUTCFullYear();

  const weeks = [{
    weekNumber,
    year,
    weekLabel: `Week ${weekNumber}`,
    startDate: weekStart,
    endDate: weekEnd,
    dateRange: {
      start: formatDateString(weekStart),
      end: formatDateString(weekEnd),
    },
  }];

  return {
    weeks,
    referenceDate: referenceDate.toISOString(),
    columns: [`Week ${weekNumber}`],
  };
}

// ============================================================================
// FILTERING
// ============================================================================

export function buildSiteFilters(filters) {
  if (!filters || filters.length === 0) return '';

  const clauses = filters.map(({ key, value, type }) => {
    const regexPattern = value.join('|');
    if (type === 'exclude') {
      return `NOT REGEXP_LIKE(${key}, '(?i)(${regexPattern})')`;
    }
    return `REGEXP_LIKE(${key}, '(?i)(${regexPattern})')`;
  });

  const filterConditions = clauses.length > 1 ? clauses.join(' AND ') : clauses[0];
  return `(${filterConditions})`;
}

// ============================================================================
// PROCESSING RESULTS
// ============================================================================

export function processErrorPagesResults(results) {
  if (!results || results.length === 0) {
    return {
      totalErrors: 0,
      errorPages: [],
      summary: {
        uniqueUrls: 0,
        uniqueUserAgents: 0,
        statusCodes: {},
      },
    };
  }

  const statusCodes = {};
  const uniqueUrls = new Set();
  const uniqueUserAgents = new Set();

  results.forEach((row) => {
    // Handle new field names from CDN logs report structure
    const numberOfHits = parseInt(row.number_of_hits || row.total_requests, 10);
    // eslint-disable-next-line no-param-reassign
    row.number_of_hits = Number.isNaN(numberOfHits) ? 0 : numberOfHits;

    // Ensure avg_ttfb_ms is a number
    const avgTtfb = parseFloat(row.avg_ttfb_ms);
    // eslint-disable-next-line no-param-reassign
    row.avg_ttfb_ms = Number.isNaN(avgTtfb) ? 0 : avgTtfb;

    const status = row.status || 'Unknown';
    statusCodes[status] = (statusCodes[status] || 0) + row.number_of_hits;
    uniqueUrls.add(row.url);
    const userAgent = row.user_agent_display || row.user_agent;
    if (userAgent) {
      uniqueUserAgents.add(userAgent);
    }
  });

  const totalErrors = Object.values(statusCodes).reduce((sum, count) => sum + count, 0);

  return {
    totalErrors,
    errorPages: results,
    summary: {
      uniqueUrls: uniqueUrls.size,
      uniqueUserAgents: uniqueUserAgents.size,
      statusCodes,
    },
  };
}

/**
 * Categorizes error pages by status code into 404, 403, and 5xx groups
 * Limits each category to top 100 URLs for processing
 * @param {Array} errorPages - Raw error page data from Athena
 * @returns {Object} - Object with categorized errors
 */
export function categorizeErrorsByStatusCode(errorPages) {
  const categorized = {};
  const MAX_URLS_PER_CATEGORY = 100;

  errorPages.forEach((error) => {
    const statusCode = error.status?.toString();
    if (statusCode === '404') {
      if (!categorized[404]) categorized[404] = [];
      if (categorized[404].length < MAX_URLS_PER_CATEGORY) {
        categorized[404].push(error);
      }
    } else if (statusCode === '403') {
      if (!categorized[403]) categorized[403] = [];
      if (categorized[403].length < MAX_URLS_PER_CATEGORY) {
        categorized[403].push(error);
      }
    } else if (statusCode && statusCode.startsWith('5')) {
      if (!categorized['5xx']) categorized['5xx'] = [];
      if (categorized['5xx'].length < MAX_URLS_PER_CATEGORY) {
        categorized['5xx'].push(error);
      }
    }
  });

  return categorized;
}

/**
 * Consolidates errors by URL + Normalized UserAgent combination
 * @param {Array} errors - Array of error objects
 * @returns {Array} - Consolidated errors with aggregated data
 */
export function consolidateErrorsByUrl(errors) {
  const urlMap = new Map();

  errors.forEach((error) => {
    // Use the already processed user agent display name from SQL
    const userAgentDisplay = error.user_agent_display
      || normalizeUserAgentToProvider(error.user_agent);
    const key = `${error.url}|${userAgentDisplay}`;
    if (urlMap.has(key)) {
      const existing = urlMap.get(key);
      const existingHits = existing.numberOfHits;
      const newHits = error.number_of_hits || error.total_requests || 0;
      existing.numberOfHits += newHits;
      existing.totalRequests = existing.numberOfHits; // Keep backward compatibility
      existing.rawUserAgents.add(error.user_agent || userAgentDisplay);
      // Update TTFB with weighted average
      const totalHits = existing.numberOfHits;
      const existingTtfb = existing.avgTtfbMs || 0;
      const newTtfb = error.avg_ttfb_ms || 0;
      existing.avgTtfbMs = totalHits > 0
        ? ((existingTtfb * existingHits) + (newTtfb * newHits)) / totalHits
        : newTtfb;
    } else {
      urlMap.set(key, {
        url: error.url,
        status: error.status,
        userAgent: userAgentDisplay,
        agent_type: error.agent_type || 'Other',
        user_agent_display: userAgentDisplay,
        numberOfHits: error.number_of_hits || error.total_requests || 0,
        avgTtfbMs: error.avg_ttfb_ms || 0,
        country_code: error.country_code || 'GLOBAL',
        product: error.product || 'Other',
        category: error.category || 'Uncategorized',
        rawUserAgents: new Set([error.user_agent || userAgentDisplay]),
        // Keep backward compatibility
        totalRequests: error.number_of_hits || error.total_requests || 0,
      });
    }
  });

  return Array.from(urlMap.values()).map((item) => ({
    ...item,
    rawUserAgents: Array.from(item.rawUserAgents),
  }));
}

/**
 * Sorts consolidated errors by traffic volume (request count) in descending order
 * @param {Array} errors - Array of consolidated error objects
 * @returns {Array} - Sorted errors by traffic volume
 */
export function sortErrorsByTrafficVolume(errors) {
  return errors.sort((a, b) => (b.numberOfHits || b.totalRequests || 0)
    - (a.numberOfHits || a.totalRequests || 0));
}

// =========================================================================
// URL HELPERS
// =========================================================================

/**
 * Returns path + query for a given URL or path. If input is already a path,
 * returns it unchanged.
 * @param {string} maybeUrl
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function toPathOnly(maybeUrl, baseUrl) {
  try {
    const parsed = new URL(maybeUrl, baseUrl || 'https://example.com');
    return parsed.pathname + (parsed.search || '');
  } catch {
    return maybeUrl;
  }
}
