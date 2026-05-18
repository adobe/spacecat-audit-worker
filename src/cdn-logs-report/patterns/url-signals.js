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

/* c8 ignore start */
// Per-URL signal acquisition for category derivation: sample sitemap URLs,
// then pull (title, h1, breadcrumb, schema.org @types) for each — first from
// the existing S3 scrape cache, then via direct HTTP fetch as fallback.
//
// Uses Node's native fetch (undici/HTTP-1.1) deliberately: @adobe/fetch is
// HTTP/2, which some WAFs (incl. Adobe-protected sites) reject. Stock Chrome
// UA for the same reason — bot-like UAs get 401'd by Akamai/Imperva.

import { getSitemapUrls } from '../../sitemap/common.js';
import { getObjectFromKey } from '../../utils/s3-utils.js';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const numEnv = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

// Conservative defaults that fit a Lambda budget. Overridable via env so
// they can be tuned without redeploying.
const DEFAULT_SAMPLE_SIZE = numEnv('CDN_PATTERNS_SAMPLE_SIZE', 150);
const SITEMAP_MAX_PAGES = numEnv('CDN_PATTERNS_SITEMAP_MAX_PAGES', 5000);
const DEDUP_DEPTH = 3;
const FETCH_TIMEOUT_MS = numEnv('CDN_PATTERNS_FETCH_TIMEOUT_MS', 10_000);
const FETCH_CONCURRENCY = numEnv('CDN_PATTERNS_FETCH_CONCURRENCY', 3);
const SIGNAL_BUDGET_MS = numEnv('CDN_PATTERNS_SIGNAL_BUDGET_MS', 240_000);

const JSON_LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;

