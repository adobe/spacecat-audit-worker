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

import { load as cheerioLoad } from 'cheerio';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { isWithinAuditScope, isSharedInternalResource } from './subpath-filter.js';
import { createAuditLogger, isContextLogger } from '../common/context-logger.js';
import { isLinkInaccessible } from './helpers.js';
import { limitConcurrency, sleep } from '../support/utils.js';
import { buildBrokenLinkKey, getUrlCacheKey } from './link-key.js';

const AUDIT_TYPE = 'broken-internal-links';

/**
 * Default traffic value for crawl-detected broken links (no RUM data).
 * Override via env BROKEN_LINKS_CRAWL_TRAFFIC_DOMAIN (e.g. 1–100).
 * RUM links keep their traffic_domain (e.g. 200, 400).
 */
function getCrawlDefaultTraffic(env = {}) {
  return Number(env.BROKEN_LINKS_CRAWL_TRAFFIC_DOMAIN) || 1;
}

// Optimized defaults for speed while respecting target server
const DEFAULT_SCRAPE_FETCH_DELAY_MS = 50;
const DEFAULT_LINK_CHECK_BATCH_SIZE = 10;
const DEFAULT_MAX_CONCURRENT_LINK_CHECKS = 5;
const DEFAULT_LINK_CHECK_DELAY_MS = 300;

export const PAGES_PER_BATCH = 10;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

function normalizeHostname(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

function isSameHost(hostname, baseHostname) {
  return hostname === baseHostname;
}

function isInternalAssetHost(hostname, baseHostname) {
  return hostname === baseHostname || hostname.endsWith(`.${baseHostname}`);
}

function getSourceItemType(parentTag) {
  if (parentTag === 'picture') return 'image';
  if (parentTag === 'video') return 'video';
  if (parentTag === 'audio') return 'audio';
  return 'media';
}

function getAssetTypeFromUrl(url, pageUrl = 'https://example.com') {
  try {
    const pathname = new URL(url, pageUrl).pathname.toLowerCase();
    if (/\.(svg|png|jpe?g|gif|webp|avif)$/.test(pathname)) return 'image';
    /* c8 ignore start - Asset type branches covered by integration tests at extraction level */
    if (/\.css$/.test(pathname)) return 'css';
    if (/\.js$/.test(pathname)) return 'js';
    if (/\.(mp4|webm)$/.test(pathname)) return 'video';
    if (/\.(mp3|ogg)$/.test(pathname)) return 'audio';
    return 'media';
  } catch (error) {
    return 'media';
  }
  /* c8 ignore stop */
}

function extractCssUrlCandidates(rawCss = '') {
  return Array.from(String(rawCss).matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi))
    .map((match) => match[2]?.trim())
    .filter(Boolean)
    .filter((candidate) => !candidate.startsWith('data:') && !candidate.startsWith('#'));
}

function extractMetaRefreshUrl(content = '') {
  const match = String(content).match(/url\s*=\s*([^;]+)/i);
  /* c8 ignore next - fallback coercion branch */
  return match?.[1]?.trim() || '';
}

function resolveUrlCandidates(rawValue, pageUrl) {
  return String(rawValue)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(/\s+/)[0])
    .filter((entry) => entry && !entry.startsWith('data:') && !entry.startsWith('#'))
    .map((entry) => new URL(entry, pageUrl).toString());
}

function pushResolvedReference({
  references,
  rawUrl,
  pageUrl,
  baseHostname,
  log,
  type,
  anchorText,
}) {
  if (!rawUrl || rawUrl.startsWith('#')) return;

  try {
    const absoluteUrl = new URL(rawUrl, pageUrl).toString();
    const hostname = normalizeHostname(absoluteUrl);
    const isAllowedHost = isInternalAssetHost(hostname, baseHostname);

    if (isAllowedHost) {
      references.push({
        url: absoluteUrl,
        anchorText,
        type,
      });
    }
    /* c8 ignore next 3 - Defensive: URL parsing rarely fails with valid HTML */
  } catch (urlError) {
    log.debug(`Skipping invalid ${type} reference on ${pageUrl}: ${rawUrl}`);
  }
}

