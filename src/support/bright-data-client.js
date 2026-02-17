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

import { hasText, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

/**
 * Locale allowlist: ISO 639-1 language codes + ISO 3166-1 country codes + common regional codes.
 * Used to validate path segments as valid locales for locale-scoped searches.
 */
const LOCALE_ALLOWLIST = new Set([
  // ISO 639-1 Language codes
  'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'da', 'sv', 'no', 'fi', 'pl', 'cs', 'sk',
  'hu', 'ro', 'bg', 'hr', 'sl', 'sr', 'uk', 'ru', 'el', 'tr', 'ar', 'he', 'fa', 'hi',
  'bn', 'pa', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'si', 'th', 'lo', 'my', 'km', 'vi',
  'id', 'ms', 'tl', 'zh', 'ja', 'ko', 'mn', 'ka', 'hy', 'az', 'kz', 'uz', 'tk', 'ky',
  'tg', 'ps', 'ur', 'sd', 'ne', 'dz', 'bo', 'am', 'ti', 'om', 'so', 'sw', 'rw', 'ny',
  'mg', 'eo', 'cy', 'eu', 'ca', 'gl', 'ast', 'br', 'co', 'gd', 'ga', 'gv', 'kw', 'lb',
  'li', 'oc', 'rm', 'sc', 'an', 'ht', 'la', 'jv', 'su', 'mad', 'bug', 'ban', 'bew',
  'bho', 'dv', 'fo', 'fy', 'haw', 'ig', 'iu', 'kl', 'ln', 'lv', 'lt', 'mk', 'mt',
  'mi', 'nv', 'se', 'sm', 'sn', 'st', 'to', 'ts', 'tn', 've', 'wo', 'xh', 'yo',
  'zu', 'aa', 'ab', 'ae', 'af', 'ak', 'ay', 'ba', 'be', 'bi', 'bm', 'bs', 'ce', 'ch',
  'cu', 'cv', 'ee', 'et', 'ff', 'fj', 'gn', 'ha', 'ho', 'hz', 'ia', 'ie', 'ii', 'ik',
  'io', 'is', 'kg', 'ki', 'kj', 'kr', 'ku', 'kv', 'lg', 'lu', 'mh', 'na', 'nb', 'nd',
  'ng', 'nn', 'nr', 'nso', 'oj', 'or', 'os', 'pi', 'qu', 'rn', 'sa', 'sg', 'ss', 'tw',
  'ty', 'ug', 'vo', 'wa', 'yi', 'za',
  // ISO 3166-1 Country codes (alpha-2) + common regional codes
  'us', 'gb', 'ca', 'au', 'nz', 'ie', 'za', 'in', 'pk', 'bd', 'lk', 'np', 'bt',
  'mv', 'af', 'ir', 'iq', 'sy', 'lb', 'jo', 'il', 'sa', 'ye', 'om', 'ae', 'kw',
  'qa', 'bh', 'cy', 'ge', 'am', 'az', 'kz', 'tm', 'kg', 'tj', 'mn', 'cn',
  'tw', 'hk', 'mo', 'jp', 'kr', 'kp', 'vn', 'th', 'la', 'kh', 'mm', 'my', 'sg', 'bn',
  'ph', 'pg', 'sb', 'vu', 'fj', 'nc', 'pf', 'ck', 'ws', 'tv',
  'ki', 'nr', 'pw', 'fm', 'mh', 'mp', 'gu', 'as', 'pr', 'vi', 'um', 'mx', 'gt', 'bz',
  'hn', 'ni', 'cr', 'pa', 'cu', 'jm', 'do', 'tt', 'bb', 'gd', 'lc', 'vc',
  'ag', 'dm', 'kn', 'bs', 'tc', 'bm', 'ky', 'vg', 'ai', 'ms', 'pm', 'gl', 'fo', 'is',
  'no', 'se', 'dk', 'fi', 'ee', 'lv', 'lt', 'by', 'ua', 'md', 'ro', 'bg', 'gr', 'al',
  'mk', 'rs', 'me', 'ba', 'hr', 'si', 'sk', 'cz', 'pl', 'hu', 'at', 'ch', 'li', 'de',
  'lu', 'be', 'nl', 'fr', 'mc', 'ad', 'es', 'pt', 'gi', 'va', 'sm', 'it', 'mt', 'dz',
  'tn', 'ly', 'eg', 'sd', 'ss', 'er', 'et', 'so', 'dj', 'ke', 'ug', 'rw', 'bi', 'tz',
  'mw', 'mz', 'zm', 'zw', 'bw', 'na', 'za', 'ls', 'sz', 'mg', 'km', 'mu', 'sc', 're',
  'yt', 'ma', 'eh', 'mr', 'ml', 'sn', 'gm', 'gw', 'gn', 'sl', 'lr', 'ci', 'bf', 'ne',
  'ng', 'td', 'cm', 'cf', 'gq', 'ga', 'cg', 'cd', 'ao', 'st', 'ar', 'bo', 'br', 'cl',
  'co', 'ec', 'fk', 'gf', 'gy', 'py', 'pe', 'sr', 'uy', 've', 'aw', 'cw', 'sx', 'bq',
  // Common regional codes
  'eu', 'apac', 'emea', 'latam', 'mena', 'anz', 'sea', 'gcc', 'uk',
]);

/**
 * Validates if a path segment is a valid locale code.
 * Supports single codes (dk, fr, eu) and composite codes (ko-kr, en_us, pt-br).
 * @param {string} segment - Path segment to validate
 * @returns {boolean} - True if the segment is a recognized locale
 */
export function isValidLocale(segment) {
  if (!segment || typeof segment !== 'string') {
    return false;
  }
  const lower = segment.toLowerCase();

  // Single code: 'dk', 'en', 'eu'
  if (LOCALE_ALLOWLIST.has(lower)) {
    return true;
  }

  // Composite code: 'ko-kr', 'en_us', 'pt-br'
  const parts = lower.split(/[-_]/);
  if (parts.length === 2) {
    return LOCALE_ALLOWLIST.has(parts[0]) && LOCALE_ALLOWLIST.has(parts[1]);
  }

  return false;
}

/**
 * Extracts and validates the locale from a URL's first path segment.
 * @param {string} url - Full or partial URL
 * @returns {string|null} - Validated locale (e.g., "dk", "ko-kr") or null
 */
export function extractLocaleFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  try {
    const urlWithSchema = url.startsWith('http') ? url : `https://${url}`;
    const parsed = new URL(urlWithSchema);
    const { pathname } = parsed;
    if (!pathname || pathname === '/') {
      return null;
    }
    const segments = pathname.split('/').filter((seg) => seg.length > 0);
    if (segments.length === 0) {
      return null;
    }
    const firstSegment = segments[0].toLowerCase();
    return isValidLocale(firstSegment) ? firstSegment : null;
  } catch {
    return null;
  }
}

