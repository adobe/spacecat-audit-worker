/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Computes sentiment topic payloads (urls with timesCited, category, subPrompts) from
 * LLMO brand-presence sheet data, mirroring the aggregation in offsite-brand-presence.
 */

import ExcelJS from 'exceljs';
import { isoCalendarWeek } from '@adobe/spacecat-shared-utils';
import { isBrandalfEnabled, resolveOrganizationIdForSite } from './brandalf-utils.js';
import { loadBrandPresenceDataFromPostgrest } from './offsite-brand-presence-postgrest.js';
import { createLLMOSharepointClient, readFromSharePointWithRetry } from './report-uploader.js';
import { buildColumnMap, getColumn } from '../faqs/utils.js';
import {
  BRAND_PRESENCE_REGEX,
  OFFSITE_DOMAINS,
  PROVIDERS_SET,
} from '../offsite-brand-presence/constants.js';

const LOG_PREFIX = '[BrandPresenceEnrichment]';

const DOMAIN_ALIASES = Object.freeze({
  'youtu.be': 'youtube.com',
});

/**
 * Gets the ISO week number and year for the previous two weeks.
 * @returns {Array<{ week: number, year: number }>} Previous two weeks (most recent first)
 */
export function getPreviousWeeks() {
  return [1, 2].map((i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (7 * i));
    return isoCalendarWeek(d);
  });
}

const BP_COLUMNS = ['Sources', 'Region', 'Topics', 'Category', 'Prompt'];

/**
 * Coerces an ExcelJS cell value to a plain string. ExcelJS represents non-trivial
 * cells as objects (hyperlinks `{ text, hyperlink }`, rich text `{ richText }`,
 * formulas `{ formula, result }`), so a naive `.toString()` yields "[object Object]"
 * and corrupts the data (e.g. URLs in the Sources column). This unwraps those shapes.
 *
 * @param {*} value - Raw `cell.value` from ExcelJS
 * @returns {string} The cell's textual content, or '' when empty/unrepresentable
 */
function cellValueToString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value.richText)) {
    return value.richText.map((run) => run?.text ?? '').join('');
  }
  if (value.text !== undefined) {
    return cellValueToString(value.text);
  }
  if (value.result !== undefined) {
    return cellValueToString(value.result);
  }
  return '';
}

/**
 * Reads query-index.xlsx from SharePoint and extracts brand-presence paths.
 *
 * @param {object} site - Site entity
 * @param {object} sharepointClient - SharePoint client instance
 * @param {object} log - Logger instance
 * @returns {Promise<{ sourceFolder: string, paths: string[] }|null>}
 */
async function readQueryIndexPaths(site, sharepointClient, log) {
  const dataFolder = site.getConfig?.()?.getLlmoDataFolder?.();
  if (!dataFolder) {
    log.warn(`${LOG_PREFIX} No LLMO data folder configured for site`);
    return null;
  }

  const buffer = await readFromSharePointWithRetry('query-index.xlsx', dataFolder, sharepointClient, log);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const paths = [];
  workbook.worksheets.forEach((worksheet) => {
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      row.eachCell((cell) => {
        const val = cellValueToString(cell.value);
        if (!val.includes('/brand-presence/') || val.includes('/brand-presence/latest/')) {
          return;
        }

        const marker = '/brand-presence/';
        const relPath = val.slice(val.indexOf(marker) + marker.length)
          .replace(/\.\w+$/i, '');
        if (relPath && !paths.includes(relPath)) {
          paths.push(relPath);
        }
      });
    });
  });

  return { sourceFolder: `${dataFolder}/brand-presence`, paths };
}

/**
 * Reads a brand-presence XLSX sheet from SharePoint and returns row objects.
 *
 * @param {string} sheetName - Sheet base name (without .xlsx)
 * @param {string} sourceFolder - SharePoint folder path
 * @param {object} sharepointClient - SharePoint client instance
 * @param {object} log - Logger instance
 * @returns {Promise<{ data: object[] }|null>}
 */
