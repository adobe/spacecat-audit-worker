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
import { analyzeProducts } from './product-analysis.js';
import { analyzePageTypes } from './page-type-analysis.js';
import { weeklyBreakdownQueries } from '../utils/query-builder.js';
import { replaceAgenticUrlClassificationRules } from '../utils/report-utils.js';
import { fetchSitemapSample, collectUrlSignals } from './url-signals.js';
import { deriveCategories } from './category-deriver.js';

const MIN_SITEMAP_URLS = 50;

function mergePatternRules(existingRules = [], generatedRegexes = {}) {
  const regexes = generatedRegexes || {};
  const rulesByName = new Map();

  existingRules.forEach((rule) => {
    if (rule?.name && rule?.regex) {
      rulesByName.set(rule.name.toLowerCase(), {
        name: rule.name.toLowerCase(),
        regex: rule.regex,
      });
    }
  });

  Object.entries(regexes).forEach(([name, regex]) => {
    const normalizedName = name.toLowerCase();
    if (normalizedName && regex && !rulesByName.has(normalizedName)) {
      rulesByName.set(normalizedName, {
        name: normalizedName,
        regex,
      });
    }
  });

  // Re-index after merging so persisted rules have sequential first-match order.
  return Array.from(rulesByName.values())
    .map((rule, index) => ({
      ...rule,
      sort_order: index,
    }));
}

/**
 * Convert the rule-array output of deriveCategories / derivePageTypeRules into
 * the {name -> regex} shape that mergePatternRules expects.
 */
function rulesArrayToRegexMap(rules = []) {
  return rules.reduce((acc, rule) => {
    if (rule?.name && rule?.regex) {
      acc[rule.name] = rule.regex;
    }
    return acc;
  }, {});
}

/**
 * Sitemap-first pattern generation:
 *   1. Sample URLs from the sitemap (fallback to robots.txt + common locations).
 *   2. Acquire per-URL signals (breadcrumb / schema @type / title) from S3
 *      scrape.json when available, else by direct HTML fetch.
 *   3. Derive category rules in tiers — breadcrumb → path-frequency → LLM
 *      (cheapest reliable signal wins per URL).
 *   4. Derive page-type rules from schema.org @type, falling back to URL
 *      keyword heuristics.
 *
 * Returns null when the sitemap is unavailable or too thin — in that case
 * the caller should fall through to the CDN-log Athena flow.
 */
async function generateRulesFromSitemap({ site, context }) {
  const { log } = context;
  const baseUrl = site.getBaseURL?.();
  if (!baseUrl) {
    return null;
  }

  const sample = await fetchSitemapSample(baseUrl, log);
  if (!sample || sample.urls.length < MIN_SITEMAP_URLS) {
    log.info(`Sitemap source returned ${sample?.urls?.length || 0} URLs (< ${MIN_SITEMAP_URLS}); falling back to CDN logs`);
    return null;
  }

  const { records } = await collectUrlSignals(sample.urls, { site, context });
  const withSignal = records.filter((r) => r.signal).length;
  log.info(`Sitemap clustering: ${withSignal}/${records.length} URLs enriched with breadcrumb/schema/title signals`);

  const domain = new URL(baseUrl).hostname;
  const categoryResult = await deriveCategories(records, domain, context);

  // Page-type derivation reuses the existing LLM-driven analyzePageTypes —
  // it can DISCOVER site-specific page types (Gallery, Education, Recipe,
  // Sweepstakes, etc.) instead of being limited to a fixed keyword map.
  // We pass it the same broader sitemap-derived path sample so it has more
  // surface area to work with than the CDN top-URL flow.
  const sitemapPaths = records.map((r) => r.path);
  const pageTypeRegexes = await analyzePageTypes(domain, sitemapPaths, context);

  log.info(
    `Sitemap clustering result: ${categoryResult.tiers.total} categories `
    + `(breadcrumb=${categoryResult.tiers.breadcrumb}, path=${categoryResult.tiers.path}, llm=${categoryResult.tiers.llm}) `
    + `— coverage ${categoryResult.coverage.percent}% (${categoryResult.coverage.matched}/${categoryResult.coverage.total})`,
  );
  log.info(`Sitemap page-type result: ${Object.keys(pageTypeRegexes || {}).length} rules`);

  return {
    categoryRegexes: rulesArrayToRegexMap(categoryResult.rules),
    pageTypeRegexes: pageTypeRegexes || {},
    source: 'sitemap',
  };
}