/**
 * Checks if two locale values match for filtering purposes.
 * - Both null → match (both are default/no locale)
 * - Both same string → match
 * - Otherwise → no match
 * @param {string|null} locale1
 * @param {string|null} locale2
 * @returns {boolean}
 */
export function localesMatch(locale1, locale2) {
  if (!locale1 && !locale2) return true;
  if (!locale1 || !locale2) return false;
  return locale1.toLowerCase() === locale2.toLowerCase();
}

/**
 * Maps 2-letter ISO 639-1 language codes to default country codes for hl/gl.
 * This is the single source of truth for supported locales.
 */
const LOCALE_TO_COUNTRY = {
  ar: 'SA',
  bg: 'BG',
  cs: 'CZ',
  da: 'DK',
  de: 'DE',
  el: 'GR',
  en: 'US',
  es: 'ES',
  et: 'EE',
  fi: 'FI',
  fr: 'FR',
  he: 'IL',
  hi: 'IN',
  hr: 'HR',
  hu: 'HU',
  id: 'ID',
  it: 'IT',
  ja: 'JP',
  ko: 'KR',
  lt: 'LT',
  lv: 'LV',
  ms: 'MY',
  nl: 'NL',
  no: 'NO',
  pl: 'PL',
  pt: 'PT',
  ro: 'RO',
  ru: 'RU',
  sk: 'SK',
  sl: 'SI',
  sr: 'RS',
  sv: 'SE',
  th: 'TH',
  tr: 'TR',
  uk: 'UA',
  vi: 'VN',
  zh: 'CN',
};

