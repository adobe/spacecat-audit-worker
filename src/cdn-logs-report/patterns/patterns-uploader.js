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

// Merge existing DB rules with newly-generated regexes, preserving existing
// names (first-match wins) and re-indexing sort_order sequentially.
function mergePatternRules(existingRules = [], generatedRegexes = {}) {
  const byName = new Map();

  existingRules.forEach((rule) => {
    if (rule?.name && rule?.regex) {
      const name = rule.name.toLowerCase();
      byName.set(name, { name, regex: rule.regex });
    }
  });

  Object.entries(generatedRegexes || {}).forEach(([rawName, regex]) => {
    const name = rawName.toLowerCase();
    if (name && regex && !byName.has(name)) {
      byName.set(name, { name, regex });
    }
  });

  return Array.from(byName.values()).map((rule, index) => ({ ...rule, sort_order: index }));
}

function rulesArrayToRegexMap(rules = []) {
  return rules.reduce((acc, rule) => {
    if (rule?.name && rule?.regex) {
      acc[rule.name] = rule.regex;
    }
    return acc;
  }, {});
}

// Phase A — sitemap-first derivation. Returns null when no usable sitemap so
// the caller can fall through to the legacy Athena top-URL flow.
async function generateRulesFromSitemap({ site, context }) {
  const { log } = context;
  const baseUrl = site.getBaseURL?.();
  if (!baseUrl) {
    return null;
  }

  const sample = await fetchSitemapSample(baseUrl, log);
  if (!sample || sample.urls.length < MIN_SITEMAP_URLS) {
    log.info(`patterns: sitemap returned ${sample?.urls?.length || 0} URLs (< ${MIN_SITEMAP_URLS}); falling back to CDN logs`);
    return null;
  }

  const { records } = await collectUrlSignals(sample.urls, { site, context });
  const withSignal = records.filter((r) => r.signal).length;
  log.info(`patterns: ${withSignal}/${records.length} URLs enriched with breadcrumb/schema/title signals`);

  const domain = new URL(baseUrl).hostname;
  const categoryResult = await deriveCategories(records, domain, context);
  const pageTypeRegexes = await analyzePageTypes(domain, records.map((r) => r.path), context);

  log.info(
    `patterns: derived ${categoryResult.tiers.total} categories `
    + `(breadcrumb=${categoryResult.tiers.breadcrumb}, path=${categoryResult.tiers.path}, llm=${categoryResult.tiers.llm}) `
    + `— coverage ${categoryResult.coverage.percent}%`,
  );

  return {
    categoryRegexes: rulesArrayToRegexMap(categoryResult.rules),
    pageTypeRegexes: pageTypeRegexes || {},
  };
}

async function persistRules(site, context, productData, pagetypeData, source) {
  const result = await replaceAgenticUrlClassificationRules({
    site,
    context,
    categoryRules: productData,
    pageTypeRules: pagetypeData,
    updatedBy: `audit-worker:agentic-patterns:${source}`,
  });
  context.log.info(
    `patterns: synced ${result?.category_rules ?? productData.length} category rules, `
    + `${result?.page_type_rules ?? pagetypeData.length} page type rules (source=${source})`,
  );
}

// Phase B — legacy Athena top-URLs flow. Used when sitemap is unavailable.
async function generateRulesFromCdnLogs(options) {
  const {
    site, context, athenaClient, s3Config, periods, existingPatterns,
  } = options;
  const { log } = context;

  const query = await weeklyBreakdownQueries.createTopUrlsQuery({
    periods,
    databaseName: s3Config.databaseName,
    tableName: s3Config.tableName,
    site,
  });
  const rows = await athenaClient.query(
    query,
    s3Config.databaseName,
    '[Athena Query] Fetch top URLs from CDN logs for pattern generation',
  );
  const paths = rows?.map((row) => row.url).filter(Boolean) || [];

  if (!paths.length) {
    log.warn('patterns: no URLs fetched from Athena');
    return null;
  }
  log.info(`patterns: fetched ${paths.length} URLs from Athena`);

  const domain = new URL(site.getBaseURL()).hostname;

  // Skip per-tier analysis when corresponding existing rules are present.
  const pagetypeRegexes = existingPatterns?.pagePatterns?.length
    ? {}
    : await analyzePageTypes(domain, paths, context);
  const productRegexes = existingPatterns?.topicPatterns?.length
    ? {}
    : await analyzeProducts(domain, paths, context);

  return { categoryRegexes: productRegexes, pageTypeRegexes: pagetypeRegexes };
}

export async function generatePatternsWorkbook(options) {
  const { site, context, existingPatterns = null } = options;
  const { log } = context;

  try {
    log.info(existingPatterns ? 'patterns: regenerating with merge of existing rules' : 'patterns: generating fresh rules');

    const existingTopics = Array.isArray(existingPatterns?.topicPatterns)
      ? existingPatterns.topicPatterns
      : [];
    const existingPages = Array.isArray(existingPatterns?.pagePatterns)
      ? existingPatterns.pagePatterns
      : [];

    // Phase A — sitemap-first.
    let derived = null;
    try {
      derived = await generateRulesFromSitemap({ site, context });
    } catch (err) {
      log.warn(`patterns: sitemap-based generation failed, falling back: ${err.message}`);
    }
    if (derived) {
      const productData = mergePatternRules(existingTopics, derived.categoryRegexes);
      const pagetypeData = mergePatternRules(existingPages, derived.pageTypeRegexes);
      if (productData.length || pagetypeData.length) {
        await persistRules(site, context, productData, pagetypeData, 'sitemap');
        return true;
      }
      log.warn('patterns: sitemap clustering produced no rules, falling back to CDN logs');
    }

    // Phase B — CDN-log Athena fallback.
    const fromLogs = await generateRulesFromCdnLogs({ ...options, existingPatterns });
    if (!fromLogs) {
      return false;
    }
    const productData = mergePatternRules(existingTopics, fromLogs.categoryRegexes);
    const pagetypeData = mergePatternRules(existingPages, fromLogs.pageTypeRegexes);
    if (!productData.length && !pagetypeData.length) {
      log.warn('patterns: no pattern data available');
      return false;
    }
    await persistRules(site, context, productData, pagetypeData, 'cdn-logs');
    return true;
  } catch (error) {
    log.error(`Failed to generate patterns: ${error.message}`);
    return false;
  }
}
