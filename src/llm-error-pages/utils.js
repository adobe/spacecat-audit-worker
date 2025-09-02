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
import { resolveCdnBucketName } from '../utils/cdn-utils.js';

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

export function normalizeUserAgentToProvider(rawUserAgent) {
  if (!rawUserAgent || typeof rawUserAgent !== 'string') return 'Unknown';

  if (/chatgpt|gptbot|oai-searchbot/i.test(rawUserAgent)) {
    return 'ChatGPT';
  }
  if (/perplexity/i.test(rawUserAgent)) {
    return 'Perplexity';
  }
  if (/claude|anthropic/i.test(rawUserAgent)) {
    return 'Claude';
  }
  if (/gemini/i.test(rawUserAgent)) {
    return 'Gemini';
  }
  if (/copilot/i.test(rawUserAgent)) {
    return 'Copilot';
  }

  return rawUserAgent;
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

export function buildLlmErrorPagesQuery(options) {
  const {
    databaseName,
    tableName,
    startDate,
    endDate,
    llmProviders = null,
    siteFilters = [],
  } = options;

  const conditions = [];

  // Date range filter
  if (startDate && endDate) {
    conditions.push(buildDateFilter(startDate, endDate));
  }

  const whereClause = buildWhereClause(conditions, llmProviders, siteFilters);

  return getStaticContent({
    databaseName,
    tableName,
    whereClause,
  }, './src/llm-error-pages/sql/llm-error-pages.sql');
}

// ============================================================================
// SITE AND CONFIGURATION UTILITIES
// ============================================================================

export function extractCustomerDomain(site) {
  return new URL(site.getBaseURL()).host
    .replace(REGEX_PATTERNS.URL_SANITIZATION, '_')
    .toLowerCase();
}

export function getAnalysisBucket(customerDomain) {
  const bucketCustomer = customerDomain.replace(REGEX_PATTERNS.BUCKET_SANITIZATION, '-');
  return `${CDN_LOGS_PREFIX}${bucketCustomer}`;
}

export async function getS3Config(site, context) {
  const customerDomain = extractCustomerDomain(site);
  const customerName = customerDomain.split(/[._]/)[0];

  // Prefer explicit config bucket if present
  const configured = site.getConfig()?.getCdnLogsConfig?.();
  let bucket = configured?.bucketName;

  // Fallback to resolver (standard path via CDN utils)
  if (!bucket) {
    try {
      bucket = await resolveCdnBucketName(site, context);
    } catch {
      // ignore and fallback further below
    }
  }

  // Final fallback to derived analysis bucket
  if (!bucket) {
    bucket = getAnalysisBucket(customerDomain);
  }

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
    const totalRequestsParsed = parseInt(row.total_requests, 10);
    // eslint-disable-next-line no-param-reassign
    row.total_requests = Number.isNaN(totalRequestsParsed) ? 0 : totalRequestsParsed;
    const status = row.status || 'Unknown';
    statusCodes[status] = (statusCodes[status] || 0) + row.total_requests;
    uniqueUrls.add(row.url);
    uniqueUserAgents.add(row.user_agent);
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
 * @param {Array} errorPages - Raw error page data from Athena
 * @returns {Object} - Object with categorized errors
 */
export function categorizeErrorsByStatusCode(errorPages) {
  const categorized = {};

  errorPages.forEach((error) => {
    const statusCode = error.status?.toString();
    if (statusCode === '404') {
      if (!categorized[404]) categorized[404] = [];
      categorized[404].push(error);
    } else if (statusCode === '403') {
      if (!categorized[403]) categorized[403] = [];
      categorized[403].push(error);
    } else if (statusCode && statusCode.startsWith('5')) {
      if (!categorized['5xx']) categorized['5xx'] = [];
      categorized['5xx'].push(error);
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
    // Normalize user agent to clean provider name
    const normalizedUserAgent = normalizeUserAgentToProvider(error.user_agent);
    const key = `${error.url}|${normalizedUserAgent}`;
    if (urlMap.has(key)) {
      const existing = urlMap.get(key);
      existing.totalRequests += error.total_requests;
      existing.rawUserAgents.add(error.user_agent); // Track all raw UAs for this provider
    } else {
      urlMap.set(key, {
        url: error.url,
        status: error.status,
        userAgent: normalizedUserAgent, // Clean provider name (e.g., "ChatGPT")
        rawUserAgents: new Set([error.user_agent]), // Raw UA strings
        totalRequests: error.total_requests,
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
  return errors.sort((a, b) => b.totalRequests - a.totalRequests);
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