/**
 * Curated whitelist of ISO 639-1 language codes commonly used as URL locale prefixes.
 * Derived from LOCALE_TO_COUNTRY to ensure they stay in sync.
 */
const KNOWN_LOCALES = new Set(Object.keys(LOCALE_TO_COUNTRY));

const FILE_EXTENSIONS = new Set([
  'html',
  'htm',
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'csv',
  'txt',
  'json',
  'xml',
  'zip',
  'rar',
  '7z',
  'gz',
  'tar',
  'tgz',
  'mp3',
  'mp4',
  'webm',
  'mov',
  'avi',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'svg',
  'webp',
]);

/**
 * Bright Data SERP API Client
 * Documentation: https://docs.brightdata.com/scraping-automation/serp-api/introduction
 */
class BrightDataClient {
  constructor(apiKey, zone, log, env = {}) {
    this.apiKey = apiKey;
    this.zone = zone;
    this.log = log;
    this.env = env;
    this.baseUrl = 'https://api.brightdata.com/request';
  }

  static createFrom(context) {
    const { env, log } = context;

    if (!hasText(env.BRIGHT_DATA_API_KEY)) {
      throw new Error('BRIGHT_DATA_API_KEY is not configured');
    }

    if (!hasText(env.BRIGHT_DATA_ZONE)) {
      throw new Error('BRIGHT_DATA_ZONE is not configured');
    }

    return new BrightDataClient(
      env.BRIGHT_DATA_API_KEY,
      env.BRIGHT_DATA_ZONE,
      log,
      env,
    );
  }

  /**
   * Extract locale from URL path
   *
   * @param {string} brokenUrl - Broken backlink URL
   * @returns {string|null} Locale code (e.g., "en_us", "de", "it") or null
   */
  extractLocale(brokenUrl) {
    try {
      const urlObj = new URL(brokenUrl);
      const path = urlObj.pathname;

      // Match explicit lang_region patterns: en_us, de_ch, ko-kr, pt-br, etc.
      // Supports both underscore and dash separators; preserves original separator
      const fullLocaleMatch = path.match(/^\/([a-z]{2})([_-])([a-z]{2})(?:\/|$)/i);
      if (fullLocaleMatch) {
        const lang = fullLocaleMatch[1].toLowerCase();
        const sep = fullLocaleMatch[2];
        const region = fullLocaleMatch[3].toLowerCase();
        if (KNOWN_LOCALES.has(lang)) {
          return `${lang}${sep}${region}`;
        }
      }

      // Match any first path segment that is a valid locale (dk, uk, apac, emea, etc.)
      const segments = path.split('/').filter((seg) => seg.length > 0);
      if (segments.length > 0 && isValidLocale(segments[0])) {
        return segments[0].toLowerCase();
      }

      return null;
    } catch (error) {
      this.log.error(`Failed to extract locale from ${brokenUrl}:`, error);
      return null;
    }
  }

