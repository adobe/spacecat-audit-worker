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
import {
  replaceAgenticUrlClassificationRules,
  fetchReferralTopUrls,
  applyCategoryRulesToReferral,
} from '../utils/report-utils.js';
import { fetchAgenticUrlClassificationRules } from '../../common/agentic-url-classification-rules.js';

const SAMPLE_URLS_CAP = 20;
// sample_urls clamp — a bad element aborts the whole-site replace RPC batch.
const MAX_SAMPLE_URL_LENGTH = 2048;
const MAX_SAMPLE_URLS = 50;
const MAX_ALTERNATION_BRANCHES = 12;
const MAX_PATH_COVERAGE = 0.40;
// Only run the catch-all check on inputs large enough for 40% to be meaningful.
const COVERAGE_CHECK_MIN_PATHS = 50;

// (?i) is an Athena inline modifier; JS RegExp needs it stripped + the /i flag.
function compileAthenaRegex(regex) {
  return new RegExp(String(regex).replace(/^\(\?i\)/, ''), 'i');
}

// The LLM sometimes quotes alternation branches — ('discover'|'decouvrir') —
// which match nothing since paths have no quotes. Always an error, never intent.
function stripStrayQuotes(regex) {
  return typeof regex === 'string' ? regex.replace(/['"]/g, '') : regex;
}

/* c8 ignore start — guard rails against LLM garbage; tested at the prompt level */
function isValidGeneratedRegex(regex, name, log, paths = null) {
  if (typeof regex !== 'string' || regex.length === 0) {
    log?.warn?.(`patterns: dropping rule "${name}" — regex empty`);
    return false;
  }
  const altBranches = (regex.match(/\|/g) || []).length + 1;
  if (altBranches > MAX_ALTERNATION_BRANCHES) {
    log?.warn?.(`patterns: dropping rule "${name}" — ${altBranches} alternation branches > ${MAX_ALTERNATION_BRANCHES} (catch-all / locale-enumeration)`);
    return false;
  }
  let compiled;
  try {
    compiled = compileAthenaRegex(regex);
  } catch (err) {
    log?.warn?.(`patterns: dropping rule "${name}" — uncompilable regex (${err.message})`);
    return false;
  }
  if (Array.isArray(paths) && paths.length >= COVERAGE_CHECK_MIN_PATHS) {
    const matches = paths.filter((p) => typeof p === 'string' && compiled.test(p)).length;
    if (matches / paths.length > MAX_PATH_COVERAGE) {
      log?.warn?.(`patterns: dropping rule "${name}" — matches ${matches}/${paths.length} (${((matches / paths.length) * 100).toFixed(0)}%) > ${MAX_PATH_COVERAGE * 100}% (catch-all)`);
      return false;
    }
  }
  return true;
}
/* c8 ignore stop */

function samplePathsMatching(regex, paths, log, ruleName, max = SAMPLE_URLS_CAP) {
  /* c8 ignore start — caller already filters paths; second compile is defensive */
  if (!Array.isArray(paths) || paths.length === 0) {
    return [];
  }
  let compiled;
  try {
    compiled = compileAthenaRegex(regex);
  } catch (err) {
    log?.warn?.(`patterns: sample_urls compile failed for "${ruleName}" (${err.message}); persisting with []`);
    return [];
  }
  /* c8 ignore stop */
  const matches = [];
  for (const path of paths) {
    if (typeof path === 'string' && compiled.test(path)) {
      matches.push(path);
      if (matches.length >= max) {
        break;
      }
    }
  }
  return matches;
}

function buildAutoMetadata(regex, paths, log, ruleName) {
  // source / derivation_method are DB CHECKs; auto-derivation is always ai / llm.
  return {
    source: 'ai',
    derivation_method: 'llm',
    sample_urls: samplePathsMatching(regex, paths, log, ruleName),
  };
}

function sanitizeSampleUrls(sampleUrls) {
  if (!Array.isArray(sampleUrls)) {
    return [];
  }
  return sampleUrls
    .filter((url) => typeof url === 'string' && url.length <= MAX_SAMPLE_URL_LENGTH)
    .slice(0, MAX_SAMPLE_URLS);
}

function mergePatternRules(existingRules = [], generatedRegexes = {}, paths = [], log = null) {
  const regexes = generatedRegexes || {};
  const rulesByName = new Map();

  existingRules.forEach((rule) => {
    if (rule?.name && rule?.regex) {
      rulesByName.set(rule.name.toLowerCase(), {
        ...rule,
        name: rule.name.toLowerCase(),
      });
    }
  });

  Object.entries(regexes).forEach(([name, rawRegex]) => {
    const normalizedName = name.toLowerCase();
    const regex = stripStrayQuotes(rawRegex);
    /* c8 ignore next 3 — caller's reuse short-circuit prevents this collision */
    if (!normalizedName || !regex || rulesByName.has(normalizedName)) {
      return;
    }
    /* c8 ignore next 3 — defensive: validity check drops LLM garbage + catch-alls */
    if (!isValidGeneratedRegex(regex, normalizedName, log, paths)) {
      return;
    }
    rulesByName.set(normalizedName, {
      name: normalizedName,
      regex,
      ...buildAutoMetadata(regex, paths, log, normalizedName),
    });
  });

  return Array.from(rulesByName.values())
    .map((rule, index) => ({
      ...rule,
      sample_urls: sanitizeSampleUrls(rule.sample_urls),
      sort_order: index,
    }));
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

    const query = await weeklyBreakdownQueries.createTopUrlsQuery({
      periods,
      databaseName: s3Config.databaseName,
      tableName: s3Config.tableName,
      site,
    });

    const rows = await athenaClient.query(query, s3Config.databaseName, '[Athena Query] Fetch top URLs from CDN logs for pattern generation');
    // Strip query string / fragment / overlong paths before feeding to the LLM.
    const MAX_PATH_LENGTH = 256;
    const paths = (rows || [])
      .map((row) => row.url)
      .filter(Boolean)
      .map((url) => url.split('?')[0].split('#')[0])
      .filter((url) => url.length > 0 && url.length <= MAX_PATH_LENGTH);

    if (paths.length === 0) {
      log.warn('No URLs fetched from Athena for pattern generation');
      return false;
    }

    log.info(`Fetched ${paths.length} URLs for pattern generation`);

    const baseURL = site.getBaseURL();
    const domain = new URL(baseURL).hostname;

    // Independent LLM pipelines — run concurrently so the two overlap.
    const [pagetypeRegexes, productRegexes] = await Promise.all([
      existingPatterns?.pagePatterns?.length
        ? (log.info('Reusing existing page type patterns'), {})
        : analyzePageTypes(domain, paths, context),
      existingPatterns?.topicPatterns?.length
        ? (log.info('Reusing existing product patterns'), {})
        : analyzeProducts(domain, paths, context),
    ]);

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

    const productData = mergePatternRules(existingTopicPatterns, productRegexes, paths, log);
    const pagetypeData = mergePatternRules(existingPagePatterns, pagetypeRegexes, paths, log);

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

/**
 * Generates category classification rules for a site whose URL corpus lives in
 * Postgres referral tables rather than CDN Athena logs (LLMO-6257). Mirrors
 * `generatePatternsWorkbook` but sources paths from `fetchReferralTopUrls`, then
 * reuses the same product LLM analysis + merge + whole-site replace RPC, and
 * finally materializes the rules onto referral URLs via the apply RPC. Only
 * category rules are (re)generated; existing page-type rules are preserved.
 * Throws on data-service failure; the caller runs this best-effort.
 */
export async function generateReferralPatternsWorkbook({ site, context }) {
  const { log } = context;

  const paths = await fetchReferralTopUrls({ site, context });
  if (paths.length === 0) {
    log.info('No referral URLs found in DB - skipping referral pattern generation');
    return false;
  }
  log.info(`Fetched ${paths.length} referral URLs for pattern generation`);

  const existingPatterns = await fetchAgenticUrlClassificationRules(site, context);
  if (existingPatterns?.error) {
    log.info(`Skipping referral patterns for ${site.getId?.()}; DB rule fetch failed`);
    return false;
  }

  const existingTopicPatterns = Array.isArray(existingPatterns?.topicPatterns)
    ? existingPatterns.topicPatterns
    : [];
  const existingPagePatterns = Array.isArray(existingPatterns?.pagePatterns)
    ? existingPatterns.pagePatterns
    : [];

  const domain = new URL(site.getBaseURL()).hostname;

  // Reuse existing product rules when present so re-runs don't re-hit the LLM or
  // churn customer-tuned categories.
  const reusedExistingRules = existingTopicPatterns.length > 0;
  let productRegexes = {};
  if (reusedExistingRules) {
    log.info('Reusing existing product patterns for referral generation');
  } else {
    productRegexes = await analyzeProducts(domain, paths, context);
  }

  const categoryRules = mergePatternRules(existingTopicPatterns, productRegexes, paths, log);
  if (categoryRules.length === 0) {
    log.warn('No referral category rules available after merge');
    return false;
  }

  // Only (re)write rules when we generated fresh ones. On the reuse path the rules
  // are already persisted (that is why existingTopicPatterns is non-empty); calling
  // the whole-site replace RPC again would DELETE+INSERT daily, resetting
  // created_by/created_at and hard-purging customer soft-deletes. The apply RPC
  // reads rules straight from the table, so it does not depend on replace running.
  if (!reusedExistingRules) {
    await replaceAgenticUrlClassificationRules({
      site,
      context,
      categoryRules,
      pageTypeRules: existingPagePatterns,
      updatedBy: 'audit-worker:referral-patterns',
    });
  }

  const applyResult = await applyCategoryRulesToReferral({
    site,
    context,
    updatedBy: 'audit-worker:referral-patterns',
  });

  log.info(`Synced referral category rules for site ${site.getId()}: ${categoryRules.length} rules, ${applyResult?.classified ?? 0} classifications`);

  return true;
}