function asArray(v) {
  if (v == null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}
const strip = (s) => (s ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '');

// ──────────────── sitemap sampling ────────────────

function toPath(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return null;
  }
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Sample sitemap URLs, deduplicating by first N path segments so the sample
// spreads across site sections instead of clustering on one heavy subtree.
export async function fetchSitemapSample(baseUrl, log, sampleSize = DEFAULT_SAMPLE_SIZE) {
  const result = await getSitemapUrls(baseUrl, log, { maxPages: SITEMAP_MAX_PAGES });
  const all = Object.values(result?.details?.extractedPaths || {}).flat();
  if (!result?.success || !all.length) {
    log?.info(`url-signals: no usable sitemap for ${baseUrl}`);
    return null;
  }

  const seen = new Set();
  const deduped = [];
  all.forEach((url) => {
    const path = toPath(url);
    if (!path) {
      return;
    }
    const key = `/${path.split('/').filter(Boolean).slice(0, DEDUP_DEPTH).join('/')}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push({ url, path });
  });

  const sample = deduped.length > sampleSize
    ? shuffled(deduped).slice(0, sampleSize)
    : deduped;

  log?.info(`url-signals: sitemap=${all.length}, unique=${deduped.length}, sampled=${sample.length}`);
  return { urls: sample, totalDiscovered: all.length };
}

// ──────────────── JSON-LD parsing ────────────────

function flatten(obj) {
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  if (Array.isArray(obj)) {
    return obj.flatMap(flatten);
  }
  if (Array.isArray(obj['@graph'])) {
    return obj['@graph'].flatMap(flatten);
  }
  return [obj];
}

function extractBreadcrumb(nodes) {
  const found = nodes.find((n) => {
    const types = asArray(n?.['@type']).map((t) => String(t).toLowerCase());
    return types.includes('breadcrumblist');
  });
  if (!found) {
    return [];
  }
  return asArray(found.itemListElement)
    .map((it) => it?.name || it?.item?.name)
    .filter((n) => typeof n === 'string')
    .map((n) => n.trim())
    .filter(Boolean);
}

function extractSchemaTypes(nodes) {
  const out = new Set();
  nodes.forEach((n) => {
    asArray(n?.['@type']).forEach((t) => {
      if (typeof t === 'string') {
        out.add(t);
      }
    });
  });
  return [...out];
}

// Normalise the scraper's structuredData blob across legacy array shape and
// WAE keyed shape ({ jsonld: { Type: [...] } }).
function parseStructuredData(sd) {
  if (!sd) {
    return [];
  }
  if (Array.isArray(sd)) {
    return sd.flatMap(flatten);
  }
  return Object.entries(sd.jsonld || {}).flatMap(([type, instances]) => (
    asArray(instances).flatMap((i) => flatten(i?.['@type'] ? i : { ...i, '@type': type }))
  ));
}

function parseJsonLdFromHtml(html) {
  const nodes = [];
  JSON_LD_RE.lastIndex = 0;
  for (let m = JSON_LD_RE.exec(html); m !== null; m = JSON_LD_RE.exec(html)) {
    const raw = m[1].trim();
    if (!raw) {
      continue; // eslint-disable-line no-continue
    }
    try {
      nodes.push(...flatten(JSON.parse(raw)));
    } catch {
      try {
        nodes.push(...flatten(JSON.parse(`[${raw}]`)));
      } catch {
        /* swallow */
      }
    }
  }
  return nodes;
}

function signalFromScrape(scrape) {
  const tags = scrape?.scrapeResult?.tags || {};
  const nodes = parseStructuredData(scrape?.scrapeResult?.structuredData);
  return {
    source: 's3',
    title: (Array.isArray(tags.title) ? tags.title[0] : tags.title) || '',
    h1: (Array.isArray(tags.h1) ? tags.h1[0] : tags.h1) || '',
    breadcrumb: extractBreadcrumb(nodes),
    schemaTypes: extractSchemaTypes(nodes),
  };
}

function signalFromHtml(html) {
  if (!html) {
    return null;
  }
  const nodes = parseJsonLdFromHtml(html);
  return {
    source: 'fetch',
    title: strip(html.match(TITLE_RE)?.[1] || ''),
    h1: strip(html.match(H1_RE)?.[1] || ''),
    breadcrumb: extractBreadcrumb(nodes),
    schemaTypes: extractSchemaTypes(nodes),
  };
}

// ──────────────── per-URL signal acquisition ────────────────

// Resolve the most recent default-processing scrape for a URL via the
// data-access layer (ScrapeUrl model). The S3 key is whatever path the
// scrape-job service wrote, which today is `scrapes/{scrapeJobId}/{...}/scrape.json`
// — a UUID-keyed location we can't compute from siteId.
async function s3Signal(s3Client, bucket, scrapeUrlModel, url, log) {
  if (!s3Client || !bucket || !scrapeUrlModel) {
    return null;
  }
  try {
    const records = await scrapeUrlModel.allRecentByUrlAndProcessingType(url, 'default');
    const latest = records?.[0];
    const key = typeof latest?.getPath === 'function' ? latest.getPath() : latest?.path;
    if (!key) {
      return null;
    }
    const obj = await getObjectFromKey(s3Client, bucket, key, log);
    return obj && typeof obj === 'object' ? signalFromScrape(obj) : null;
  } catch {
    return null;
  }
}

async function httpSignal(url, log) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!resp.ok) {
      return null;
    }
    return signalFromHtml(await resp.text());
  } catch (err) {
    log?.debug?.(`url-signals: fetch failed for ${url}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Bounded-concurrency map with an optional wall-clock deadline. Once the
// deadline fires, in-flight workers finish but no new work is claimed —
// the remaining slots in `out` stay `undefined` so callers can detect them.
async function parallelMap(items, concurrency, worker, deadline = Infinity) {
  const out = new Array(items.length);
  let cursor = 0;
  const stop = () => Date.now() >= deadline;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length && !stop()) {
      const idx = cursor;
      cursor += 1;
      // eslint-disable-next-line no-await-in-loop
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Attach a `signal` field to each `{url, path}` record:
 *   `{ source: 's3'|'fetch', title, h1, breadcrumb: string[], schemaTypes: string[] }`
 *
 * For each URL, looks up the most recent default-processing scrape via the
 * ScrapeUrl data-access model and reads the cached scrape.json from S3. If
 * no scrape record exists, falls back to a direct HTTP GET against the URL.
 */
export async function collectUrlSignals(records, { context, allowDirectFetch = true }) {
  const {
    log, s3Client, env, dataAccess,
  } = context;
  const bucket = env?.S3_SCRAPER_BUCKET_NAME;
  const scrapeUrlModel = dataAccess?.ScrapeUrl;
  const deadline = Date.now() + SIGNAL_BUDGET_MS;
  const stats = {
    s3Hits: 0, fetchHits: 0, misses: 0, deadlineHit: false,
  };

  const s3 = await parallelMap(
    records,
    FETCH_CONCURRENCY,
    (r) => s3Signal(s3Client, bucket, scrapeUrlModel, r.url, log),
    deadline,
  );
  s3.forEach((s) => {
    if (s) {
      stats.s3Hits += 1;
    }
  });

  const needsFetch = allowDirectFetch
    ? records.map((_, idx) => (s3[idx] ? -1 : idx)).filter((i) => i >= 0)
    : [];

  let fetched = [];
  if (needsFetch.length) {
    log?.info(`url-signals: fetching ${needsFetch.length} URLs directly (S3 hits=${stats.s3Hits})`);
    fetched = await parallelMap(
      needsFetch,
      FETCH_CONCURRENCY,
      (idx) => httpSignal(records[idx].url, log),
      deadline,
    );
  }

  const out = records.map((r, idx) => {
    let signal = s3[idx];
    if (!signal) {
      const f = needsFetch.indexOf(idx);
      signal = f >= 0 ? fetched[f] : null;
    }
    if (signal?.source === 'fetch') {
      stats.fetchHits += 1;
    }
    if (!signal) {
      stats.misses += 1;
    }
    return { ...r, signal: signal || null };
  });

  if (Date.now() >= deadline) {
    stats.deadlineHit = true;
    log?.warn?.(`url-signals: signal-collection budget (${SIGNAL_BUDGET_MS}ms) exhausted — ${stats.misses} URLs unresolved`);
  }
  log?.info(`url-signals: s3=${stats.s3Hits}, fetch=${stats.fetchHits}, miss=${stats.misses}, deadlineHit=${stats.deadlineHit}`);
  return { records: out, stats };
}
/* c8 ignore end */
