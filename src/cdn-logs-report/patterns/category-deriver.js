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

// Pipeline:
//   1. Breadcrumb tier (gold) — depth-1 label from schema.org BreadcrumbList
//   2. Slug-token backfill   — extend tier-1 buckets with URLs whose slug
//                              mentions an existing category (no new buckets)
//   3. Path-frequency tier   — first-segment frequency; SKIPS page-type
//                              segments (blog/docs/help/...) so they don't
//                              pollute category set
//   4. LLM tier              — residual semantic work using (path, title, h1)

const BREADCRUMB_DEPTH = 1; // depth-0 is "Home"; depth-1 is the section
const MIN_CLUSTER = 3;
const MIN_PATH_SHARE = 0.02;
const MAX_PATH_BUCKETS = 12;
// Known locale / region path-prefix segments. A 2-letter prefix isn't enough
// to be a locale (e.g. "ai" could be a topic); we use an explicit allowlist so
// real topical categories named with a 2-letter abbreviation survive.
const LOCALE_SEGMENTS = new Set([
  // ISO 639-1 languages
  'en', 'es', 'de', 'fr', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs',
  'ru', 'tr', 'ar', 'he', 'hi', 'th', 'vi', 'id', 'ms', 'tl', 'el', 'hu', 'ro',
  'sk', 'uk', 'bg', 'sr', 'hr', 'sl', 'lv', 'lt', 'et',
  'ja', 'jp', 'ko', 'kr', 'zh', 'cn', 'tw', 'hk',
  // ISO 3166-1 country codes commonly used as region prefixes
  'au', 'ca', 'in', 'br', 'mx', 'ie', 'nz', 'za', 'us', 'gb', 'sg', 'my', 'ph',
  'ae', 'sa', 'eg', 'cl', 'co', 'ar', 'pe', 've', 'ch', 'at', 'be', 'lu',
  'dk', 'se', 'gr', 'is', 'mt', 'cy', 'ee', 'lv', 'lt', 'si',
]);

// Strip common page extensions when extracting a path-segment name, so
// "/section.html" and "/section/page.html" both bucket under "section".
const PAGE_EXT_RE = /\.(?:html?|aspx?|php|jsp|do|action|xml)$/i;
// Locale-region patterns like "en-us", "zh-hans", "pt-br".
const LOCALE_REGION_RE = /^[a-z]{2}[-_][a-z]{2,4}$/i;
const HOME_LIKE = new Set(['home', 'homepage', 'start', 'startseite']);
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
]);

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pathSegs(p) {
  if (!p || p === '/') {
    return [];
  }
  return p.replace(/\/+$/, '').split('/').filter(Boolean);
}

// ──────────────── Tier 1: breadcrumb clustering ────────────────

function commonPrefix(paths, maxDepth = 2) {
  if (!paths.length) {
    return [];
  }
  const split = paths.map((p) => pathSegs(p));
  const out = [];
  for (let d = 0; d < maxDepth; d += 1) {
    const head = split[0][d];
    if (head && split.every((s) => s[d] === head)) {
      out.push(head);
    } else {
      break;
    }
  }
  return out;
}

function clusterByBreadcrumb(records) {
  const byLabel = new Map();
  for (const rec of records) {
    const crumbs = rec?.signal?.breadcrumb;
    if (Array.isArray(crumbs) && crumbs.length > BREADCRUMB_DEPTH) {
      const raw = crumbs[BREADCRUMB_DEPTH];
      const key = raw ? norm(raw) : '';
      if (key && !HOME_LIKE.has(key)) {
        if (!byLabel.has(key)) {
          byLabel.set(key, { label: raw, paths: [] });
        }
        byLabel.get(key).paths.push(rec.path);
      }
    }
  }

  const claimed = new Set();
  const buckets = [];
  for (const [key, { label, paths }] of byLabel) {
    if (paths.length >= MIN_CLUSTER) {
      const prefix = commonPrefix(paths);
      // Regex must match URLs in CDN logs, which may appear as `/path`,
      // `host.com/path`, `https://host.com/path`, or even `path` with no
      // leading slash. So we anchor on a slash *or* start-of-string, and
      // close on slash / end / query / fragment — never on `^/`.
      const regex = prefix.length
        ? `(?i)(^|/)${prefix.map(escapeRe).join('/')}(/|$|\\?|#)`
        : `(?i)(^|/)${escapeRe(key.replace(/\s+/g, '[-_ ]'))}(/|$|\\?|#|-)`;
      buckets.push({
        name: titleCase(label),
        source: 'breadcrumb',
        regex,
        count: paths.length,
        sample: paths.slice(0, 5),
      });
      paths.forEach((p) => claimed.add(p));
    }
  }
  buckets.sort((a, b) => b.count - a.count);
  return { buckets, claimed };
}

// ──────────────── Slug-token backfill ────────────────

