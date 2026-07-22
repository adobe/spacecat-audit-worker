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

import {
  hasText,
  prependSchema,
  stripWWW,
  tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';

// ── Entity replacement detection ──────────────────────────────────────────────

/**
 * Directories strongly associated with person/entity leaf pages.
 * A sibling substitution within these sections (e.g. /team/john-smith →
 * /team/jane-doe) is semantically wrong and should be rejected.
 */
const ENTITY_SECTIONS = new Set([
  'contact', 'contacts', 'team', 'people', 'staff',
  'author', 'authors', 'speaker', 'speakers', 'profile', 'profiles',
  'board', 'leadership', 'members', 'member', 'expert', 'experts',
  'advisor', 'advisors', 'faculty', 'coach', 'coaches',
  'attorney', 'attorneys', 'doctor', 'doctors', 'agent', 'agents',
  'employee', 'employees', 'contributor', 'contributors',
  'instructor', 'instructors', 'partner', 'partners',
  'executive', 'executives', 'management', 'directory',
]);

/**
 * Words that appear in article/blog slugs but not in person names.
 * A slug segment matching one of these is not a person-name slug.
 */
const SLUG_STOP_WORDS = new Set([
  'how', 'the', 'for', 'and', 'with', 'from', 'into', 'about',
  'new', 'old', 'top', 'best', 'your', 'our', 'get', 'use', 'its',
  'what', 'why', 'when', 'where', 'who', 'which', 'are', 'was',
  'part', 'page', 'post', 'blog', 'news', 'tips', 'guide', 'series',
  'intro', 'overview', 'review', 'update', 'release', 'launch',
  'all', 'key', 'see', 'now', 'via',
]);

/**
 * Returns true if slug looks like a person name (e.g. john-smith, mary-jo-watson).
 * Criteria: 2–3 hyphen-separated alphabetic segments, no stop words.
 * @param {string} slug
 * @returns {boolean}
 */
function looksLikePersonSlug(slug) {
  if (!slug || slug.includes('.')) {
    return false;
  }
  const parts = slug.split('-');
  if (parts.length < 2 || parts.length > 3) {
    return false;
  }
  if (!parts.every((p) => /^[a-z]{2,15}$/.test(p))) {
    return false;
  }
  if (parts.some((p) => SLUG_STOP_WORDS.has(p))) {
    return false;
  }
  return true;
}

/**
 * Returns true if slug looks like a database record ID — either a pure integer
 * or a prefixed integer (e.g. "917", "2671", "ticketevent-1226947352").
 * These slugs represent deleted records; the parent path is always a better
 * fallback than any sibling page.
 * @param {string} slug
 * @returns {boolean}
 */
function looksLikeRecordId(slug) {
  // Pure numeric: "917", "614", "2671"
  if (/^\d+$/.test(slug)) {
    return true;
  }
  // Prefixed numeric: "ticketevent-1226947352", "event-1645182281"
  if (/^[a-z]+-\d{6,}$/.test(slug)) {
    return true;
  }
  return false;
}

/**
 * Returns true when suggestedUrl replaces one specific person/entity with a
 * different one under the same parent path — a semantically invalid substitution.
 *
 * Triggers when ALL of the following hold:
 * 1. Both URLs are leaf pages at the same depth under the same parent directory.
 * 2. Their last path segments differ.
 * 3. Either: the parent directory is a known entity section AND at least one
 *    slug looks like a person name, OR both slugs look like person names,
 *    OR the broken slug is a database record ID (pure/prefixed integer).
 *
 * @param {string} brokenUrl   - The original broken target URL.
 * @param {string} suggestedUrl - The candidate replacement URL.
 * @returns {boolean}
 */
export function isEntityReplacementSuggestion(brokenUrl, suggestedUrl) {
  try {
    const bParsed = new URL(brokenUrl);
    const sParsed = new URL(suggestedUrl);
    if (stripWWW(bParsed.hostname) !== stripWWW(sParsed.hostname)) {
      return false;
    }
    const bSegs = bParsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const sSegs = sParsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);

    if (bSegs.length < 2) {
      return false;
    }

    const bSlug = bSegs.at(-1);
    const sSlug = sSegs.at(-1);
    if (bSlug === sSlug) {
      return false;
    }

    // ── Record-ID broken slugs ─────────────────────────────────────────────
    // If the broken slug is a database record ID (pure numeric like "917" or
    // prefixed like "ticketevent-1226947352"), the record was deleted and no
    // sibling page is an appropriate replacement.
    if (looksLikeRecordId(bSlug)) {
      if (bSegs.length === sSegs.length) {
        // Same depth: any sibling is wrong (e.g. event-schedule/917 → event-schedule/2671).
        return bSegs.slice(0, -1).join('/') === sSegs.slice(0, -1).join('/');
      }
      if (sSegs.length === bSegs.length - 1) {
        // Suggestion is one level shallower: filter siblings of the parent directory
        // (e.g. events/babymetal when broken is events/event-schedule/917), but keep
        // the parent directory itself (events/event-schedule/ is the correct fallback).
        const bGrandParentPath = bSegs.slice(0, -2).join('/');
        const sSuggParentPath = sSegs.slice(0, -1).join('/');
        const brokenParentDir = bSegs.at(-2);
        const suggestedDir = sSegs.at(-1);
        return bGrandParentPath === sSuggParentPath && suggestedDir !== brokenParentDir;
      }
      return false;
    }

    // ── Person/entity section check (original logic) ───────────────────────
    if (bSegs.length !== sSegs.length) {
      return false;
    }
    if (bSegs.slice(0, -1).join('/') !== sSegs.slice(0, -1).join('/')) {
      return false;
    }

    const parent = bSegs.at(-2).toLowerCase();
    const inEntitySection = ENTITY_SECTIONS.has(parent);
    const bPerson = looksLikePersonSlug(bSlug);
    const sPerson = looksLikePersonSlug(sSlug);

    if (inEntitySection && (bPerson || sPerson)) {
      return true;
    }
    if (bPerson && sPerson) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Walks up the broken URL's path hierarchy, returning the first parent path
 * that responds with HTTP 200. Stops before the root (depth 0 is never tried).
 *
 * e.g. brokenUrl = https://example.com/contact/john-smith
 *   → tries https://example.com/contact/  (returns it if 200)
 *   → stops (next level is root)
 *
 * @param {string} brokenUrl - The original broken target URL.
 * @returns {Promise<string|null>} - A valid parent URL, or null if none found.
 */
export async function resolveParentPathFallback(brokenUrl) {
  try {
    const parsed = new URL(brokenUrl);
    const segs = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);

    for (let depth = segs.length - 1; depth >= 1; depth -= 1) {
      const parentPath = `/${segs.slice(0, depth).join('/')}/`;
      const parentUrl = `${parsed.origin}${parentPath}`;

      try {
        // Sequential by design: stop at the first parent that responds 200
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(parentUrl);
        if (response.ok) {
          return parentUrl;
        }
      } catch {
        // network/SSL error — try next level up
      }
    }
  } catch {
    // malformed brokenUrl
  }
  return null;
}

/**
 * Checks if a given URL is a "preview" page
 *
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL is a "preview" page, false otherwise
 */
export function isPreviewPage(url) {
  const urlObj = new URL(url);
  return urlObj.hostname.endsWith('.page');
}

export async function filterBrokenSuggestedUrls(
  suggestedUrls,
  baseURL,
  timeoutMs = 5000,
  fetchFn = fetch,
  log = null,
) {
  // Strip www from both sides for consistent domain comparison
  const baseDomain = stripWWW(new URL(baseURL).hostname);
  const checks = suggestedUrls.map(async (suggestedUrl) => {
    try {
      const schemaPrependedUrl = prependSchema(suggestedUrl);
      const suggestedURLObj = new URL(schemaPrependedUrl);
      const suggestedDomain = stripWWW(suggestedURLObj.hostname);
      if (suggestedDomain === baseDomain) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchFn(schemaPrependedUrl, { signal: controller.signal });
          // Only filter confirmed 404s — CDN blocks (403, 429, 5xx) may be valid pages
          if (response.status !== 404) {
            return suggestedUrl;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }
      return null;
    } catch (error) {
      log?.warn(`Backlinks: failed to validate suggested URL ${suggestedUrl}: ${error.message}`);
      return null;
    }
  });
  return (await Promise.all(checks)).filter((url) => url !== null);
}

/**
 * Gets the country code (lowercased) from a language code.
 * If the language code is not in the format of "language-country" or "language_country",
 * the default country code is returned.
 * @param {string} lang - The language code.
 * @param {string} defaultCountry - The default country code.
 * @returns {string} - The country code.
 */
export function getCountryCodeFromLang(lang, defaultCountry = 'us') {
  if (!hasText(lang)) {
    return defaultCountry;
  }
  // Split on hyphen or underscore (both are used in the wild)
  const parts = lang.split(/[-_]/);
  if (parts.length === 2 && parts[1].length === 2) {
    // Return the country part, uppercased
    return parts[1].toLowerCase();
  }
  // If only language is present, return default
  return defaultCountry;
}

/**
 * Parses comma-separated URLs from Slack command data
 * @param {string} data - Comma-separated URLs string
 * @returns {Array|null} Array of unique URLs or null
 */
export function parseCustomUrls(data) {
  if (!hasText(data)) {
    return null;
  }

  const urls = data
    .split(',')
    .map((url) => url.trim())
    .map((url) => url.replace(/^<|>$/g, '').trim()) // Remove < at start and > at end, then trim again
    .filter((url) => hasText(url));

  return urls.length > 0 ? [...new Set(urls)] : null;
}

/**
 * Finds the best matching path from config based on context.
 * Sorts by depth (deepest first) to find most specific match.
 * Use case: Config path resolution for multi-locale configurations.
 * @param {Object} sectionData - The config section (e.g., public).
 * @param {string} contextPath - The path to match (e.g., '/en/us/products').
 * @returns {string} The best matching config key.
 */
export function findBestMatchingPath(sectionData, contextPath) {
  if (!hasText(contextPath) || contextPath === 'default') {
    return 'default';
  }

  const paths = Object.keys(sectionData)
    .filter((key) => key !== 'default')
    .sort((a, b) => {
      const aDepth = a.split('/').filter(Boolean).length;
      const bDepth = b.split('/').filter(Boolean).length;
      return bDepth - aDepth; // Deepest first
    });

  // Find exact match or startsWith match
  for (const path of paths) {
    if (contextPath === path || contextPath.startsWith(path)) {
      return path;
    }
  }

  return 'default';
}

/**
 * Removes trailing slash from a URL if present.
 * @param {string} url - The URL to process
 * @returns {string} URL without trailing slash
 */
export function removeTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Gets the base URL from a full URL, optionally returning only the hostname.
 * @param {string} url - The full URL
 * @param {boolean} useHostnameOnly - If true, returns protocol + host only
 * @returns {string} Base URL (with or without path)
 */
export function getBaseUrl(url, useHostnameOnly = false) {
  if (useHostnameOnly) {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}`; // includes port if any
    } catch {
      // If URL parsing fails, return the original URL with trailing slash removed
      return removeTrailingSlash(url);
    }
  }
  return removeTrailingSlash(url);
}

/**
 * Checks if a URL points to a PDF file
 * @param {string} url - The URL to check
 * @returns {boolean} True if URL is a PDF, false otherwise
 */
export function isPdfUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

/**
 * File types that cannot be scraped by Puppeteer but may appear in search results.
 * These are file types that Google indexes and may appear in SEO top pages.
 * @see https://github.com/adobe/spacecat-audit-worker/blob/main/src/structured-data/handler.js#L203-L205
 */
const UNSCRAPE_ABLE_FILE_TYPES = [
  'pdf', 'ps', 'dwf', 'kml', 'kmz', // Documents & Maps
  'xls', 'xlsx', 'ppt', 'pptx', // Office spreadsheets & presentations
  'doc', 'docx', 'rtf', 'swf', // Word documents & Flash
];

/**
 * Checks if a URL points to a file type that cannot be scraped.
 * These file types are indexed by Google but cannot be processed by Puppeteer.
 * @param {string} url - The URL to check
 * @returns {boolean} True if URL is an unscrape-able file type, false otherwise
 */
export function isUnscrapeable(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    return UNSCRAPE_ABLE_FILE_TYPES.some((type) => pathname.endsWith(`.${type}`));
  } catch {
    return false;
  }
}

export function joinBaseAndPath(baseURL, path) {
  if (path === '-') {
    return baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  }

  try {
    // Prefer URL parsing when possible, but keep string-join fallback for invalid bases.
    const base = new URL(baseURL);
    const normalizedBasePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const normalizedBasePathLower = normalizedBasePath.toLowerCase();
    const normalizedPathLower = normalizedPath.toLowerCase();
    const joinedPath = normalizedBasePath
      && (normalizedPathLower === normalizedBasePathLower
        || normalizedPathLower.startsWith(`${normalizedBasePathLower}/`))
      ? normalizedPath
      : `${normalizedBasePath}${normalizedPath}`;

    // Rebuild from origin + path so joins stay path-focused.
    // Any base query/hash is intentionally ignored.
    return `${base.origin}${joinedPath}`;
  } catch {
    const normalizedBase = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return `${normalizedBase}${normalizedPath}`;
  }
}

/**
 * Returns true when a Content-Type value indicates an HTML document.
 * Matches text/html and application/xhtml+xml (with optional charset suffix).
 *
 * @param {string} contentType - The Content-Type header value.
 * @returns {boolean}
 */
export function isHtmlContentType(contentType) {
  /* c8 ignore next - Defensive fallback for null/undefined contentType */
  return /^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType || '');
}

/**
 * Returns true when the stripped body text of a 200 response matches known soft-404 patterns.
 * Strips <script>, <style> and all other HTML tags before matching so inline JS/CSS text
 * cannot produce false positives. Checks the first 12 000 characters of the cleaned text.
 * Patterns cover English and several other languages (DE, FR, ES, IT, PT, NL, JA).
 *
 * @param {string} bodyText - Raw HTML body (or plain text) of the response.
 * @returns {boolean}
 */
export function isSoft404Body(bodyText) {
  /* c8 ignore next - Defensive fallback for null/undefined bodyText */
  const text = String(bodyText || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!text) {
    return false;
  }

  const normalizedText = text.slice(0, 12000);

  return [
    /404 not found/,
    /page not found/,
    /not found/,
    /the page you (requested|are looking for).{0,40}(could not be found|does not exist|is unavailable)/,
    /sorry[, ]+we (couldn'?t|can'?t) find/,
    /sorry[, ]+the page.{0,40}(could not be found|does not exist|is unavailable)/,
    /we can'?t seem to find the page/,
    /this page no longer exists/,
    /the requested url was not found/,
    /error 404/,
    /seite nicht gefunden/,
    /page introuvable/,
    /page non trouv[ée]e/,
    /p[áa]gina no encontrada/,
    /pagina non trovata/,
    /p[áa]gina n[ãa]o encontrada/,
    /pagina niet gevonden/,
    /ページが見つかりません/,
  ].some((pattern) => pattern.test(normalizedText));
}

/**
 * Strips query string from a URL, keeping only the origin and path.
 * @param {string} url - The URL to strip.
 * @returns {string} - URL without query string.
 */
export function stripQueryString(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Normalizes a URL for comparison (lowercase, strip trailing slashes).
 * @param {string} url - The URL to normalize.
 * @returns {string} - Normalized URL.
 */
export function normalizeUrlForComparison(url) {
  try {
    return url?.toLowerCase().replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/**
 * Checks if two URLs match (with or without query strings).
 * Compares normalized URLs and also tries without query strings.
 * @param {string} url1 - First URL.
 * @param {string} url2 - Second URL.
 * @returns {boolean} - True if URLs match.
 */
export function urlsMatch(url1, url2) {
  const norm1 = normalizeUrlForComparison(url1);
  const norm2 = normalizeUrlForComparison(url2);
  if (norm1 === norm2) {
    return true;
  }

  // Also try without query strings
  const stripped1 = normalizeUrlForComparison(stripQueryString(url1));
  const stripped2 = normalizeUrlForComparison(stripQueryString(url2));
  return stripped1 === stripped2;
}
