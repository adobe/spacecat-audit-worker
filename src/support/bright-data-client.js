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
export default class BrightDataClient {
  constructor(apiKey, zone, log) {
    this.apiKey = apiKey;
    this.zone = zone;
    this.log = log;
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

      // Match explicit lang_region patterns: en_us, de_ch, en_US, fr_ca, etc.
      // Validate that the language part is in our whitelist
      const fullLocaleMatch = path.match(/^\/([a-z]{2})_([a-z]{2})(?:\/|$)/i);
      if (fullLocaleMatch) {
        const lang = fullLocaleMatch[1].toLowerCase();
        const region = fullLocaleMatch[2].toLowerCase();
        if (KNOWN_LOCALES.has(lang)) {
          return `${lang}_${region}`;
        }
      }

      // Match 2-letter codes only if they're in the known locales whitelist
      const shortLocaleMatch = path.match(/^\/([a-z]{2})(?:\/|$)/i);
      if (shortLocaleMatch) {
        const code = shortLocaleMatch[1].toLowerCase();
        if (KNOWN_LOCALES.has(code)) {
          return code;
        }
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

      // Check for xx_yy pattern - validate language part is in whitelist
      const fullLocaleMatch = path.match(/^\/([a-z]{2})_([a-z]{2})(?:\/|$)/i);
      if (fullLocaleMatch) {
        const lang = fullLocaleMatch[1].toLowerCase();
        const region = fullLocaleMatch[2].toLowerCase();
        if (KNOWN_LOCALES.has(lang)) {
          return `${lang}_${region}`;
        }
      }

      // Check for whitelisted 2-letter code
      const shortLocaleMatch = path.match(/^\/([a-z]{2})(?:\/|$)/i);
      if (shortLocaleMatch) {
        const code = shortLocaleMatch[1].toLowerCase();
        if (KNOWN_LOCALES.has(code)) {
          return code;
        }
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
        path = path.replace(/^\/[a-z]{2}_[a-z]{2}\//i, '/');
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

    // Full locale: xx_yy -> hl=xx, gl=YY (only if language is in whitelist)
    const fullMatch = normalized.match(/^([a-z]{2})_([a-z]{2})$/);
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
   * Run search with locale-first fallback using path-scoped site queries.
   *
   * This method controls how aggressively we try to resolve suggestions via Bright Data
   * before falling back to Mystique (LLM). More fallback attempts = higher Bright Data
   * resolution rate but more API calls. Fewer attempts = faster, cheaper, but more
   * links sent to Mystique.
   *
   * Fallback order (example: broken URL /it/products/electrolyte-sachets-blackcurrant):
   * 1. Locale scope + full keywords: site:bulk.com/it products electrolyte... (hl=it, gl=IT)
   * 2. Locale scope + head keywords: site:bulk.com/it products... (hl=it, gl=IT)
   * 3. Locale scope + tail keywords: site:bulk.com/it ...blackcurrant (hl=it, gl=IT)
   * 4. No locale + full keywords: site:bulk.com products electrolyte... (no hl/gl)
   * 5. No locale + head keywords: site:bulk.com products... (no hl/gl)
   * 6. No locale + tail keywords: site:bulk.com ...blackcurrant (no hl/gl)
   *
   * To reduce Bright Data calls: remove tail keyword attempts or reduce fallback variants.
   * To increase resolution rate: add more keyword trimming variants or retry logic.
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

    // Determine scope variants: locale-scoped first (if applicable), then broad
    const scopeVariants = scopeWithLocale
      ? [{ scope: scopeWithLocale, locale: effectiveLocale, useLocaleHlGl: true }]
      : [];
    scopeVariants.push({ scope: scopeWithoutLocale, locale: null, useLocaleHlGl: false });

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