// Extend existing buckets with URLs whose SLUG mentions the category
// (e.g. /blog/photoshop-tips → Photoshop). Never creates new buckets.
//
// We deliberately do NOT scan title/h1 here: the persisted regex matches
// the URL path in production, so claiming a URL by its title only would
// inflate our local coverage stats without actually improving production
// matching. Title/h1 still inform the LLM tier where they can shape the
// generated regex.
function backfillFromSlug(records, claimed, buckets) {
  if (!buckets.length) {
    return 0;
  }
  const tokenMap = new Map();
  for (const b of buckets) {
    const tokens = b.name.toLowerCase().split(/\s+/).filter((x) => x.length >= 3);
    for (const t of tokens) {
      if (!tokenMap.has(t)) {
        tokenMap.set(t, b);
      }
    }
  }
  let added = 0;
  for (const rec of records) {
    if (!claimed.has(rec.path)) {
      const slugTokens = rec.path
        .toLowerCase()
        .split(/[/\-_]+/)
        .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
      for (const t of slugTokens) {
        const b = tokenMap.get(t);
        if (b) {
          b.count += 1;
          if (b.sample.length < 5) {
            b.sample.push(rec.path);
          }
          claimed.add(rec.path);
          added += 1;
          break;
        }
      }
    }
  }
  return added;
}

// ──────────────── Tier 2: path-frequency ────────────────

function isLocaleSeg(seg) {
  if (!seg) {
    return false;
  }
  const s = seg.toLowerCase();
  return LOCALE_SEGMENTS.has(s) || LOCALE_REGION_RE.test(s);
}

// Path segments that LOOK like years or pure numeric IDs. These show up as
// the second segment on archive-style URLs (e.g. /publish/2024/post) where
// the year doesn't help as a category. We strip them before bucketing.
function isNoiseSeg(s) {
  return /^\d+$/.test(s) // pure number
    || /^(?:19|20)\d{2}$/.test(s) // 1900-2099 year
    || /^[a-f0-9]{8,}$/i.test(s); // hash-like opaque ID
}

// Strip locale segments + page extensions; returns the "topical" segment list.
function realSegs(p) {
  let segs = pathSegs(p);
  while (segs.length && isLocaleSeg(segs[0])) {
    segs = segs.slice(1);
  }
  return segs.map((s) => s.toLowerCase().replace(PAGE_EXT_RE, '')).filter(Boolean);
}

function clusterByPathFreq(unassignedPaths) {
  if (!unassignedPaths.length) {
    return [];
  }

  // Pass 1: count by depth-1 segment.
  const byHead = new Map();
  for (const p of unassignedPaths) {
    const segs = realSegs(p);
    if (segs.length && !PAGE_TYPE_SEGMENTS.has(segs[0])) {
      const head = segs[0];
      if (!byHead.has(head)) {
        byHead.set(head, []);
      }
      byHead.get(head).push(p);
    }
  }

  const threshold = Math.max(MIN_CLUSTER, Math.ceil(unassignedPaths.length * MIN_PATH_SHARE));
  const DOMINANT_SHARE = 0.5;
  const finalBuckets = [];
  const heads = Array.from(byHead.entries()).sort((a, b) => b[1].length - a[1].length);

  for (const [head, urls] of heads) {
    if (urls.length < threshold) {
      // eslint-disable-next-line no-continue
      continue;
    }
    // Depth-2 expansion: if this one segment holds ≥50% of all sampled URLs,
    // it's too generic on its own — recurse to its depth-2 children
    // (e.g. blog.adobe.com publishes everything under /publish/<topic>/<post>).
    const dominates = urls.length / unassignedPaths.length >= DOMINANT_SHARE
      && urls.length >= 2 * threshold;
    if (dominates) {
      const childCounts = new Map();
      for (const p of urls) {
        const segs = realSegs(p);
        // Walk past noise segments (years, IDs) to find a real topical child.
        let depth = 1;
        while (depth < segs.length && isNoiseSeg(segs[depth])) {
          depth += 1;
        }
        if (depth < segs.length && !PAGE_TYPE_SEGMENTS.has(segs[depth])) {
          const child = segs[depth];
          if (!childCounts.has(child)) {
            childCounts.set(child, []);
          }
          childCounts.get(child).push(p);
        }
      }
      const childThreshold = Math.max(MIN_CLUSTER, Math.ceil(urls.length * MIN_PATH_SHARE));
      const expanded = Array.from(childCounts.entries())
        .filter(([, u]) => u.length >= childThreshold)
        .sort((a, b) => b[1].length - a[1].length);
      if (expanded.length >= 2) {
        for (const [child, u] of expanded) {
          finalBuckets.push({
            name: titleCase(child.replace(/[-_]+/g, ' ')),
            source: 'path',
            regex: `(?i)(^|/)${escapeRe(head)}/${escapeRe(child)}(/|$|\\?|#)`,
            count: u.length,
            sample: u.slice(0, 5),
          });
        }
        // eslint-disable-next-line no-continue
        continue;
      }
    }
    // Otherwise emit the depth-1 head as the bucket. Regex anchors on a slash
    // (or start-of-string) and closes on slash / end / query / fragment so it
    // matches CDN-log URLs with or without a leading slash.
    finalBuckets.push({
      name: titleCase(head.replace(/[-_]+/g, ' ')),
      source: 'path',
      regex: `(?i)(^|/)${escapeRe(head)}(/|$|\\?|#)`,
      count: urls.length,
      sample: urls.slice(0, 5),
    });
  }

  return finalBuckets
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_PATH_BUCKETS);
}

