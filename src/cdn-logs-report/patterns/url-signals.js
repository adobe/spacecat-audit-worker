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
// Node's native fetch (HTTP/1.1, undici) — @adobe/fetch uses HTTP/2 which
// some site WAFs reject (e.g. Adobe's own business.adobe.com returns
// NGHTTP2_INTERNAL_ERROR). Category derivation runs once per site so the
// tracing/cache layer in @adobe/fetch is not worth the compatibility cost.
import { getSitemapUrls } from '../../sitemap/common.js';
import { getObjectFromKey } from '../../utils/s3-utils.js';

// Use a stock Chrome UA. The "Spacecat/" suffix used elsewhere in the codebase
// is a known WAF-flagged token on some Adobe-protected sites (returns 401/abort).
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_SAMPLE_SIZE = 300;
const DEDUP_DEPTH = 3;
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_CONCURRENCY = 3;
const JSON_LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;

// ──────────────── sitemap sampling ────────────────

function toPath(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return null;
  }
}

/**
 * Sample URLs from the site's sitemap, deduplicated by first N path segments
 * so we spread the sample across sections instead of clustering on /products/.
 */
export async function fetchSitemapSample(baseUrl, log, sampleSize = DEFAULT_SAMPLE_SIZE) {
  // Cap discovery: we only need a representative sample, not the full sitemap
  // graph. Multi-locale e-commerce sites publish thousands of sub-sitemaps
  // (filter pages, product pages per locale) — without a cap, discovery never
  // terminates in reasonable time. 5000 pages is way more than `sampleSize`.
  const result = await getSitemapUrls(baseUrl, log, { maxPages: 5000 });
  const all = Object.values(result?.details?.extractedPaths || {}).flat();
  if (!result?.success || !all.length) {
    log?.info(`url-signals: no usable sitemap for ${baseUrl}`);
    return null;
  }

  const seen = new Set();
  const deduped = [];
  for (const url of all) {
    const path = toPath(url);
    if (path) {
      const key = `/${path.split('/').filter(Boolean).slice(0, DEDUP_DEPTH).join('/')}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push({ url, path });
      }
    }
  }

  let sample = deduped;
  if (deduped.length > sampleSize) {
    sample = [...deduped];
    for (let i = sample.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [sample[i], sample[j]] = [sample[j], sample[i]];
    }
    sample = sample.slice(0, sampleSize);
  }

  log?.info(`url-signals: sitemap=${all.length}, unique=${deduped.length}, sampled=${sample.length}`);
  return { urls: sample, totalDiscovered: all.length };
}

// ──────────────── JSON-LD parsing ────────────────

function asArray(v) {
  if (v == null) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

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
  for (const node of nodes) {
    const types = asArray(node?.['@type']).map((t) => String(t).toLowerCase());
    if (types.includes('breadcrumblist')) {
      const labels = asArray(node.itemListElement)
        .map((it) => it?.name || it?.item?.name)
        .filter((n) => typeof n === 'string')
        .map((n) => n.trim());
      if (labels.length) {
        return labels;
      }
    }
  }
  return [];
}

function extractSchemaTypes(nodes) {
  const out = new Set();
  for (const node of nodes) {
    asArray(node?.['@type']).forEach((t) => {
      if (typeof t === 'string') {
        out.add(t);
      }
    });
  }
  return [...out];
}

// Normalise both legacy array shape and WAE keyed shape {jsonld:{Type:[...]}}.
function parseStructuredData(sd) {
  if (!sd) {
    return [];
  }
  if (Array.isArray(sd)) {
    return sd.flatMap(flatten);
  }
  return Object.entries(sd.jsonld || {}).flatMap(
    ([type, instances]) => asArray(instances).flatMap(
      (i) => flatten(i?.['@type'] ? i : { ...i, '@type': type }),
    ),
  );
}

function parseHtml(html) {
  if (!html) {
    return { nodes: [], title: '', h1: '' };
  }
  const nodes = [];
  JSON_LD_RE.lastIndex = 0;
  let m = JSON_LD_RE.exec(html);
  while (m !== null) {
    const raw = m[1].trim();
    if (raw) {
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
    m = JSON_LD_RE.exec(html);
  }
  const strip = (s) => (s ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '');
  return {
    nodes,
    title: strip(html.match(TITLE_RE)?.[1] || ''),
    h1: strip(html.match(H1_RE)?.[1] || ''),
  };
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
  const { nodes, title, h1 } = parseHtml(html);
  return {
    source: 'fetch',
    title,
    h1,
    breadcrumb: extractBreadcrumb(nodes),
    schemaTypes: extractSchemaTypes(nodes),
  };
}

// ──────────────── per-URL signal acquisition ────────────────

async function s3Signal(s3Client, bucket, siteId, path, log) {
  if (!s3Client || !bucket) {
    return null;
  }
  const key = `scrapes/${siteId}${path}/scrape.json`;
  try {
    const obj = await getObjectFromKey(s3Client, bucket, key, log);
    return obj && typeof obj === 'object' ? signalFromScrape(obj) : null;
  } catch {
    return null;
  }
}

async function httpSignal(url, log) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) {
      return null;
    }
    return signalFromHtml(await resp.text());
  } catch (err) {
    log?.debug?.(`url-signals: fetch failed for ${url}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function parallelMap(items, concurrency, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
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
 * For each input record `{url, path}`, attach a `signal` field:
 *   `{ source:'s3'|'fetch', title, h1, breadcrumb:string[], schemaTypes:string[] }`
 * S3 scrape.json is tried first (free); misses fall back to a direct HTTP GET.
 */
export async function collectUrlSignals(records, { site, context, allowDirectFetch = true }) {
  const { log, s3Client, env } = context;
  const bucket = env?.S3_SCRAPER_BUCKET_NAME;
  const siteId = site.getId();
  const stats = { s3Hits: 0, fetchHits: 0, misses: 0 };

  const s3 = await parallelMap(
    records,
    FETCH_CONCURRENCY,
    (r) => s3Signal(s3Client, bucket, siteId, r.path, log),
  );
  s3.forEach((s) => {
    if (s) {
      stats.s3Hits += 1;
    }
  });

  const needsFetch = records
    .map((_, idx) => ((!s3[idx] && allowDirectFetch) ? idx : -1))
    .filter((i) => i >= 0);

  let fetched = [];
  if (needsFetch.length) {
    log?.info(`url-signals: fetching ${needsFetch.length} URLs directly (S3 hits=${stats.s3Hits})`);
    fetched = await parallelMap(
      needsFetch,
      FETCH_CONCURRENCY,
      (idx) => httpSignal(records[idx].url, log),
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

  log?.info(`url-signals: s3=${stats.s3Hits}, fetch=${stats.fetchHits}, miss=${stats.misses}`);
  return { records: out, stats };
}
/* c8 ignore end */