export async function generatePatternsWorkbook(options) {
  const {
    site,
    context,
    athenaClient,
    s3Config,
    periods,
    existingPatterns = null,
  } = options;
  const { log } = context;

  try {
    log.info(existingPatterns ? 'Generating DB patterns with merge of existing rules...' : 'No DB patterns found, generating fresh rules...');

    // === Phase A: sitemap-first clustering (preferred) ===
    let sitemapDerived = null;
    try {
      sitemapDerived = await generateRulesFromSitemap({ site, context });
    } catch (err) {
      log.warn(`Sitemap-based pattern generation failed, falling back to CDN logs: ${err.message}`);
    }

    if (sitemapDerived) {
      const existingTopicPatterns = Array.isArray(existingPatterns?.topicPatterns)
        ? existingPatterns.topicPatterns
        : [];
      const existingPagePatterns = Array.isArray(existingPatterns?.pagePatterns)
        ? existingPatterns.pagePatterns
        : [];

      const productData = mergePatternRules(existingTopicPatterns, sitemapDerived.categoryRegexes);
      const pagetypeData = mergePatternRules(existingPagePatterns, sitemapDerived.pageTypeRegexes);

      if (productData.length === 0 && pagetypeData.length === 0) {
        log.warn('Sitemap clustering produced no rules, falling back to CDN logs');
      } else {
        const result = await replaceAgenticUrlClassificationRules({
          site,
          context,
          categoryRules: productData,
          pageTypeRules: pagetypeData,
          updatedBy: 'audit-worker:agentic-patterns:sitemap',
        });
        log.info(`Successfully synced sitemap-derived patterns to DB for site ${site.getId?.()}: ${result?.category_rules ?? productData.length} category rules, ${result?.page_type_rules ?? pagetypeData.length} page type rules`);
        return true;
      }
    }

    // === Phase B: legacy CDN-top-URLs flow (fallback) ===

    const query = await weeklyBreakdownQueries.createTopUrlsQuery({
      periods,
      databaseName: s3Config.databaseName,
      tableName: s3Config.tableName,
      site,
    });

    const rows = await athenaClient.query(query, s3Config.databaseName, '[Athena Query] Fetch top URLs from CDN logs for pattern generation');
    const paths = rows?.map((row) => row.url).filter(Boolean) || [];

    if (paths.length === 0) {
      log.warn('No URLs fetched from Athena for pattern generation');
      return false;
    }

    log.info(`Fetched ${paths.length} URLs for pattern generation`);

    // Extract domain from site
    const baseURL = site.getBaseURL();
    const domain = new URL(baseURL).hostname;

    // Skip page type analysis if patterns already exist
    const pagetypeRegexes = existingPatterns?.pagePatterns?.length
      ? (log.info('Reusing existing page type patterns'), {})
      : await analyzePageTypes(domain, paths, context);

    // Run product analysis only when no existing topic patterns exist.
    // Previously this also kicked in for "new categories" appearing in the
    // customer's LLMO config; that coupling has been removed in LLMO-4748 so
    // category derivation now depends purely on the site's own URL structure.
    let productRegexes;
    if (!existingPatterns?.topicPatterns?.length) {
      productRegexes = await analyzeProducts(domain, paths, context);
    } else {
      log.info('Reusing existing product patterns');
      productRegexes = {};
    }

    const existingTopicPatterns = Array.isArray(existingPatterns?.topicPatterns)
      ? existingPatterns.topicPatterns
      : [];
    const existingPagePatterns = Array.isArray(existingPatterns?.pagePatterns)
      ? existingPatterns.pagePatterns
      : [];

    if (existingPatterns) {
      log.info('Merging with existing DB patterns...');
      log.info(`Preserved ${existingTopicPatterns.length} existing product patterns`);
      log.info(`Preserved ${existingPagePatterns.length} existing page type patterns`);
    }

    // Prepare data for DB with unique lowercase names.
    // Note (LLMO-4748): the previous post-filter that culled product patterns
    // to the customer's LLMO config has been removed — categories are now
    // surfaced as-derived. Customer-facing overrides will land in a follow-up
    // PR (merge RPC + sample-URL-driven edit API).
    const productData = mergePatternRules(existingTopicPatterns, productRegexes);

    const pagetypeData = mergePatternRules(existingPagePatterns, pagetypeRegexes);

    // Return early if both arrays are empty
    if (productData.length === 0 && pagetypeData.length === 0) {
      log.warn('No pattern data available to generate report');
      return false;
    }

    const result = await replaceAgenticUrlClassificationRules({
      site,
      context,
      categoryRules: productData,
      pageTypeRules: pagetypeData,
      updatedBy: 'audit-worker:agentic-patterns',
    });

    log.info(`Successfully synced patterns to DB for site ${site.getId?.()}: ${result?.category_rules ?? productData.length} category rules, ${result?.page_type_rules ?? pagetypeData.length} page type rules`);

    return true;
  } catch (error) {
    log.error(`Failed to generate patterns: ${error.message}`);
    return false;
  }
}