function pushResolvedSrcsetReferences({
  references,
  rawSrcset,
  pageUrl,
  baseHostname,
  log,
  type,
  anchorText,
}) {
  if (!rawSrcset) return;

  try {
    const candidates = resolveUrlCandidates(rawSrcset, pageUrl);
    candidates.forEach((absoluteUrl) => {
      const hostname = normalizeHostname(absoluteUrl);
      const isAllowedHost = isInternalAssetHost(hostname, baseHostname);

      if (isAllowedHost) {
        references.push({
          url: absoluteUrl,
          anchorText,
          type,
        });
      }
    });
    /* c8 ignore next 3 - Defensive: URL parsing rarely fails with valid HTML */
  } catch (urlError) {
    log.debug(`Skipping invalid ${type} srcset on ${pageUrl}: ${rawSrcset}`);
  }
}

/**
 * Extracts internal links from HTML using cheerio
 * @param {Object} $ - Cheerio instance
 * @param {string} pageUrl - The page URL for resolving relative links
 * @param {string} baseHostname - The base hostname to match against
 * @param {Object} log - Logger instance
 * @returns {Array} Array of internal link objects with url, anchorText, type
 */
function extractInternalLinks($, pageUrl, baseHostname, log) {
  const internalLinks = [];

  // Extract links from anchor tags
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href');
    if (!href || href.startsWith('#')) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (linkHostname === baseHostname) {
        internalLinks.push({
          url: absoluteUrl,
          anchorText: $a.text().trim() || '[no text]',
          type: 'link',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid href on ${pageUrl}: ${href}`);
    }
  });

  // Extract links from image map areas
  $('area[href]').each((_, el) => {
    const $area = $(el);
    const href = $area.attr('href');
    if (!href || href.startsWith('#')) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const linkHostname = normalizeHostname(absoluteUrl);

      if (isSameHost(linkHostname, baseHostname)) {
        internalLinks.push({
          url: absoluteUrl,
          anchorText: $area.attr('alt')?.trim() || '[image map area]',
          type: 'link',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid area href on ${pageUrl}: ${href}`);
    }
  });

  // Extract form action URLs
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action');
    // eslint-disable-next-line no-script-url
    if (!action || action.startsWith('#') || action.startsWith('javascript:')) return;

    try {
      const absoluteUrl = new URL(action, pageUrl).toString();
      const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (linkHostname === baseHostname) {
        internalLinks.push({
          url: absoluteUrl,
          anchorText: '[form action]',
          type: 'form',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid form action on ${pageUrl}: ${action}`);
    }
  });

  // Extract canonical URLs
  $('link[rel="canonical"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (linkHostname === baseHostname) {
        internalLinks.push({
          url: absoluteUrl,
          anchorText: '[canonical]',
          type: 'canonical',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid canonical on ${pageUrl}: ${href}`);
    }
  });

  // Extract alternate language/locale links
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (linkHostname === baseHostname) {
        const hreflang = $(el).attr('hreflang');
        internalLinks.push({
          url: absoluteUrl,
          anchorText: `[alternate:${hreflang}]`,
          type: 'alternate',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid alternate link on ${pageUrl}: ${href}`);
    }
  });

  return internalLinks;
}

/**
 * Extracts asset references (images, SVGs, CSS, JS) from HTML
 * @param {Object} $ - Cheerio instance
 * @param {string} pageUrl - The page URL for resolving relative links
 * @param {string} baseHostname - The base hostname to match against
 * @param {Object} log - Logger instance
 * @returns {Array} Array of asset reference objects with url and type
 */
function extractAssetReferences($, pageUrl, baseHostname, log) {
  const assetReferences = [];

  // Images and SVGs
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || src.startsWith('data:') || src.startsWith('#')) return;

    try {
      const absoluteUrl = new URL(src, pageUrl).toString();
      const assetHostname = normalizeHostname(absoluteUrl);

      if (isInternalAssetHost(assetHostname, baseHostname)) {
        const path = new URL(absoluteUrl).pathname.toLowerCase();
        const type = path.endsWith('.svg') ? 'svg' : 'image';
        assetReferences.push({
          url: absoluteUrl,
          anchorText: '[img src]',
          type,
        });
      }
      /* c8 ignore next 3 - Defensive: URL parsing rarely fails with valid HTML */
    } catch (urlError) {
      log.debug(`Skipping invalid img src on ${pageUrl}: ${src}`);
    }
  });

  $('img[srcset]').each((_, el) => {
    pushResolvedSrcsetReferences({
      references: assetReferences,
      rawSrcset: $(el).attr('srcset'),
      pageUrl,
      baseHostname,
      log,
      type: 'image',
      anchorText: '[img srcset]',
      allowSubdomains: true,
    });
  });

  $('source[srcset]').each((_, el) => {
    const $source = $(el);
    const parentTag = $source.parent()?.prop('tagName')?.toLowerCase();
    const type = getSourceItemType(parentTag);
    /* c8 ignore next - cheerio HTML mode always attaches source elements to a parent */
    const anchorText = `[${parentTag || 'source'} srcset]`;

    pushResolvedSrcsetReferences({
      references: assetReferences,
      rawSrcset: $source.attr('srcset'),
      pageUrl,
      baseHostname,
      log,
      type,
      anchorText,
    });
  });

  // CSS files
  $('link[rel="stylesheet"][href]').each((_, el) => {
    pushResolvedReference({
      references: assetReferences,
      rawUrl: $(el).attr('href'),
      pageUrl,
      baseHostname,
      log,
      type: 'css',
      anchorText: '[stylesheet href]',
    });
  });

  // JavaScript files
  $('script[src]').each((_, el) => {
    pushResolvedReference({
      references: assetReferences,
      rawUrl: $(el).attr('src'),
      pageUrl,
      baseHostname,
      log,
      type: 'js',
      anchorText: '[script src]',
    });
  });

  $('iframe[src]').each((_, el) => {
    pushResolvedReference({
      references: assetReferences,
      rawUrl: $(el).attr('src'),
      pageUrl,
      baseHostname,
      log,
      type: 'iframe',
      anchorText: '[iframe src]',
    });
  });

  $('video[src]').each((_, el) => {
    pushResolvedReference({
      references: assetReferences,
      rawUrl: $(el).attr('src'),
      pageUrl,
      baseHostname,
      log,
      type: 'video',
      anchorText: '[video src]',
    });
  });

  $('audio[src]').each((_, el) => {
    pushResolvedReference({
      references: assetReferences,
      rawUrl: $(el).attr('src'),
      pageUrl,
      baseHostname,
      log,
      type: 'audio',
      anchorText: '[audio src]',
    });
  });

  $('source[src]').each((_, el) => {
    const $source = $(el);
    const parentTag = $source.parent()?.prop('tagName')?.toLowerCase();
    const type = getSourceItemType(parentTag);
    /* c8 ignore next - cheerio HTML mode always attaches source elements to a parent */
    const anchorText = `[${parentTag || 'source'} src]`;

    pushResolvedReference({
      references: assetReferences,
      rawUrl: $source.attr('src'),
      pageUrl,
      baseHostname,
      log,
      type,
      anchorText,
    });
  });

  $('video[poster]').each((_, el) => {
    pushResolvedReference({
      references: assetReferences,
      rawUrl: $(el).attr('poster'),
      pageUrl,
      baseHostname,
      log,
      type: 'image',
      anchorText: '[video poster]',
    });
  });

  /* c8 ignore start - Preload/modulepreload and meta-refresh extraction */
  $('link[rel="preload"][href], link[rel="modulepreload"][href]').each((_, el) => {
    const $link = $(el);
    const rel = $link.attr('rel');
    const asAttr = ($link.attr('as') || '').toLowerCase();
    let type = 'media';
    if (asAttr === 'style') {
      type = 'css';
    } else if (asAttr === 'script' || rel === 'modulepreload') {
      type = 'js';
    } else if (asAttr === 'image') {
      type = 'image';
    }

    pushResolvedReference({
      references: assetReferences,
      rawUrl: $link.attr('href'),
      pageUrl,
      baseHostname,
      log,
      type,
      anchorText: `[${rel} href]`,
    });
  });

  $('object[data]').each((_, el) => {
    pushResolvedReference({
      references: assetReferences,
      rawUrl: $(el).attr('data'),
      pageUrl,
      baseHostname,
      log,
      type: 'media',
      anchorText: '[object data]',
    });
  });

  $('meta[http-equiv]').each((_, el) => {
    const $meta = $(el);
    if (($meta.attr('http-equiv') || '').toLowerCase() !== 'refresh') {
      return;
    }

    const refreshUrl = extractMetaRefreshUrl($meta.attr('content'));
    if (!refreshUrl) {
      return;
    }

    pushResolvedReference({
      references: assetReferences,
      rawUrl: refreshUrl,
      pageUrl,
      baseHostname,
      log,
      type: 'link',
      anchorText: '[meta refresh]',
    });
  });
  /* c8 ignore stop */

  $('style').each((_, el) => {
    extractCssUrlCandidates($(el).html()).forEach((candidate) => {
      pushResolvedReference({
        references: assetReferences,
        rawUrl: candidate,
        pageUrl,
        baseHostname,
        log,
        type: getAssetTypeFromUrl(candidate, pageUrl),
        anchorText: '[style url()]',
      });
    });
  });

  $('[style]').each((_, el) => {
    extractCssUrlCandidates($(el).attr('style')).forEach((candidate) => {
      pushResolvedReference({
        references: assetReferences,
        rawUrl: candidate,
        pageUrl,
        baseHostname,
        log,
        type: getAssetTypeFromUrl(candidate, pageUrl),
        anchorText: '[inline style url()]',
      });
    });
  });

  return assetReferences;
}

/**
 * Validates a batch of links and updates caches
 * @param {Array} links - Array of link objects to validate
 * @param {string} pageUrl - The source page URL
 * @param {Set} brokenUrlsCache - Cache of known broken URLs
 * @param {Set} workingUrlsCache - Cache of known working URLs
 * @param {string} baseURL - Base URL for scope filtering
 * @param {Object} baseLog - Base logger
 * @param {string} siteId - Site ID for logging
 * @returns {Promise<Array>} Array of validation results
 */
async function validateLinksWithCache(
  links,
  pageUrl,
  brokenUrlsCache,
  workingUrlsCache,
  baseURL,
  log,
  siteId,
  auditId,
  crawlDefaultTraffic,
  maxConcurrent = DEFAULT_MAX_CONCURRENT_LINK_CHECKS,
) {
  return limitConcurrency(
    links.map((link) => async () => {
      const isInScope = isWithinAuditScope(link.url, baseURL)
        || isSharedInternalResource(link.url, baseURL, link.type);
      if (!isInScope) return { type: 'out-of-scope' };
      const cacheKey = getUrlCacheKey(link.url);

      if (brokenUrlsCache.has(cacheKey)) {
        const cachedMeta = brokenUrlsCache.get(cacheKey);
        return {
          type: 'cache-hit-broken',
          urlFrom: pageUrl,
          urlTo: link.url,
          anchorText: link.anchorText,
          /* c8 ignore next - Fallback tested via link detection */
          itemType: link.type || 'link',
          trafficDomain: crawlDefaultTraffic,
          detectionSource: 'crawl',
          httpStatus: cachedMeta.httpStatus,
          statusBucket: cachedMeta.statusBucket,
          contentType: cachedMeta.contentType,
        };
      }

      if (workingUrlsCache.has(cacheKey)) {
        return { type: 'cache-hit-working' };
      }

      const validation = await isLinkInaccessible(link.url, log, siteId, auditId);
      if (validation.isBroken) {
        brokenUrlsCache.set(cacheKey, {
          httpStatus: validation.httpStatus,
          statusBucket: validation.statusBucket,
          contentType: validation.contentType,
        });
        return {
          type: 'api-broken',
          urlFrom: pageUrl,
          urlTo: link.url,
          anchorText: link.anchorText,
          /* c8 ignore next - Fallback tested via link detection */
          itemType: link.type || 'link',
          trafficDomain: crawlDefaultTraffic,
          detectionSource: 'crawl',
          httpStatus: validation.httpStatus,
          statusBucket: validation.statusBucket,
          contentType: validation.contentType,
        };
      }
      if (validation.inconclusive) {
        return { type: 'api-inconclusive' };
      }
      workingUrlsCache.add(cacheKey);
      return { type: 'api-working' };
    }),
    /* c8 ignore next - Defensive fallback when links array is empty */
    Math.max(1, Math.min(maxConcurrent, links.length || 1)),
  );
}

function createValidationStats() {
  return {
    totalLinksAnalyzed: 0,
    cacheHitsBroken: 0,
    cacheHitsWorking: 0,
    linksCheckedViaAPI: 0,
  };
}

function updateValidationStats(stats, validations) {
  const nextStats = { ...stats };

  validations.forEach((result) => {
    if (!result || result.type === 'out-of-scope') return;

    nextStats.totalLinksAnalyzed += 1;

    if (result.type === 'cache-hit-broken') {
      nextStats.cacheHitsBroken += 1;
    } else if (result.type === 'cache-hit-working') {
      nextStats.cacheHitsWorking += 1;
    } else if (
      result.type === 'api-broken'
      || result.type === 'api-working'
      || result.type === 'api-inconclusive'
    ) {
      nextStats.linksCheckedViaAPI += 1;
    }
  });

  return nextStats;
}

/**
 * Processes a single batch of pages for crawl-based broken link detection.
 * This function is designed for batched processing across multiple Lambda invocations.
 *
 * @param {Object} params - Parameters object
 * @param {Map} params.scrapeResultPaths - Full Map of URL to S3 path (url -> s3Key)
 * @param {number} params.batchStartIndex - Index to start processing from
 * @param {number} params.batchSize - Number of pages to process in this batch
 * @param {Array} params.initialBrokenUrls - Array of known broken URLs from previous batches
 * @param {Array} params.initialWorkingUrls - Array of known working URLs from previous batches
 * @param {Object} context - Context object with s3Client, log, env, site
 * @returns {Promise<Object>} Object containing:
 *   - results: Array of broken links found in this batch
 *   - brokenUrlsCache: Updated array of all known broken URLs
 *   - workingUrlsCache: Updated array of all known working URLs
 *   - pagesProcessed: Number of pages processed in this batch
 *   - hasMorePages: Boolean indicating if more pages remain
 *   - nextBatchStartIndex: Index to start the next batch from
 *   - stats: Object with processing statistics
 */
export async function detectBrokenLinksFromCrawlBatch({
  scrapeResultPaths,
  batchStartIndex = 0,
  batchSize = PAGES_PER_BATCH,
  initialBrokenUrls = [],
  initialWorkingUrls = [],
}, context) {
  const {
    s3Client, env, log: baseLog, site,
  } = context;
  const auditId = context.audit?.getId?.() || null;
  const log = isContextLogger(baseLog)
    ? baseLog
    : createAuditLogger(baseLog, AUDIT_TYPE, site.getId(), auditId);
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const baseURL = site.getBaseURL();
  const baseHostname = new URL(baseURL).hostname.replace(/^www\./, '');
  /* c8 ignore start - config fallback parsing is defensive */
  const internalLinksConfig = site?.getConfig?.()?.getHandlers?.()?.['broken-internal-links']?.config || {};
  const scrapeFetchDelayMs = parseNonNegativeInt(
    internalLinksConfig.scrapeFetchDelayMs,
    DEFAULT_SCRAPE_FETCH_DELAY_MS,
  );
  const linkCheckBatchSize = parsePositiveInt(
    internalLinksConfig.linkCheckBatchSize,
    DEFAULT_LINK_CHECK_BATCH_SIZE,
  );
  const maxConcurrentLinkChecks = parsePositiveInt(
    internalLinksConfig.maxConcurrentLinkChecks,
    Math.min(linkCheckBatchSize, DEFAULT_MAX_CONCURRENT_LINK_CHECKS),
  );
  const linkCheckDelayMs = parseNonNegativeInt(
    internalLinksConfig.linkCheckDelayMs,
    DEFAULT_LINK_CHECK_DELAY_MS,
  );
  const crawlDefaultTraffic = getCrawlDefaultTraffic(env);
  /* c8 ignore stop */

  const startTime = Date.now();
  const formatElapsed = () => `[${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

  // Sort by URL for consistent ordering across Lambda invocations
  const allPaths = Array.from(scrapeResultPaths.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const totalPages = allPaths.length;
  const batchEndIndex = Math.min(batchStartIndex + batchSize, totalPages);
  const batchPaths = allPaths.slice(batchStartIndex, batchEndIndex);

  log.info(`${formatElapsed()} ====== BATCH PROCESSING START ======`);
  log.info(`${formatElapsed()} Processing pages ${batchStartIndex + 1}-${batchEndIndex} of ${totalPages}`);
  log.info(`${formatElapsed()} Initial cache: ${initialBrokenUrls.length} broken, ${initialWorkingUrls.length} working URLs`);

  const brokenUrlsCache = new Map();
  initialBrokenUrls.forEach((entry) => {
    if (typeof entry === 'string') {
      brokenUrlsCache.set(getUrlCacheKey(entry), {});
    } else {
      brokenUrlsCache.set(getUrlCacheKey(entry.url), {
        httpStatus: entry.httpStatus,
        statusBucket: entry.statusBucket,
        contentType: entry.contentType,
      });
    }
  });
  const workingUrlsCache = new Set(initialWorkingUrls.map(getUrlCacheKey));
  const brokenLinksMap = new Map();
  const validationStats = createValidationStats();
  let pagesProcessed = 0;
  let pagesSkipped = 0;

  for (const [url, s3Key] of batchPaths) {
    try {
      pagesProcessed += 1;
      const globalPageNum = batchStartIndex + pagesProcessed;

      if (pagesProcessed % 5 === 1 || pagesProcessed === batchPaths.length) {
        log.info(`${formatElapsed()} Progress: ${globalPageNum}/${totalPages} pages (batch ${pagesProcessed}/${batchPaths.length})`);
      }

      // eslint-disable-next-line no-await-in-loop
      const s3Object = await getObjectFromKey(s3Client, bucketName, s3Key, log);

      if (!s3Object?.scrapeResult?.rawBody) {
        pagesSkipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }

      const html = s3Object.scrapeResult.rawBody;
      const pageUrl = s3Object.finalUrl || url;

      if (!isWithinAuditScope(pageUrl, baseURL)) {
        pagesSkipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }

      const $ = cheerioLoad(html);
      const internalLinks = extractInternalLinks($, pageUrl, baseHostname, log);
      const assetReferences = extractAssetReferences($, pageUrl, baseHostname, log);

      const allLinks = internalLinks.concat(assetReferences);

      const validations = [];

      // eslint-disable-next-line no-await-in-loop
      for (let i = 0; i < allLinks.length; i += linkCheckBatchSize) {
        const batch = allLinks.slice(i, i + linkCheckBatchSize);

        // eslint-disable-next-line no-await-in-loop
        const batchResults = await validateLinksWithCache(
          batch,
          pageUrl,
          brokenUrlsCache,
          workingUrlsCache,
          baseURL,
          log,
          site.getId(),
          auditId,
          crawlDefaultTraffic,
          maxConcurrentLinkChecks,
        );

        Object.assign(validationStats, updateValidationStats(validationStats, batchResults));
        validations.push(...batchResults);

        if (i + linkCheckBatchSize < allLinks.length) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(linkCheckDelayMs);
        }
      }

      const brokenLinks = validations.filter(
        (result) => result && (result.type === 'cache-hit-broken' || result.type === 'api-broken'),
      );

      brokenLinks.forEach((link) => {
        const key = buildBrokenLinkKey(link);
        if (!brokenLinksMap.has(key)) brokenLinksMap.set(key, link);
      });
    } catch (error) {
      log.error(`Error processing ${url}: ${error.message}`);
      pagesSkipped += 1;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(scrapeFetchDelayMs);
  }

  const results = Array.from(brokenLinksMap.values());

  const {
    totalLinksAnalyzed,
    cacheHitsBroken,
    cacheHitsWorking,
    linksCheckedViaAPI,
  } = validationStats;
  const totalCacheHits = cacheHitsBroken + cacheHitsWorking;
  const cacheHitRate = totalLinksAnalyzed > 0
    ? ((totalCacheHits / totalLinksAnalyzed) * 100).toFixed(1)
    : 0;

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const hasMorePages = batchEndIndex < totalPages;

  log.info(`${formatElapsed()} ====== BATCH SUMMARY ======`);
  log.info(`${formatElapsed()} Time: ${totalTime}s for ${pagesProcessed} pages`);
  log.info(`${formatElapsed()} Links: ${totalLinksAnalyzed} analyzed, ${linksCheckedViaAPI} API calls`);
  log.info(`${formatElapsed()} Cache: ${totalCacheHits} hits (${cacheHitRate}%) - ${cacheHitsBroken} broken, ${cacheHitsWorking} working`);
  log.info(`${formatElapsed()} Results: ${results.length} broken links found in this batch`);
  log.info(`${formatElapsed()} Updated cache: ${brokenUrlsCache.size} broken, ${workingUrlsCache.size} working URLs`);
  log.info(`${formatElapsed()} Progress: ${hasMorePages ? `${totalPages - batchEndIndex} pages remaining` : 'ALL PAGES COMPLETE'}`);
  log.info(`${formatElapsed()} ===========================`);

  return {
    results,
    brokenUrlsCache: Array.from(brokenUrlsCache.entries()).map(([url, meta]) => ({ url, ...meta })),
    workingUrlsCache: Array.from(workingUrlsCache),
    pagesProcessed,
    pagesSkipped,
    hasMorePages,
    nextBatchStartIndex: batchEndIndex,
    totalPages,
    stats: {
      totalLinksAnalyzed,
      linksCheckedViaAPI,
      cacheHitsBroken,
      cacheHitsWorking,
      cacheHitRate: parseFloat(cacheHitRate),
      processingTimeSeconds: parseFloat(totalTime),
    },
  };
}

/**
 * Merges crawl-detected and RUM-detected broken links.
 * RUM links take priority as they have traffic data.
 * When same link found in both sources, combines detectionSource and keeps RUM traffic
 * + crawl metadata.
 * @param {Array} crawlLinks - Links from crawl (trafficDomain: CRAWL_DEFAULT_TRAFFIC)
 * @param {Array} rumLinks - Links from RUM (have trafficDomain)
 * @param {Object} log - Logger instance
 * @returns {Array} - Merged and deduplicated array
 */
export function mergeAndDeduplicate(firstLinks, secondLinks, log) {
  const prefersFirstAnchorText = (primaryAnchorText, fallbackAnchorText) => (
    primaryAnchorText === '[no text]'
      && typeof fallbackAnchorText === 'string'
      && fallbackAnchorText.length > 0
      && fallbackAnchorText !== '[no text]'
  );

  const linkMap = new Map();

  // Detect source names from the input data
  const firstSource = firstLinks[0]?.detectionSource || 'unknown';
  const secondSource = secondLinks[0]?.detectionSource || 'unknown';

  // Add second batch of links first (priority links - RUM has traffic data)
  secondLinks.forEach((link) => {
    linkMap.set(buildBrokenLinkKey(link), link);
  });

  let firstOnlyCount = 0;
  let bothSourcesCount = 0;
  firstLinks.forEach((link) => {
    const key = buildBrokenLinkKey(link);
    if (!linkMap.has(key)) {
      // First-only link
      linkMap.set(key, link);
      firstOnlyCount += 1;
    } else {
      // Link found in both sources - merge metadata
      const secondLink = linkMap.get(key);

      // Combine detection sources dynamically
      const existingSources = (
        typeof secondLink.detectionSource === 'string' && secondLink.detectionSource.length > 0
          ? secondLink.detectionSource
          : secondSource
      ).split('+').filter(Boolean);
      const newSource = (
        typeof link.detectionSource === 'string' && link.detectionSource.length > 0
          ? link.detectionSource
          : firstSource
      );
      const combinedSources = [...new Set([...existingSources, newSource])].sort().join('+');

      linkMap.set(key, {
        ...secondLink, // Keep second batch data (e.g., RUM traffic)
        detectionSource: combinedSources,
        // Preserve second-link data and only backfill missing metadata from the first source.
        // Placeholder LinkChecker text should not overwrite real crawl anchor text.
        anchorText: prefersFirstAnchorText(secondLink.anchorText, link.anchorText)
          ? link.anchorText
          : (secondLink.anchorText ?? link.anchorText),
        itemType: secondLink.itemType ?? link.itemType,
        httpStatus: secondLink.httpStatus ?? link.httpStatus,
        statusBucket: secondLink.statusBucket ?? link.statusBucket,
        contentType: secondLink.contentType ?? link.contentType,
      });
      bothSourcesCount += 1;
    }
  });

  const merged = Array.from(linkMap.values());
  log.info(`Merged: ${secondLinks.length} ${secondSource} (${bothSourcesCount} also in ${firstSource}) + ${firstOnlyCount} ${firstSource}-only = ${merged.length} total`);

  return merged;
}