  /**
   * Extract locale prefix from a base/final URL if present.
   *
   * @param {string} baseUrl - The base URL (e.g., "https://www.bulk.com/it")
   * @returns {string|null} Locale prefix or null
   */
  // eslint-disable-next-line class-methods-use-this
  extractLocaleFromBaseUrl(baseUrl) {
    try {
      const urlObj = new URL(baseUrl);
      const path = urlObj.pathname;

      // Check for xx_yy or xx-yy pattern - validate language part is in whitelist
      // Preserves original separator so site: scope matches actual URL paths
      const fullLocaleMatch = path.match(/^\/([a-z]{2})([_-])([a-z]{2})(?:\/|$)/i);
      if (fullLocaleMatch) {
        const lang = fullLocaleMatch[1].toLowerCase();
        const sep = fullLocaleMatch[2];
        const region = fullLocaleMatch[3].toLowerCase();
        if (KNOWN_LOCALES.has(lang)) {
          return `${lang}${sep}${region}`;
        }
      }

      // Match any first path segment that is a valid locale (dk, uk, apac, emea, etc.)
      const segments = path.split('/').filter((seg) => seg.length > 0);
      if (segments.length > 0 && isValidLocale(segments[0])) {
        return segments[0].toLowerCase();
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract keyword tokens from broken URL path
   *
   * @param {string} brokenUrl - Broken backlink URL
   * @param {object} options
   * @param {boolean} options.stripCommonPrefixes - Whether to remove common prefixes like blog/news
   * @param {string|null} options.locale - Optional locale to strip from the path
   * @returns {string[]} Keyword tokens extracted from URL
   */
  extractKeywordTokens(brokenUrl, { stripCommonPrefixes = false, locale = null } = {}) {
    try {
      const urlObj = new URL(brokenUrl);
      let path = urlObj.pathname;

      // Remove trailing slash
      if (path.endsWith('/')) {
        path = path.slice(0, -1);
      }

      // Remove locale prefix (will be added separately to search query)
      const effectiveLocale = locale || this.extractLocale(brokenUrl);
      if (effectiveLocale) {
        path = path.replace(new RegExp(`^/${effectiveLocale}(?:/|$)`, 'i'), '/');
      } else {
        path = path.replace(/^\/[a-z]{2}[_-][a-z]{2}\//i, '/');
      }

      // Remove dates (YYYY/MM/DD or YYYY/MM)
      path = path.replace(/\/\d{4}\/\d{2}(\/\d{2})?/g, '/');

      // Remove common blog/resource prefixes (optional)
      // path = path.replace(/^\/(blog|news|article|post|resources?|guides?|docs?)\//i, '/');
      if (stripCommonPrefixes) {
        path = path.replace(/^\/(blog|news|article|post|resources?|guides?|docs?)\//i, '/');
      }

      const segments = path
        .split('/')
        .filter((segment) => segment.length > 0);

      const tokens = segments.flatMap((segment, index) => {
        const isLast = index === segments.length - 1;
        let decoded = isLast ? this.stripFileExtension(segment) : segment;
        try {
          // Decode to surface URL-encoded junk like "%E2%80%AC" for filtering.
          decoded = decodeURIComponent(decoded);
        } catch (e) {
          // Use raw segment if decode fails
        }
        return decoded
          .replace(/-/g, ' ')
          .replace(/_/g, ' ')
          .split(/\s+/)
          .filter((token) => this.isUsefulToken(token));
      });

      return tokens;
    } catch (error) {
      this.log.error(`Failed to extract keyword tokens from ${brokenUrl}:`, error);
      return [];
    }
  }

  /**
   * Extract keywords from broken URL path
   *
   * @param {string} brokenUrl - Broken backlink URL
   * @param {object} options
   * @param {boolean} options.stripCommonPrefixes - Whether to remove common prefixes like blog/news
   * @param {number} options.maxTokens - Maximum number of tokens to keep (from the end)
   * @param {number} options.maxChars - Maximum number of characters to keep
   * @returns {string} Keywords extracted from URL
   */
  extractKeywords(
    brokenUrl,
    {
      stripCommonPrefixes = false,
      maxTokens = 10,
      maxChars = 80,
    } = {},
  ) {
    const tokens = this.extractKeywordTokens(brokenUrl, { stripCommonPrefixes });
    const keywords = this.buildKeywordsFromTokens(tokens, { maxTokens, maxChars });

    if (keywords) {
      this.log.debug(`Extracted keywords from ${brokenUrl}: "${keywords}"`);
    }

    return keywords;
  }

  /**
   * Filter out junk tokens deterministically.
   */
  // eslint-disable-next-line class-methods-use-this
  isUsefulToken(token) {
    if (!token) return false;
    const trimmed = token.trim();
    if (trimmed.length < 2) return false;
    if (/^\d+$/.test(trimmed)) return false;
    if (!/[a-z]/i.test(trimmed)) return false;
    return true;
  }

  /**
   * Strip known file extensions from a path segment.
   */
  // eslint-disable-next-line class-methods-use-this
  stripFileExtension(segment) {
    const match = segment.match(/^(.+)\.([a-z0-9]{1,5})$/i);
    if (!match) return segment;
    const extension = match[2].toLowerCase();
    if (!FILE_EXTENSIONS.has(extension)) return segment;
    return match[1];
  }

  /**
   * Trim tokens to keep the end within a character limit.
   */
  // eslint-disable-next-line class-methods-use-this
  trimTokensByCharLimit(tokens, maxChars, { fromStart = false } = {}) {
    if (!maxChars || maxChars <= 0) return tokens;
    const trimmed = [];
    let length = 0;
    if (fromStart) {
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const nextLength = length === 0 ? token.length : length + 1 + token.length;
        if (nextLength > maxChars) {
          break;
        }
        trimmed.push(token);
        length = nextLength;
      }
      return trimmed;
    }
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      const token = tokens[index];
      const nextLength = length === 0 ? token.length : length + 1 + token.length;
      if (nextLength > maxChars) {
        break;
      }
      trimmed.push(token);
      length = nextLength;
    }
    return trimmed.reverse();
  }

  /**
   * Build keywords with deterministic trimming.
   */
  // eslint-disable-next-line class-methods-use-this
  buildKeywordsFromTokens(tokens, { maxTokens = 10, maxChars = 80, fromStart = false } = {}) {
    let trimmedTokens = tokens;
    if (Number.isInteger(maxTokens) && maxTokens > 0 && trimmedTokens.length > maxTokens) {
      trimmedTokens = fromStart
        ? trimmedTokens.slice(0, maxTokens)
        : trimmedTokens.slice(-maxTokens);
    }
    trimmedTokens = this.trimTokensByCharLimit(trimmedTokens, maxChars, { fromStart });
    return trimmedTokens.join(' ').trim();
  }

  /**
   * Build site scope with optional locale path.
   * Uses path-scoping (site:domain/locale) for better precision.
   *
   * @param {string} siteDomain - Domain to search within (e.g., "bulk.com")
   * @param {string|null} localeForScope - Locale to add as path prefix (e.g., "it", "de_ch")
   * @returns {string} Site scope string (e.g., "site:bulk.com/it")
   */
  // eslint-disable-next-line class-methods-use-this
  buildSiteScope(siteDomain, localeForScope = null) {
    if (localeForScope) {
      return `site:${siteDomain}/${localeForScope}`;
    }
    return `site:${siteDomain}`;
  }

  /**
   * Build Google Search query for Bright Data
   *
   * @param {string} siteScope - Site scope (e.g., "site:bulk.com" or "site:bulk.com/it")
   * @param {string} keywords - Keywords to search for
   * @returns {string} Google search query
   */
  buildSearchQuery(siteScope, keywords) {
    const parts = [siteScope];

    // Add keywords if present
    if (keywords) {
      parts.push(keywords);
    }

    const query = parts.join(' ');

    if (!keywords) {
      this.log.debug(`No keywords provided, searching whole site scope: ${siteScope}`);
    }

    return query;
  }

  /**
   * Resolve Google search locale parameters (hl/gl) from locale.
   * Returns null for hl/gl when locale is not provided or invalid, allowing caller to omit.
   *
   * @param {string|null} locale - Locale code (e.g., "en_us", "de", "it")
   * @returns {{ hl: string|null, gl: string|null }} hl/gl params or nulls
   */
  // eslint-disable-next-line class-methods-use-this
  resolveGoogleLocaleParams(locale) {
    if (!locale) {
      // No locale detected - omit hl/gl to let Google decide
      return { hl: null, gl: null };
    }
    const normalized = locale.toLowerCase();

    // Full locale: xx_yy or xx-yy -> hl=xx, gl=YY (only if language is in whitelist)
    const fullMatch = normalized.match(/^([a-z]{2})[_-]([a-z]{2})$/);
    if (fullMatch) {
      const lang = fullMatch[1];
      if (KNOWN_LOCALES.has(lang)) {
        return { hl: lang, gl: fullMatch[2].toUpperCase() };
      }
      // Invalid language - omit hl/gl
      return { hl: null, gl: null };
    }

    // Short locale: xx -> hl=xx, gl=mapped country
    if (KNOWN_LOCALES.has(normalized)) {
      // KNOWN_LOCALES is derived from LOCALE_TO_COUNTRY, so lookup is guaranteed
      const country = LOCALE_TO_COUNTRY[normalized];
      return { hl: normalized, gl: country };
    }

    // Unknown format - omit hl/gl
    return { hl: null, gl: null };
  }

  /**
   * Google Search via Bright Data SERP API
   *
   * @param {string} searchQuery - The search query string
   * @param {number} numResults - Number of results to return
   * @param {string|null} locale - Optional locale for hl/gl params (omitted if null)
   */
  async googleSearchByQuery(searchQuery, numResults = 10, locale = null) {
    this.log.debug(`Bright Data query: "${searchQuery}"`);

    const { hl, gl } = this.resolveGoogleLocaleParams(locale);
    const googleUrl = new URL('https://www.google.com/search');
    googleUrl.searchParams.set('q', searchQuery);

    // Only set hl/gl when locale is deterministic; otherwise omit to let Google decide
    if (hl) {
      googleUrl.searchParams.set('hl', hl);
    }
    if (gl) {
      googleUrl.searchParams.set('gl', gl);
    }

    googleUrl.searchParams.set('num', numResults);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          zone: this.zone,
          url: googleUrl.toString(),
          format: 'raw',
          data_format: 'parsed_light',
        }),
        timeout: 30000,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bright Data API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const results = (data.organic || []).slice(0, numResults);

      this.log.info(`Bright Data returned ${results.length} results for "${searchQuery}"`);

      return results;
    } catch (error) {
      this.log.error(`Bright Data SERP request failed for "${searchQuery}":`, error);
      return [];
    }
  }

