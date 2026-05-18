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

const COMMON_PAGE_TYPES = [
  'homepage', 'product listing page', 'product detail page', 'blog',
  'about', 'help', 'contact', 'search', 'cart', 'checkout', 'legal',
];

const HOMEPAGE_REGEX = '(?i)^(/(home|index)?)?$';

const DEFAULT_PATTERNS = {
  Robots: '(?i).*/robots.txt$',
  Sitemap: '(?i).*/sitemap.*.xml$',
  'Error Pages': '(?i)(404|500|error|goodbye)',
};

const parseLenient = (s) => {
  const trimmed = s.trim();
  const stripped = trimmed.startsWith('```')
    ? trimmed.replace(/```json\n?/g, '').replace(/```\n?/g, '')
    : trimmed;
  return JSON.parse(stripped);
};

const accumulateUsage = (acc, usage) => {
  if (!usage) {
    return;
  }
  acc.prompt_tokens += usage.prompt_tokens || 0;
  acc.completion_tokens += usage.completion_tokens || 0;
  acc.total_tokens += usage.total_tokens || 0;
};

// Step 1 — classify each URL into a page type (FORMAT of the page, not topic).
async function derivePageTypesForPaths(domain, paths, context) {
  const { log } = context;
  const systemPrompt = `You classify URL paths into PAGE TYPES — the FORMAT/KIND of the page, not its topic.

FIRST: infer the site type from the domain and the URL set:
- E-commerce / retail → expect product listing page, product detail page, cart, checkout, search.
- News / blog / media → expect article, blog, section/topic page, video, gallery.
- B2B / SaaS / corporate → expect solution page, product page, customer story, pricing, docs, contact.
- Documentation / community → expect docs, tutorial, api reference, guide, forum.
- Government / NGO / education → expect program, policy, course, event, services, resources.

THEN classify accordingly. Don't force e-commerce labels on a non-e-commerce site; don't invent a "product detail page" type for a news site, etc. You may emit any page-type label that fits the site (recipe, podcast, event, course, …).

Universal rules:
- Root path ("/", "/home", "/index") → "homepage" first, before any other matching.
- If a URL doesn't fit any clear type for THIS site, use "other". Keep "other" rare.

Return JSON ONLY (no markdown, no fences):
{"paths":[{"path":"/example","pageType":"label"}, ...]}

Include every input path.`;
  const userPrompt = `Domain: ${domain}\n\nURL Paths:\n${JSON.stringify(paths, null, 2)}`;
  const fallback = () => paths.map((path) => ({ path, pageType: 'other' }));

  try {
    const resp = await prompt(systemPrompt, userPrompt, context);
    if (!resp?.content) {
      log.info('page-type-analysis: no LLM content, defaulting all paths to "other"');
      return { paths: fallback(), usage: null };
    }
    const parsed = parseLenient(resp.content);
    if (parsed?.paths && Array.isArray(parsed.paths)) {
      return { paths: parsed.paths, usage: resp.usage };
    }
    log.warn('page-type-analysis: invalid LLM response shape');
    return { paths: fallback(), usage: resp.usage };
  } catch (err) {
    log.error(`page-type-analysis: classification failed: ${err.message}`);
    return { paths: fallback(), usage: null };
  }
}

function groupPathsByPageType(pathTypeArray) {
  return pathTypeArray.reduce((acc, { path, pageType }) => {
    if (!acc[pageType]) {
      acc[pageType] = [];
    }
    acc[pageType].push(path);
    return acc;
  }, {});
}

// Step 2 — produce one POSIX regex per discovered page type.
async function deriveRegexesForPageTypes(domain, groupedPaths, context) {
  const { log } = context;
  const systemPrompt = `Generate one POSIX regex per page type that matches its URLs (and similar future URLs) in CDN logs.

CDN-log URLs are plain paths; leading slash is optional. Regex rules:
- Start with (?i) for case-insensitive matching.
- Keyword-based; pick tokens that actually appear in the example URLs (not the label).
- No lookaround, no non-capturing groups (Athena POSIX).
- Don't anchor on slash position for keywords — the keyword can appear anywhere in the path.
- EXCEPTION: homepage is anchored, e.g. (?i)^(/(home|index)?)?$ — root paths only.

Return JSON ONLY, no markdown:
{"page-type-name": "(?i)keyword-regex", ...}`;
  const userPrompt = `Domain: ${domain}\n\nPage types with example URLs:\n${JSON.stringify(groupedPaths, null, 2)}`;

  const fallback = () => Object.keys(groupedPaths).reduce((acc, type) => {
    const slug = type.toLowerCase().replace(/[^a-z0-9]/g, '-');
    acc[type] = `(?i)(${slug})`;
    return acc;
  }, {});

  try {
    const resp = await prompt(systemPrompt, userPrompt, context);
    if (!resp?.content) {
      log.warn('page-type-analysis: no regex content from LLM; using fallback');
      return { regexes: fallback(), usage: null };
    }
    const parsed = parseLenient(resp.content);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      return { regexes: parsed, usage: resp.usage };
    }
    log.warn('page-type-analysis: empty regex response; using fallback');
    return { regexes: fallback(), usage: resp.usage };
  } catch (err) {
    log.error(`page-type-analysis: regex generation failed: ${err.message}`);
    return { regexes: fallback(), usage: null };
  }
}

function withoutNoise(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== 'other' && k !== 'unknown'));
}

function orderRegexes(regexes) {
  const ordered = {};
  COMMON_PAGE_TYPES.forEach((pt) => {
    if (regexes[pt]) {
      ordered[pt] = regexes[pt];
    }
  });
  Object.keys(regexes)
    .filter((pt) => !COMMON_PAGE_TYPES.includes(pt))
    .sort()
    .forEach((pt) => {
      ordered[pt] = regexes[pt];
    });
  return ordered;
}

export async function analyzePageTypes(domain, paths, context) {
  const { log } = context;
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  log.info(`page-type-analysis: domain=${domain}, urls=${paths.length}`);

  try {
    const classified = await derivePageTypesForPaths(domain, paths, context);
    accumulateUsage(usage, classified.usage);

    const grouped = withoutNoise(groupPathsByPageType(classified.paths));
    const regexResult = await deriveRegexesForPageTypes(domain, grouped, context);
    accumulateUsage(usage, regexResult.usage);

    const ordered = orderRegexes(withoutNoise(regexResult.regexes));
    if (!ordered.homepage) {
      ordered.homepage = HOMEPAGE_REGEX;
      log.info('page-type-analysis: added default homepage pattern');
    }

    log.info(`page-type-analysis: tokens=${JSON.stringify(usage)}`);
    return { ...ordered, ...DEFAULT_PATTERNS };
  } catch (err) {
    log.error(`page-type-analysis failed: ${err.message}`);
    throw err;
  }
}
/* c8 ignore end */
