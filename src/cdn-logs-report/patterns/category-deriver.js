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
import { prompt } from './prompt.js';

// Derive site-specific category rules in 4 tiers (cheapest-reliable first):
//   1. breadcrumb depth-1 from schema.org BreadcrumbList
//   2. slug-token backfill (extends existing buckets, never invents)
//   3. path-frequency on first segment (locale-stripped, page-type-blocklisted)
//   4. LLM on residuals, using (path, title, h1)

const BREADCRUMB_DEPTH = 1;
const MIN_CLUSTER = 3;
const MIN_PATH_SHARE = 0.02;
const MAX_PATH_BUCKETS = 12;
const DOMINANT_SHARE = 0.5;
const LLM_MIN_RESIDUALS = 5;
const LLM_MAX_ITEMS = 200;

// Locale prefixes we strip before path bucketing. Explicit allowlist because
// some 2-letter codes (e.g. "ai") are valid topical categories.
const LOCALES = new Set([
  // ISO 639-1 languages
  'en', 'es', 'de', 'fr', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs',
  'ru', 'tr', 'ar', 'he', 'hi', 'th', 'vi', 'id', 'ms', 'tl', 'el', 'hu', 'ro',
  'sk', 'uk', 'bg', 'sr', 'hr', 'sl', 'lv', 'lt', 'et', 'ur', 'bn', 'ta', 'te',
  'ja', 'jp', 'ko', 'kr', 'zh', 'cn', 'tw', 'hk',
  // ISO 3166-1 country codes
  'au', 'ca', 'in', 'br', 'mx', 'ie', 'nz', 'za', 'us', 'gb', 'sg', 'my', 'ph',
  'ae', 'sa', 'eg', 'cl', 'co', 'ar', 'pe', 've', 'ch', 'at', 'be', 'lu',
  'dk', 'se', 'gr', 'is', 'mt', 'cy', 'ee', 'si',
  'kz', 'kg', 'uz', 'tj', 'tm', 'az', 'ge', 'am', 'by', 'md', 'rs',
  'iq', 'om', 'qa', 'jo', 'lb', 'sy', 'ye', 'kw', 'bh', 'ps',
  'pk', 'bd', 'lk', 'np', 'mm', 'kh', 'la', 'mn',
  'ng', 'ke', 'gh', 'tz', 'ug', 'rw', 'et', 'ma', 'tn', 'dz', 'sn', 'ci',
]);
const LOCALE_REGION_RE = /^[a-z]{2}[-_][a-z]{2,4}$/i;
const PAGE_EXT_RE = /\.(?:html?|aspx?|php|jsp|do|action|xml)$/i;
const HOME_LIKE = new Set(['home', 'homepage', 'start', 'startseite']);

// Segments that name a page TYPE rather than a topic — excluded from category
// candidates so page-type-analysis owns the type dimension cleanly.
const PAGE_TYPE_SEGMENTS = new Set([
  'blog', 'blogs', 'articles', 'article', 'news', 'stories', 'insights', 'press', 'newsroom',
  'docs', 'documentation', 'reference', 'api', 'api-docs',
  'help', 'support', 'faq', 'faqs', 'kb', 'knowledge-base', 'guide', 'guides',
  'tutorial', 'tutorials', 'learn', 'learning', 'troubleshoot',
  'about', 'about-us', 'company', 'team', 'careers', 'jobs', 'investors',
  'contact', 'contact-us', 'legal', 'privacy', 'terms', 'cookies', 'policy', 'policies', 'gdpr',
  'search', 'find', 'results', 'cart', 'basket', 'bag', 'checkout',
  'login', 'signin', 'signup', 'register', 'account',
  'events', 'event', 'webinars', 'webinar', 'calendar', 'sitemap', 'robots',
  'error', 'errors', '404', '500', 'not-found', 'maintenance',
]);

const END = '(/|$|\\?|#|\\.)';

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLocale = (s) => !!s && (LOCALES.has(s.toLowerCase()) || LOCALE_REGION_RE.test(s));
const isNoise = (s) => /^\d+$/.test(s) || /^(?:19|20)\d{2}$/.test(s) || /^[a-f0-9]{8,}$/i.test(s);
const segsOf = (p) => (!p || p === '/' ? [] : p.replace(/\/+$/, '').split('/').filter(Boolean));
const bucketRegex = (segs) => `(?i)(^|/)${segs.map(escapeRe).join('/')}${END}`;

