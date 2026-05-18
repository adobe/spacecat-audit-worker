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

const MAX_CATEGORIES = 6;

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

// Step 1: classify each URL path into a topical product label discovered by
// the model. Falls back to "unknown" for paths it can't place.
async function deriveProductsForPaths(domain, paths, context) {
  const { log } = context;
  const systemPrompt = `You classify URL paths into TOPICAL product / section labels (what the page is about), for analytics roll-ups.

Pick a label per URL:
- lowercase, hyphenated, singular (e.g. "marketing-automation", not "Marketing_Automation")
- product- or section-focused (e.g. "analytics", not "analytics-page")
- consistent across paths (same product/section → same label)
- use "unknown" for generic content (blog, support, about, legal, careers, contact, press, investors)

Return JSON ONLY in this exact shape (no markdown, no fences, no commentary):
{"paths":[{"path":"/example","product":"label"}, ...]}

Include every input path.`;
  const userPrompt = `Domain: ${domain}\n\nURL Paths:\n${JSON.stringify(paths, null, 2)}`;
  const fallback = () => paths.map((path) => ({ path, product: 'unknown' }));

  try {
    const resp = await prompt(systemPrompt, userPrompt, context);
    if (!resp?.content) {
      log.info('product-analysis: no LLM content, defaulting to unknown');
      return { paths: fallback(), usage: null };
    }
    const parsed = parseLenient(resp.content);
    if (parsed?.paths && Array.isArray(parsed.paths)) {
      return { paths: parsed.paths, usage: resp.usage };
    }
    log.warn('product-analysis: invalid LLM response shape; defaulting to unknown');
    return { paths: fallback(), usage: resp.usage };
  } catch (err) {
    log.error(`product-analysis: classification failed: ${err.message}`);
    return { paths: fallback(), usage: null };
  }
}

// Step 2: collapse the discovered product labels down to at most
// MAX_CATEGORIES umbrella categories.
async function concentrateProducts(pathProductArray, context) {
  const { log } = context;
  if (!pathProductArray?.length) {
    return { paths: [], usage: null };
  }
  const uniqueProducts = [...new Set(pathProductArray.map((p) => p.product))];
  if (uniqueProducts.length <= 1) {
    return { paths: pathProductArray, usage: null };
  }

  const systemPrompt = `You collapse fine-grained product labels into AT MOST ${MAX_CATEGORIES} broad umbrella categories.

Rules:
- Merge versions and variants under the umbrella ("product-v3", "product-pro", "product-2024" → "product").
- Group activity-aligned items together when sensible.
- Keep "unknown" as a standalone bucket if present.
- Result MUST have ≤ ${MAX_CATEGORIES} distinct categories (ignoring "unknown"). If you exceed, group more aggressively.

Return JSON ONLY mapping original label → umbrella label, no markdown:
{"product-a-v2": "product-a", ...}`;
  const userPrompt = `Products to concentrate:\n${JSON.stringify(uniqueProducts)}`;

  try {
    const resp = await prompt(systemPrompt, userPrompt, context);
    if (!resp?.content) {
      return { paths: pathProductArray, usage: null };
    }
    const mapping = parseLenient(resp.content);
    const out = pathProductArray.map(({ path, product }) => ({
      path,
      product: mapping[product] || product,
    }));
    return { paths: out, usage: resp.usage };
  } catch (err) {
    log.error(`product-analysis: concentration failed: ${err.message}`);
    return { paths: pathProductArray, usage: null };
  }
}

function groupPathsByProduct(pathProductArray) {
  return pathProductArray.reduce((acc, { path, product }) => {
    if (!acc[product]) {
      acc[product] = [];
    }
    acc[product].push(path);
    return acc;
  }, {});
}

// Step 3: per umbrella category, generate a simple Athena-compatible regex
// from the URLs that landed in it. Falls back to a keyword-from-name regex.
async function deriveRegexesForProducts(domain, groupedPaths, context) {
  const { log } = context;
  const systemPrompt = `Generate one POSIX regex per category that matches its URLs (and similar future URLs) in CDN logs.

CDN-log URLs are plain paths; leading slash is optional. Regex rules:
- Start with (?i) for case-insensitive matching.
- Keyword-based; pick tokens that actually appear in the example URLs (not the category label).
- No lookaround, no non-capturing groups (Athena POSIX).
- Don't anchor on slash position — accept the keyword wherever it shows up in the path.

Return JSON ONLY, no markdown:
{"category-name": "(?i)keyword-regex", ...}`;
  const userPrompt = `Domain: ${domain}\n\nCategories with example URLs:\n${JSON.stringify(groupedPaths, null, 2)}`;

  const fallback = () => Object.keys(groupedPaths).reduce((acc, name) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    acc[name] = `(?i)${slug}`;
    return acc;
  }, {});

  try {
    const resp = await prompt(systemPrompt, userPrompt, context);
    if (!resp?.content) {
      log.warn('product-analysis: no regex content from LLM; using fallback');
      return { patterns: fallback(), usage: null };
    }
    const parsed = parseLenient(resp.content);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      return { patterns: parsed, usage: resp.usage };
    }
    log.warn('product-analysis: empty regex response; using fallback');
    return { patterns: fallback(), usage: resp.usage };
  } catch (err) {
    log.error(`product-analysis: regex generation failed: ${err.message}`);
    return { patterns: fallback(), usage: null };
  }
}

export async function analyzeProducts(domain, paths, context) {
  const { log } = context;
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  log.info(`product-analysis: domain=${domain}, urls=${paths.length}`);

  try {
    const classified = await deriveProductsForPaths(domain, paths, context);
    accumulateUsage(usage, classified.usage);

    const concentrated = await concentrateProducts(classified.paths, context);
    accumulateUsage(usage, concentrated.usage);

    const groupedPaths = groupPathsByProduct(concentrated.paths);
    const regexes = await deriveRegexesForProducts(domain, groupedPaths, context);
    accumulateUsage(usage, regexes.usage);

    const { patterns } = regexes;
    delete patterns.unknown;
    delete patterns.unclassified;
    delete patterns.other;

    const finalCategories = Object.keys(patterns);
    log.info(`product-analysis: ${finalCategories.length} categories — ${finalCategories.join(', ')}`);
    log.info(`product-analysis: tokens=${JSON.stringify(usage)}`);
    return patterns;
  } catch (err) {
    log.error(`product-analysis failed: ${err.message}`);
    if (usage.total_tokens > 0) {
      log.info(`product-analysis: tokens (pre-error)=${JSON.stringify(usage)}`);
    }
    throw err;
  }
}
/* c8 ignore end */