async function readBrandPresenceSheet(sheetName, sourceFolder, sharepointClient, log) {
  const buffer = await readFromSharePointWithRetry(`${sheetName}.xlsx`, sourceFolder, sharepointClient, log);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return null;
  }

  const colMap = buildColumnMap(worksheet);
  const colIndices = BP_COLUMNS.map((name) => ({ name, idx: getColumn(colMap, name) }));

  const rows = [];
  const dataRows = worksheet.getRows(2, worksheet.rowCount - 1) || [];
  for (const row of dataRows) {
    const obj = {};
    for (const { name, idx } of colIndices) {
      obj[name] = idx ? cellValueToString(row.getCell(idx).value) : '';
    }
    rows.push(obj);
  }
  return { data: rows };
}

/**
 * Tests whether a brand-presence path matches a target week/year and known provider.
 *
 * @param {string} path - A brand-presence relative path (e.g. "w07/brandpresence-copilot-w07-2026")
 * @param {number} targetWeek - The target week number to match
 * @param {number} targetYear - The target year to match
 * @returns {boolean}
 */
function matchBrandPresencePath(path, targetWeek, targetYear) {
  if (!path) {
    return false;
  }

  const match = path.match(BRAND_PRESENCE_REGEX);
  if (!match) {
    return false;
  }

  const [, providerId, weekStr, yearStr] = match;
  const fileWeek = Number.parseInt(weekStr, 10);
  const fileYear = Number.parseInt(yearStr, 10);

  return fileWeek === targetWeek && fileYear === targetYear && PROVIDERS_SET.has(providerId);
}

/**
 * Filters brand presence paths extracted from the query-index XLSX.
 *
 * @param {string[]} paths - Relative paths from query-index (extension-stripped)
 * @param {number} targetWeek - The target week number to match
 * @param {number} targetYear - The target year to match
 * @returns {string[]} Matched paths
 */
export function filterBrandPresenceFiles(paths, targetWeek, targetYear) {
  const entries = paths || [];
  return entries.filter((p) => matchBrandPresencePath(p, targetWeek, targetYear));
}

/**
 * Normalizes a YouTube URL to keep only essential identifiers.
 *
 * @param {URL} parsed - Parsed URL object
 * @returns {string} Normalized URL
 */
function normalizeYoutubeUrl(parsed) {
  const { pathname } = parsed;

  if (pathname.startsWith('/watch')) {
    const videoId = parsed.searchParams.get('v');
    if (videoId) {
      return `https://youtu.be/${videoId}`;
    }
  }

  return `${parsed.origin}${pathname}`;
}

/**
 * Normalizes a parsed URL based on its domain.
 *
 * @param {URL} parsed - Parsed URL object
 * @param {string|null} domain - The matched offsite domain, or null for generic URLs
 * @returns {string} The normalized URL
 */
function normalizeUrl(parsed, domain) {
  let url = domain === 'youtube.com'
    ? normalizeYoutubeUrl(parsed)
    : `${parsed.origin}${parsed.pathname}`;

  if (url.endsWith('/') && parsed.pathname !== '/') {
    url = url.slice(0, -1);
  }

  return url;
}

/**
 * Classifies a URL into its matching offsite domain (if any) and normalizes it.
 * Filters out URLs belonging to the client's own site when siteHostname is provided.
 *
 * @param {string} rawUrl - The raw URL string to classify and normalize
 * @param {string} [siteHostname] - The client site's hostname (www-stripped); URLs
 *   matching this hostname or any subdomain of it are excluded
 * @returns {{ url: string, domain: string|null } | null} Normalized URL with domain, or null
 */
function classifyAndNormalize(rawUrl, siteHostname) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
    parsed.protocol = 'https:';
  } catch {
    return null;
  }

  const { hostname } = parsed;

  if (siteHostname) {
    const bare = hostname.replace(/^www\./, '');
    if (bare === siteHostname || bare.endsWith(`.${siteHostname}`)) {
      return null;
    }
  }
  for (const domain of Object.keys(OFFSITE_DOMAINS)) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return { url: normalizeUrl(parsed, domain), domain };
    }
  }

  const aliasedDomain = DOMAIN_ALIASES[hostname];
  if (aliasedDomain) {
    return { url: normalizeUrl(parsed, aliasedDomain), domain: aliasedDomain };
  }

  return { url: normalizeUrl(parsed, null), domain: null };
}

