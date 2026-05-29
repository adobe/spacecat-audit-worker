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

export async function generatePatternsWorkbook(options) {
  const {
    site,
    context,
    athenaClient,
    s3Config,
    periods,
    configCategories = [],
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

    // Filter new categories and skip product analysis if all exist
    const existingCategories = existingPatterns?.topicPatterns?.map(
      (p) => p.name.toLowerCase(),
    ) || [];
    const newCategories = configCategories.filter(
      (cat) => !existingCategories.includes(cat.toLowerCase()),
    );
    const categoriesToAnalyze = newCategories.length ? newCategories : configCategories;

    let productRegexes;
    if (!existingPatterns?.topicPatterns?.length || newCategories.length) {
      if (newCategories.length) {
        log.info(`Analyzing ${newCategories.length} new categories`);
      }
      productRegexes = await analyzeProducts(domain, paths, context, categoriesToAnalyze);
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
    let productData = mergePatternRules(existingTopicPatterns, productRegexes);

    // Filter product data based on config categories if they exist
    if (configCategories.length > 0) {
      const configCategoriesLower = configCategories.map((cat) => cat.toLowerCase());
      const productCountBeforeFilter = productData.length;
      productData = productData.filter((item) => configCategoriesLower.includes(item.name));
      productData = productData.map((item, index) => ({
        ...item,
        sort_order: index,
      }));
      log.info(`Filtered product patterns to match config categories. Kept ${productData.length} patterns out of ${productCountBeforeFilter}`);
    }

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