// ──────────────── Tier 3: LLM on residuals ────────────────

const LLM_SYSTEM = `You assign URLs to a handful of TOPICAL categories (what the page is ABOUT).

Do NOT produce page-type/format buckets — "Blog", "Documentation", "Homepage", "Help",
"FAQ", "Cart", "Checkout", "About", "Contact", "Legal", "Search" are handled separately.
Focus on subject matter: products, departments, audiences, industries, topics.

Each URL may include "title" and/or "h1" — use them to UNDERSTAND what the page is about,
but the regex you produce will be MATCHED AGAINST URLS from CDN logs.

CDN-log URLs are PATH-ONLY — no scheme, no host. They look like:
  women/dresses/blue-dress
  /products/photoshop.html
  blog/photoshop-tips-2024

URLs MAY OR MAY NOT have a leading slash, and they NEVER include host/domain.

CRITICAL regex rules:
1. NEVER use the start-of-string anchor (^) alone — the path may start without a slash.
2. NEVER use \b word-boundary (POSIX/Athena does not support it reliably).
3. DO anchor each keyword on a slash boundary OR start-of-string:
     (^|/)keyword(/|$|\\?|#)
   This matches the keyword as a path segment whether the URL has a leading slash or not.
4. Choose tokens that ACTUALLY appear in the example paths (slug segments after
   splitting on "/" and "-"). If the topic is only in the title and never in the
   slug, do not create a bucket for it — it cannot be matched.
5. POSIX-compatible (Athena): no lookaround, no non-capturing groups, no backrefs.

Produce 3-6 TOPIC categories. Each:
- name: Title Case, 2-3 words
- regex: (?i)... slash-anchored as above
- example: one example path from the input whose slug contains a regex token

OUTPUT JSON only: { "sections": [ { "name": "...", "regex": "(?i)...", "example": "/..." } ] }`;

async function clusterByLlm(residuals, domain, context) {
  const { log } = context;
  // Run the LLM whenever we have a meaningful residual; very small residuals
  // aren't worth a model call.
  if (residuals.length < 5) {
    return [];
  }

  const items = residuals.slice(0, 200).map((r) => ({
    path: r.path,
    title: r.signal?.title || undefined,
    h1: r.signal?.h1 || undefined,
  }));

  try {
    const resp = await prompt(
      LLM_SYSTEM,
      `Domain: ${domain}\n\nURLs:\n${JSON.stringify(items)}`,
      context,
    );
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
    log?.warn?.(`category-deriver: LLM tier failed: ${err.message}`);
    return [];
  }
}

// ──────────────── Orchestration ────────────────

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

  // Dedupe by name (highest-tier wins) and index.
  const seen = new Map();
  for (const b of [...crumb, ...path, ...llm]) {
    const k = b.name.toLowerCase();
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

  // Compile each rule's regex once. Then for each rule, verify it ACTUALLY
  // matches at least one of its own sample paths — catches both code bugs in
  // deterministic regex generation AND LLM-produced regexes that don't match
  // the example they cite. Drop self-broken rules with a warning.
  const compiled = rules.map((r) => {
    try {
      return new RegExp(r.regex.replace(/^\(\?i\)/, ''), 'i');
    } catch (err) {
      log?.warn?.(`category-deriver: invalid regex for "${r.name}": ${err.message}`);
      return null;
    }
  });
  const validRules = [];
  rules.forEach((r, i) => {
    const re = compiled[i];
    if (!re) {
      return;
    }
    const samplesMatch = (r.sample || []).every((p) => re.test(p));
    if (!samplesMatch && r.sample?.length) {
      log?.warn?.(
        `category-deriver: regex for "${r.name}" failed self-test against samples — dropping (regex=${r.regex})`,
      );
      return;
    }
    validRules.push(r);
  });

  // Coverage: also test against the path WITHOUT a leading slash to mirror
  // CDN log formats that omit it.
  const matched = allPaths.filter((p) => {
    const stripped = p.startsWith('/') ? p.slice(1) : p;
    return validRules.some((r) => {
      const re = compiled[rules.indexOf(r)];
      return re && (re.test(p) || re.test(stripped));
    });
  }).length;
  const percent = allPaths.length ? Math.round((matched / allPaths.length) * 100) : 0;

  return {
    rules: validRules,
    tiers: {
      breadcrumb: crumb.length,
      path: path.length,
      llm: llm.length,
      total: validRules.length,
    },
    coverage: { matched, total: allPaths.length, percent },
  };
}
/* c8 ignore end */