/**
 * Records a URL association for a topic, tracking category and prompt.
 *
 * @param {Map<string, {category: string, urlMap: Map}>} topicMap - Topic map (mutated)
 * @param {string} topicName - The topic name
 * @param {string} url - The normalized URL
 * @param {string} category - The category from the brand presence row
 * @param {string} prompt - The prompt from the brand presence row
 */
function trackTopicUrl(topicMap, topicName, url, category, prompt) {
  let topic = topicMap.get(topicName);
  if (!topic) {
    topic = { category, urlMap: new Map() };
    topicMap.set(topicName, topic);
  }
  let urlEntry = topic.urlMap.get(url);
  if (!urlEntry) {
    urlEntry = { category, subPrompts: new Set() };
    topic.urlMap.set(url, urlEntry);
  }
  if (prompt) {
    urlEntry.subPrompts.add(prompt);
  }
}

/**
 * Extracts URLs and topic associations from brand presence data rows in a single pass.
 * Only processes rows with Region=US.
 *
 * @param {object} data - Brand presence JSON data (expects a "data" array of rows)
 * @param {Map<string, {count: number, domain: string|null}>} allUrls - Global URL map (mutated)
 * @param {Map<string, {category: string, urlMap: Map}>} topicMap - Topic map (mutated)
 * @param {object} log - Logger instance
 * @param {string} [siteHostname] - Client site hostname to exclude
 */
function extractUrlsAndTopics(data, allUrls, topicMap, log, siteHostname) {
  const rows = data.data;
  for (const row of rows) {
    const sources = row.Sources?.trim();
    if (!sources || row.Region !== 'US') {
      // eslint-disable-next-line no-continue
      continue;
    }

    const topicName = row.Topics?.trim();
    const prompt = row.Prompt?.trim();
    const category = row.Category?.trim() || '';

    for (const raw of sources.split(/[;\n]/)) {
      const trimmed = raw.trim();
      if (!trimmed) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const result = classifyAndNormalize(trimmed, siteHostname);
      if (!result) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const existing = allUrls.get(result.url);
      if (existing) {
        existing.count += 1;
      } else {
        allUrls.set(result.url, { count: 1, domain: result.domain });
      }

      if (topicName) {
        trackTopicUrl(topicMap, topicName, result.url, category, prompt);
      }
    }
  }
  log.info(`${LOG_PREFIX} Found ${allUrls.size} unique source URLs`);
}

/**
 * Loads brand-presence data for the given site via PostgREST (brandalf orgs)
 * or the legacy file-fetch path.  Returns raw rows wrapped in `{ data }` so
 * callers can run their own extraction/aggregation.
 *
 * @param {object} opts
 * @param {string} opts.siteId - Site ID
 * @param {object} [opts.site] - Site entity (optional fast-path for org resolution)
 * @param {Array<{week: number, year: number}>} opts.previousWeeks - Weeks to load
 * @param {object} opts.context - Lambda context (env, log, dataAccess)
 * @returns {Promise<{data: object[]}|null>} Raw brand-presence rows or null
 */