function topicalSegs(p) {
  let segs = segsOf(p);
  while (segs.length && isLocale(segs[0])) {
    segs = segs.slice(1);
  }
  return segs.map((s) => s.toLowerCase().replace(PAGE_EXT_RE, '')).filter(Boolean);
}

// Longest TOPICAL path-segment prefix shared by every URL — leading locale
// segments are stripped first so multi-locale clusters don't collapse to
// just the locale (e.g. /bg_bg/zheni/... ∩ /bg_bg/maje/... should yield
// nothing, not "/bg_bg").
function commonPrefix(paths, maxDepth = 2) {
  if (!paths.length) {
    return [];
  }
  const split = paths.map(topicalSegs);
  const out = [];
  for (let d = 0; d < maxDepth; d += 1) {
    const head = split[0][d];
    if (!head || !split.every((s) => s[d] === head)) {
      break;
    }
    out.push(head);
  }
  return out;
}

// ──────────────── Tier 1: breadcrumb ────────────────

function clusterByBreadcrumb(records) {
  const byLabel = new Map();
  records.forEach((rec) => {
    const crumbs = rec?.signal?.breadcrumb;
    if (!Array.isArray(crumbs) || crumbs.length <= BREADCRUMB_DEPTH) {
      return;
    }
    const raw = crumbs[BREADCRUMB_DEPTH];
    const key = raw ? norm(raw) : '';
    if (!key || HOME_LIKE.has(key)) {
      return;
    }
    if (!byLabel.has(key)) {
      byLabel.set(key, { label: raw, paths: [] });
    }
    byLabel.get(key).paths.push(rec.path);
  });

  const buckets = [];
  const claimed = new Set();
  byLabel.forEach(({ label, paths }, key) => {
    if (paths.length < MIN_CLUSTER) {
      return;
    }
    const prefix = commonPrefix(paths);
    let regex;
    if (prefix.length) {
      regex = bucketRegex(prefix);
    } else if (/^[\x20-\x7e]+$/.test(key)) {
      // Bucket name is ASCII — fall back to keyword regex from the name.
      regex = `(?i)(^|/)${escapeRe(key.replace(/\s+/g, '[-_ ]'))}${END}`;
    } else {
      // Non-Latin breadcrumb label (e.g. Bulgarian, Korean) with no usable
      // path prefix. The label can't be matched against romanised URL slugs,
      // so drop the bucket — URLs fall through to later tiers.
      return;
    }
    buckets.push({
      name: titleCase(label),
      source: 'breadcrumb',
      regex,
      count: paths.length,
      sample: paths.slice(0, 5),
    });
    paths.forEach((p) => claimed.add(p));
  });
  buckets.sort((a, b) => b.count - a.count);
  return { buckets, claimed };
}

// ──────────────── Slug-token backfill ────────────────
//
// Extend tier-1 buckets with URLs whose SLUG mentions the category name
// (e.g. /blog/photoshop-tips → Photoshop). Path-only — title/h1 only inform
// the LLM tier since the persisted regex matches paths in production.
function backfillFromSlug(records, claimed, buckets) {
  if (!buckets.length) {
    return 0;
  }
  const tokenMap = new Map();
  for (const b of buckets) {
    const nameTokens = b.name.toLowerCase().split(/\s+/).filter((x) => x.length >= 3);
    for (const t of nameTokens) {
      if (!tokenMap.has(t)) {
        tokenMap.set(t, b);
      }
    }
  }

  let added = 0;
  records.forEach((rec) => {
    if (claimed.has(rec.path)) {
      return;
    }
    const slugTokens = rec.path.toLowerCase().split(/[/\-_]+/)
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
    const hit = slugTokens.map((t) => tokenMap.get(t)).find(Boolean);
    if (!hit) {
      return;
    }
    hit.count += 1;
    if (hit.sample.length < 5) {
      hit.sample.push(rec.path);
    }
    claimed.add(rec.path);
    added += 1;
  });
  return added;
}

// ──────────────── Tier 2: path-frequency ────────────────