  /**
   * Run search with locale-scoped queries and keyword fallbacks.
   *
   * When a locale is detected (e.g., /it/, /ko-kr/), searches are scoped to that
   * locale path using site:domain/locale. Up to 10 results are returned and
   * post-filtered by locale match in the handler.
   *
   * Fallback order (example: broken URL /it/products/electrolyte-sachets-blackcurrant):
   * 1. Locale scope + full keywords: site:bulk.com/it products electrolyte... (hl=it, gl=IT)
   * 2. Locale scope + head keywords: site:bulk.com/it products... (hl=it, gl=IT)
   * 3. Locale scope + tail keywords: site:bulk.com/it ...blackcurrant (hl=it, gl=IT)
   *
   * If no locale is detected, or if BRIGHT_DATA_LOCALE_FALLBACK_ENABLED=true,
   * non-locale fallbacks are also tried:
   * 4. No locale + full keywords: site:bulk.com products electrolyte... (no hl/gl)
   * 5. No locale + head keywords: site:bulk.com products... (no hl/gl)
   * 6. No locale + tail keywords: site:bulk.com ...blackcurrant (no hl/gl)
   *
   * By default, non-locale fallback is disabled to preserve locale isolation.
   * To reduce Bright Data calls: remove tail keyword attempts or reduce fallback variants.
   * To increase resolution rate: enable locale fallback or add more keyword variants.
   */
  async googleSearchWithFallback(siteBaseURL, brokenUrl, numResults = 1, options = {}) {
    const siteUrlObj = new URL(siteBaseURL);
    const siteDomain = siteUrlObj.hostname;

    // Check if base URL already has locale prefix (e.g., www.bulk.com/it)
    const baseLocale = this.extractLocaleFromBaseUrl(siteBaseURL);
    // Extract locale from broken URL
    const brokenLocale = this.extractLocale(brokenUrl);

    // Determine effective locale for scope:
    // - If base URL has locale, use it (don't duplicate)
    // - Else if broken URL has locale, add it to scope
    const effectiveLocale = baseLocale || brokenLocale;

    const {
      stripCommonPrefixes = false,
      maxTokens = 10,
      maxChars = 80,
    } = options;

    // Extract keywords, cleaning locale from path to avoid duplication
    const tokens = this.extractKeywordTokens(brokenUrl, {
      stripCommonPrefixes,
      locale: effectiveLocale,
    });
    const fullKeywords = this.buildKeywordsFromTokens(tokens, { maxTokens, maxChars });

    // Build fallback keyword variants
    const safeMaxTokens = Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : tokens.length;
    const effectiveTokenCount = Math.min(tokens.length, safeMaxTokens);
    // Keep the head for fallback to emphasize section/category context
    const fallbackTokenCount = Math.max(3, Math.ceil(effectiveTokenCount / 2));
    const headFallbackKeywords = this.buildKeywordsFromTokens(tokens, {
      maxTokens: fallbackTokenCount,
      maxChars,
      fromStart: true,
    });
    // Also try tail fallback to emphasize specific slug terms
    const tailFallbackKeywords = this.buildKeywordsFromTokens(tokens, {
      maxTokens: fallbackTokenCount,
      maxChars,
      fromStart: false,
    });

    const keywordVariants = [fullKeywords];
    if (headFallbackKeywords && headFallbackKeywords !== fullKeywords) {
      keywordVariants.push(headFallbackKeywords);
    }
    if (tailFallbackKeywords
      && tailFallbackKeywords !== fullKeywords
      && tailFallbackKeywords !== headFallbackKeywords) {
      keywordVariants.push(tailFallbackKeywords);
    }

    // Build site scopes: with locale path, then without
    const scopeWithLocale = effectiveLocale && !baseLocale
      ? this.buildSiteScope(siteDomain, effectiveLocale)
      : null;
    const scopeWithoutLocale = baseLocale
      ? this.buildSiteScope(siteDomain, baseLocale) // Keep base locale if it was in URL
      : this.buildSiteScope(siteDomain, null);

    // Determine scope variants based on feature flag
    // BRIGHT_DATA_LOCALE_FALLBACK_ENABLED controls whether to fall back to non-locale search
    const enableLocaleFallback = this.env?.BRIGHT_DATA_LOCALE_FALLBACK_ENABLED === 'true';

    const scopeVariants = scopeWithLocale
      ? [{ scope: scopeWithLocale, locale: effectiveLocale, useLocaleHlGl: true }]
      : [];

    // Only add non-locale fallback if flag is enabled OR no locale was detected
    if (enableLocaleFallback || !scopeWithLocale) {
      scopeVariants.push({ scope: scopeWithoutLocale, locale: null, useLocaleHlGl: false });
    }

    let lastQuery = this.buildSearchQuery(scopeVariants[0].scope, fullKeywords);

    for (const { scope, useLocaleHlGl } of scopeVariants) {
      for (const keywords of keywordVariants) {
        const query = this.buildSearchQuery(scope, keywords);
        lastQuery = query;
        // Pass locale for hl/gl only when useLocaleHlGl is true
        const searchLocale = useLocaleHlGl ? effectiveLocale : null;
        // eslint-disable-next-line no-await-in-loop
        const results = await this.googleSearchByQuery(query, numResults, searchLocale);
        if (results.length > 0) {
          return {
            query,
            results,
            keywords,
            locale: effectiveLocale,
            usedLocale: useLocaleHlGl,
          };
        }
      }
    }

    return {
      query: lastQuery,
      results: [],
      keywords: fullKeywords,
      locale: effectiveLocale,
      usedLocale: false,
    };
  }
}

export default BrightDataClient;