export async function loadBrandPresenceData({
  siteId, site, previousWeeks, context,
}) {
  const { log } = context;

  const organizationId = await resolveOrganizationIdForSite({
    site,
    siteId,
    dataAccess: context.dataAccess,
    log,
  });

  const isBrandalfOrg = organizationId
    ? await isBrandalfEnabled(organizationId, context.dataAccess?.services?.postgrestClient, log)
    : false;

  if (isBrandalfOrg === null) {
    log.warn(`${LOG_PREFIX} Brandalf flag state unknown for org ${organizationId}; skipping legacy file fetch for site ${siteId}`);
    return null;
  }

  if (isBrandalfOrg) {
    const postgrestClient = context.dataAccess?.services?.postgrestClient;
    const dbData = await loadBrandPresenceDataFromPostgrest({
      siteId,
      organizationId,
      previousWeeks,
      postgrestClient,
      log,
    });
    if (dbData) {
      return dbData;
    }
    log.info(`${LOG_PREFIX} No PostgREST data for brandalf-enabled site ${siteId}, falling back to SharePoint file fetch`);
  }

  let resolvedSite = site;
  if (!resolvedSite) {
    resolvedSite = await context.dataAccess?.Site?.findById(siteId);
  }
  if (!resolvedSite) {
    log.warn(`${LOG_PREFIX} Cannot resolve site for ${siteId}, skipping SharePoint fetch`);
    return null;
  }

  let sharepointClient;
  let queryResult;
  try {
    sharepointClient = await createLLMOSharepointClient(context);
    queryResult = await readQueryIndexPaths(resolvedSite, sharepointClient, log);
  } catch (error) {
    log.error(`${LOG_PREFIX} Error reading query-index from SharePoint: ${error.message}`);
    return null;
  }

  if (!queryResult || queryResult.paths.length === 0) {
    log.warn(`${LOG_PREFIX} Failed to read query-index for site ${siteId}`);
    return null;
  }

  const { sourceFolder, paths } = queryResult;

  const weekLabels = previousWeeks
    .map(({ week, year }) => `w${String(week).padStart(2, '0')}-${year}`)
    .join(', ');

  const matchedFiles = previousWeeks.flatMap(
    ({ week, year }) => filterBrandPresenceFiles(paths, week, year),
  );
  log.info(`${LOG_PREFIX} Found ${matchedFiles.length} brand presence files for weeks ${weekLabels}`);

  if (matchedFiles.length === 0) {
    return null;
  }

  const allRows = [];
  for (const sheetName of matchedFiles) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const data = await readBrandPresenceSheet(sheetName, sourceFolder, sharepointClient, log);
      if (!data) {
        // eslint-disable-next-line no-continue
        continue;
      }
      allRows.push(...data.data);
    } catch (err) {
      log.error(`${LOG_PREFIX} Error reading brand presence sheet ${sheetName}: ${err.message}`);
    }
  }

  if (allRows.length === 0) {
    return null;
  }
  return { data: allRows };
}

/**
 * Converts aggregated topic maps into the shape expected by enrichUrlsWithTopicData.
 *
 * @param {Map<string, {category: string, urlMap: Map}>} topicMap - Aggregated topic data
 * @param {Map<string, {count: number, domain: string|null}>} allUrls - Global URL citation map
 * @returns {Array<{
 *   name: string,
 *   urls: Array<{ url: string, timesCited: number, category: string, subPrompts: string[] }>
 * }>}
 */
export function formatTopicsForEnrichment(topicMap, allUrls) {
  return [...topicMap.entries()].map(([name, topicData]) => ({
    name,
    urls: [...topicData.urlMap.entries()].map(([url, info]) => ({
      url,
      timesCited: allUrls.get(url)?.count ?? 0,
      category: info.category,
      subPrompts: [...info.subPrompts],
    })),
  }));
}

/**
 * Loads brand-presence LLMO data for the previous ISO week and returns topic objects
 * with per-URL citation counts and prompts for URL-topic enrichment.
 *
 * @param {string} siteId - Site ID
 * @param {{ env: object, log: object }} context - Lambda context
 * @param {object} [site] - Site entity; when provided, URLs matching the site's own
 *   hostname are filtered out
 * @returns {Promise<Array<{ name: string, urls: object[] }>>}
 */
export async function computeTopicsFromBrandPresence(siteId, context, site) {
  const { log } = context;

  const previousWeeks = getPreviousWeeks();
  const weekLabels = previousWeeks
    .map(({ week, year }) => `w${String(week).padStart(2, '0')}-${year}`)
    .join(', ');
  log.info(`${LOG_PREFIX} Processing weeks: ${weekLabels}`);

  const brandPresenceData = await loadBrandPresenceData({
    siteId, site, previousWeeks, context,
  });
  if (!brandPresenceData) {
    return [];
  }

  const baseURL = site?.getBaseURL?.();
  let siteHostname;
  if (baseURL) {
    try {
      siteHostname = new URL(baseURL).hostname.replace(/^www\./, '');
    } catch {
      log.warn(`${LOG_PREFIX} Could not parse baseURL "${baseURL}", skipping site URL filter`);
    }
  }

  const allUrls = new Map();
  const topicMap = new Map();
  extractUrlsAndTopics(brandPresenceData, allUrls, topicMap, log, siteHostname);

  return formatTopicsForEnrichment(topicMap, allUrls);
}
