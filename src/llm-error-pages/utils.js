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
import { resolveConsolidatedBucketName, extractCustomerDomain } from '../utils/cdn-utils.js';
import { buildUserAgentDisplaySQL, buildAgentTypeClassificationSQL } from './constants/user-agent-patterns.js';

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

export async function fetchRemotePatterns(site) {
  const dataFolder = site.getConfig()?.getLlmoDataFolder?.();
  if (!dataFolder) {
    return null;
  }

  try {
    const url = `https://main--project-elmo-ui-data--adobe.aem.live/${dataFolder}/agentic-traffic/patterns/patterns.json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'spacecat-audit-worker',
        Authorization: `token ${process.env.LLMO_HLX_API_KEY}`,
      },
    });
    if (!res.ok) {
      return null;
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

function generatePageTypeClassification(remotePatterns = null) {
  const patterns = remotePatterns?.pagePatterns || [];
  if (patterns.length === 0) {
    return "'Other'";
  }
  const caseConditions = patterns
    .map((pattern) => `      WHEN REGEXP_LIKE(url, '${pattern.regex}') THEN '${pattern.name}'`)
    .join('\n');
  return `CASE\n${caseConditions}\n      ELSE 'Other'\n    END`;
}

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

export async function buildLlmErrorPagesQuery(options) {
  const {
    databaseName,
    tableName,
    startDate,
    endDate,
    llmProviders = null,
    siteFilters = [],
    site = null,
  } = options;

  const conditions = [];

  // Date range filter
  if (startDate && endDate) {
    conditions.push(buildDateFilter(startDate, endDate));
  }

  const whereClause = buildWhereClause(conditions, llmProviders, siteFilters);

  const remotePatterns = site ? await fetchRemotePatterns(site) : null;

  return getStaticContent({
    databaseName,
    tableName,
    whereClause,
    // user-agent labeling and classification
    userAgentDisplay: buildUserAgentDisplaySQL(),
    agentTypeClassification: buildAgentTypeClassificationSQL(),
    // product/category classification via patterns
    topicExtraction: buildTopicExtractionSQL(remotePatterns),
    pageCategoryClassification: generatePageTypeClassification(remotePatterns),
  }, './src/llm-error-pages/sql/llm-error-pages.sql');
}

// ============================================================================
// SITE AND CONFIGURATION UTILITIES
// ============================================================================
export async function getS3Config(site, context) {
  const customerDomain = extractCustomerDomain(site);

  const domainParts = customerDomain.split(/[._]/);
  /* c8 ignore next */
  const customerName = domainParts[0] === 'www' && domainParts.length > 1 ? domainParts[1] : domainParts[0];
  const bucket = resolveConsolidatedBucketName(context);
  const siteId = site.getId();
  const aggregatedLocation = `s3://${bucket}/aggregated/${siteId}/`;

  return {
    bucket,
    customerName,
    customerDomain,
    aggregatedLocation,
    databaseName: `cdn_logs_${customerDomain}`,
    tableName: `aggregated_logs_${customerDomain}_consolidated`,
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

export function buildSiteFilters(filters, site) {
  if ((!filters || filters.length === 0) && site) {
    const baseURL = site.getBaseURL();
    const { host } = new URL(baseURL);
    return `REGEXP_LIKE(host, '(?i)(${host})')`;
  }

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

export const SPREADSHEET_COLUMNS = [
  'Agent Type',
  'User Agent',
  'Number of Hits',
  'Avg TTFB (ms)',
  'Country Code',
  'URL',
  'Product',
  'Category',
  'Suggested URLs',
  'AI Rationale',
  'Confidence score',
];

/**
 * Downloads and parses existing CDN agentic traffic sheet
 * @param {string} periodIdentifier - The period identifier (e.g., 'w35-2025')
 * @param {string} outputLocation - SharePoint folder location
 * @param {Object} sharepointClient - SharePoint client
 * @param {Object} log - Logger instance
 * @param {Function} readFromSharePoint - Function to read from SharePoint
 * @param {Object} ExcelJS - ExcelJS module
 * @returns {Array|null} - Array of CDN data rows or null if failed
 */
export async function downloadExistingCdnSheet(
  periodIdentifier,
  outputLocation,
  sharepointClient,
  log,
  readFromSharePoint,
  ExcelJS,
) {
  try {
    const filename = `agentictraffic-${periodIdentifier}.xlsx`;
    log.debug(`Attempting to download existing CDN sheet: ${filename}`);

    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0]; // First sheet
    const rows = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;

      const { values } = row;
      rows.push({
        agent_type: values[1],
        user_agent_display: values[2],
        status: values[3],
        number_of_hits: Number(values[4]) || 0,
        avg_ttfb_ms: Number(values[5]) || 0,
        country_code: values[6],
        url: values[7],
        product: values[8],
        category: values[9],
      });
    });

    log.debug(`Successfully loaded ${rows.length} rows from existing CDN sheet`);
    return rows;
  } catch (error) {
    log.warn(`Could not download existing CDN sheet: ${error.message}`);
    return null;
  }
}

/**
 * Matches error data with existing CDN data and enriches it
 * @param {Array} errors - Error data from Athena
 * @param {Array} cdnData - Existing CDN data from sheet
 * @param {string} baseUrl - Base URL for path conversion
 * @returns {Array} - Enriched error data with CDN fields
 */
export function matchErrorsWithCdnData(errors, cdnData, baseUrl) {
  const enrichedErrors = [];

  errors.forEach((error) => {
    const errorUrl = toPathOnly(error.url, baseUrl);
    const errorUserAgent = error.user_agent;
    const match = cdnData.find((cdnRow) => {
      let cdnUrl;
      if (cdnRow.url === '/') {
        cdnUrl = '/';
      } else {
        cdnUrl = cdnRow.url || '';
      }

      const urlMatch = errorUrl === cdnUrl
        || errorUrl.includes(cdnUrl)
        || cdnUrl.includes(errorUrl);

      const userAgentMatch = cdnRow.user_agent_display === errorUserAgent
        || (cdnRow.user_agent_display && errorUserAgent
          && cdnRow.user_agent_display.toLowerCase().includes(errorUserAgent.toLowerCase()))
        || (errorUserAgent && cdnRow.user_agent_display
          && errorUserAgent.toLowerCase().includes(cdnRow.user_agent_display.toLowerCase()));

      return urlMatch && userAgentMatch;
    });

    if (match) {
      enrichedErrors.push({
        agent_type: match.agent_type,
        user_agent_display: match.user_agent_display,
        number_of_hits: error.total_requests || match.number_of_hits,
        avg_ttfb_ms: match.avg_ttfb_ms,
        country_code: match.country_code,
        url: errorUrl,
        product: match.product,
        category: match.category,
      });
    }
  });

  return enrichedErrors;
}