function expandToDepthTwo(head, urls, parentThreshold) {
  const childCounts = new Map();
  urls.forEach((p) => {
    const segs = topicalSegs(p);
    let d = 1;
    while (d < segs.length && isNoise(segs[d])) {
      d += 1;
    }
    if (d >= segs.length || PAGE_TYPE_SEGMENTS.has(segs[d])) {
      return;
    }
    if (!childCounts.has(segs[d])) {
      childCounts.set(segs[d], []);
    }
    childCounts.get(segs[d]).push(p);
  });
  const childThreshold = Math.max(MIN_CLUSTER, Math.ceil(urls.length * MIN_PATH_SHARE));
  const threshold = Math.min(parentThreshold, childThreshold);
  return Array.from(childCounts.entries())
    .filter(([, u]) => u.length >= threshold)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([child, u]) => ({
      name: titleCase(child.replace(/[-_]+/g, ' ')),
      source: 'path',
      regex: bucketRegex([head, child]),
      count: u.length,
      sample: u.slice(0, 5),
    }));
}

function clusterByPathFreq(paths) {
  if (!paths.length) {
    return [];
  }

  const byHead = new Map();
  paths.forEach((p) => {
    const segs = topicalSegs(p);
    if (!segs.length || PAGE_TYPE_SEGMENTS.has(segs[0])) {
      return;
    }
    if (!byHead.has(segs[0])) {
      byHead.set(segs[0], []);
    }
    byHead.get(segs[0]).push(p);
  });

  const threshold = Math.max(MIN_CLUSTER, Math.ceil(paths.length * MIN_PATH_SHARE));
  const heads = Array.from(byHead.entries()).sort((a, b) => b[1].length - a[1].length);
  const out = [];

  heads.forEach(([head, urls]) => {
    if (urls.length < threshold) {
      return;
    }
    const dominant = urls.length / paths.length >= DOMINANT_SHARE
      && urls.length >= 2 * threshold;
    if (dominant) {
      const children = expandToDepthTwo(head, urls, threshold);
      if (children.length >= 2) {
        out.push(...children);
        return;
      }
    }
    out.push({
      name: titleCase(head.replace(/[-_]+/g, ' ')),
      source: 'path',
      regex: bucketRegex([head]),
      count: urls.length,
      sample: urls.slice(0, 5),
    });
  });
  return out.sort((a, b) => b.count - a.count).slice(0, MAX_PATH_BUCKETS);
}

// ──────────────── Tier 3: LLM on residuals ────────────────

const LLM_SYSTEM = `You group URLs into TOPICAL categories — what the page is ABOUT, not what kind of page it is.

GOOD category names (topical):  Photoshop, Mutual Funds, Joint Replacement, Women's Apparel, Cloud Storage
BAD  category names (page-type): Blog, Docs, Help, FAQ, Cart, Checkout, About, Contact, Legal, Search, Homepage

Each input URL may include "title" and "h1". Use them to understand the page, but the regex you emit MUST match the URL PATH (CDN-log format: plain path, leading slash optional, no host).

Regex rules (POSIX, Athena):
1. Anchor each keyword on a slash boundary or start-of-string:  (^|/)keyword(/|$|\\?|#|\\.)
2. No bare ^, no \\b, no lookaround, no non-capturing groups, no backrefs.
3. Every keyword in your regex MUST appear verbatim in at least one example path's slug. If a topic is only in the title and never in any slug, skip it — there's nothing to match.

If the URLs are too heterogeneous to form 3+ meaningful TOPICAL categories, return an empty list. Do NOT invent categories — empty is correct when there's no signal.

Produce 0-6 categories. Each:
- name: Title Case, 1-3 words
- regex: (?i)... slash-anchored
- example: one input path whose slug contains a regex keyword

Return JSON only: {"sections":[{"name":"...","regex":"(?i)...","example":"/..."}]}`;

async function clusterByLlm(residuals, domain, context) {
  if (residuals.length < LLM_MIN_RESIDUALS) {
    return [];
  }

  const items = residuals.slice(0, LLM_MAX_ITEMS).map((r) => ({
    path: r.path,
    title: r.signal?.title || undefined,
    h1: r.signal?.h1 || undefined,
  }));

  try {
    const userMsg = `Domain: ${domain}\n\nURLs:\n${JSON.stringify(items)}`;
    const resp = await prompt(LLM_SYSTEM, userMsg, context);
    if (!resp?.content) {
      return [];
    }
    const cleaned = resp.content.replace(/^```(?:json)?\s*|```$/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return (parsed?.sections || [])
      .filter((s) => s?.name && s?.regex)
      .filter((s) => {
        const slug = String(s.name).toLowerCase().replace(/\s+/g, '-');
        return !PAGE_TYPE_SEGMENTS.has(slug);
      })
      .map((s) => ({
        name: titleCase(String(s.name).trim()),
        source: 'llm',
        regex: String(s.regex).trim(),
        count: 0,
        sample: s.example ? [s.example] : [],
      }));
  } catch (err) {
    context.log?.warn?.(`category-deriver: LLM tier failed: ${err.message}`);
    return [];
  }
}

// ──────────────── Validation + orchestration ────────────────

function compileRule(rule, log) {
  try {
    return new RegExp(rule.regex.replace(/^\(\?i\)/, ''), 'i');
  } catch (err) {
    log?.warn?.(`category-deriver: invalid regex for "${rule.name}": ${err.message}`);
    return null;
  }
}

// Drop rules whose own samples don't match — catches LLM mismatches and any
// code regression that emits a broken pattern.
function validateAgainstSamples(rules, log) {
  const out = [];
  rules.forEach((rule) => {
    const re = compileRule(rule, log);
    if (!re) {
      return;
    }
    const ok = !rule.sample?.length || rule.sample.every((p) => re.test(p));
    if (!ok) {
      log?.warn?.(`category-deriver: regex for "${rule.name}" failed self-test (regex=${rule.regex})`);
      return;
    }
    out.push({ rule, re });
  });
  return out;
}

function computeCoverage(validated, paths) {
  if (!validated.length || !paths.length) {
    return { matched: 0, total: paths.length, percent: 0 };
  }
  const matched = paths.filter((p) => {
    const stripped = p.startsWith('/') ? p.slice(1) : p;
    return validated.some(({ re }) => re.test(p) || re.test(stripped));
  }).length;
  return {
    matched,
    total: paths.length,
    percent: Math.round((matched / paths.length) * 100),
  };
}

export async function deriveCategories(records, domain, context) {
  const { log } = context;
  const allPaths = records.map((r) => r.path);

  const { buckets: crumb, claimed } = clusterByBreadcrumb(records);
  log?.info(`category-deriver: tier1 breadcrumb=${crumb.length} buckets, claimed=${claimed.size}/${allPaths.length}`);

  const backfilled = backfillFromSlug(records, claimed, crumb);
  if (backfilled) {
    log?.info(`category-deriver: slug-token backfill +${backfilled}`);
  }

  const path = clusterByPathFreq(allPaths.filter((p) => !claimed.has(p)));
  path.forEach((b) => b.sample.forEach((p) => claimed.add(p)));
  log?.info(`category-deriver: tier2 path-freq=${path.length} buckets`);

  const llm = await clusterByLlm(records.filter((r) => !claimed.has(r.path)), domain, context);
  log?.info(`category-deriver: tier3 llm=${llm.length} buckets`);

  // Dedupe by diacritic-normalised lowercase name so e.g. "muži"
  // (Czech breadcrumb) collapses with "muzi" (path-frequency from the
  // ASCII URL slug). Tier order in the spread decides who wins.
  const dedupKey = (s) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const seen = new Map();
  for (const b of [...crumb, ...path, ...llm]) {
    const k = dedupKey(b.name);
    if (!seen.has(k)) {
      seen.set(k, b);
    }
  }
  const rules = Array.from(seen.values()).map((b, i) => ({
    name: b.name.toLowerCase(),
    regex: b.regex,
    sort_order: i,
    sourceTier: b.source,
    observedCount: b.count,
    sample: b.sample,
  }));

  const validated = validateAgainstSamples(rules, log);
  const coverage = computeCoverage(validated, allPaths);

  return {
    rules: validated.map(({ rule }) => rule),
    tiers: {
      breadcrumb: crumb.length,
      path: path.length,
      llm: llm.length,
      total: validated.length,
    },
    coverage,
  };
}
/* c8 ignore end */
