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
import { prompt } from './utils.js';

async function concentrateProducts(pathProductArray, context) {
  const { log } = context;

  if (!pathProductArray || pathProductArray.length === 0) {
    return { paths: [], usage: null };
  }

  // Extract unique product names for concentration
  const uniqueProducts = [...new Set(pathProductArray.map((item) => item.product))];

  if (uniqueProducts.length <= 1) {
    return {
      paths: pathProductArray,
      usage: null,
    }; // No need to concentrate if only one or no products
  }

  const systemPrompt = `You are an expert content categorization specialist focused on grouping products into high-level categories.

TASK: Analyze the provided product list and create a concentrated version by:
1. Grouping products into broad, high-level categories
2. Preferring general categories over specific product names
3. Creating representative category names that encompass multiple products

INSTRUCTIONS:

1. High-Level Category Grouping (PRIORITY):
   - Prefer broad categories over specific products (e.g., "tennis-racket-wilson" → "tennis", not "tennis-racket")
   - Group by activity, industry, or general purpose rather than brand or model
   - Examples: "smartphones", "sports", "clothing", "electronics", "automotive", "food", "travel"
   - Use the most general meaningful category that still provides useful distinction

2. Category Guidelines:
   - Sports products should group by sport type: "tennis", "basketball", "golf", etc.
   - Technology products should group by broad categories: "smartphones", "computers", "software"
   - Clothing/fashion should group by type: "clothing", "footwear", "accessories"
   - Food/beverage should group by specific types: "coffee", "wine", "pizza", "bakery", "dairy", "snacks"
   - Services should group by specific service type: "consulting", "support", "training", "hosting", "analytics", "marketing", "design", "development"

3. Mapping Rules:
   - Multiple specific products should map to the same high-level category
   - Category names should be lowercase and hyphenated
   - Avoid brand names and model numbers in category names
   - Focus on what the product IS rather than who makes it or specific variants

4. Data Quality Rules:
   - If input is empty or invalid, return empty object: {}
   - Ensure all original product names are included in the mapping
   - Use descriptive but broad category names
   - Keep "unknown" as standalone if present

RESPONSE FORMAT: Return only a valid JSON object mapping original names to high-level category names.

Example input products: ["tennis-racket-wilson", "tennis-balls", "basketball-shoes-nike", "iphone-14", "macbook-pro", "unknown"]

Example output:
{
  "tennis-racket-wilson": "tennis",
  "tennis-balls": "tennis",
  "basketball-shoes-nike": "basketball",
  "iphone-14": "smartphones",
  "macbook-pro": "computers",
  "unknown": "unknown"
}`;

  const userPrompt = `Analyze and concentrate the following product list:

${JSON.stringify(uniqueProducts, null, 2)}`;

  try {
    const promptResponse = await prompt(systemPrompt, userPrompt, context);
    if (promptResponse && promptResponse.content) {
      let mapping;
      try {
        mapping = JSON.parse(promptResponse.content);
      } catch (parseError) {
        log.error(`Failed to parse concentration response as JSON: ${parseError.message}`);
        return {
          paths: pathProductArray,
          usage: promptResponse.usage,
        }; // Return original if parsing fails
      }

      if (!mapping || typeof mapping !== 'object') {
        log.warn('Unexpected concentration response structure received');
        return { paths: pathProductArray, usage: promptResponse.usage };
      }

      // Apply the mapping to the original path-product array
      const concentratedArray = pathProductArray.map((item) => ({
        path: item.path,
        product: mapping[item.product] || item.product, // Use mapping or fallback to original
      }));

      const originalCount = uniqueProducts.length;
      const concentratedCount = [...new Set(concentratedArray.map((item) => item.product))].length;

      log.info(`Concentrated ${originalCount} unique products into ${concentratedCount} products`);
      return { paths: concentratedArray, usage: promptResponse.usage };
    }
  } catch (err) {
    log.error(`Failed to concentrate products: ${err.message}`);
    return { paths: pathProductArray, usage: null }; // Return original array if concentration fails
  }

  return { paths: pathProductArray, usage: null };
}

async function deriveProductsForPaths(domain, paths, context) {
  const { log } = context;
  const systemPrompt = `You are a content extraction specialist. Analyze URL paths from websites to identify the most specific content, product, or resource being referenced.

TASK: Extract the primary content identifier from each URL path.

IDENTIFICATION RULES:
1. Prioritize specific content names over generic categories
2. Look for content identifiers in path segments, not query parameters
3. Ignore navigation elements like "shop", "buy", "product", "item", "category", "blog", "news", "about"
4. Extract the most granular content reference available

CONTENT TYPES (in order of preference):
1. Specific items: "iphone-15-pro", "quarterly-report-2024", "getting-started-guide", "premium-subscription"
2. General content names: "iphone", "annual-report", "user-guide", "subscription"
3. Content codes/IDs: "SKU123", "DOC-456", "POST-789", "VIDEO-123"
4. Content categories (only if no specific content): "laptops", "reports", "tutorials", "services"
5. Use "unknown" only if no content can be identified

EXAMPLES:
- "/product/iphone-15-pro/buy" → "iphone-15-pro"
- "/blog/web-development-tips" → "web-development-tips"
- "/docs/api-reference/authentication" → "authentication"
- "/services/premium-support" → "premium-support"
- "/reports/2024/quarterly-earnings" → "quarterly-earnings"
- "/videos/tutorial-123" → "tutorial-123"
- "/about/company" → "unknown"
- "/search?q=tutorial" → "unknown" (query parameter, not path)
- "/category/electronics/phones" → "phones"

OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact structure:
{
  "paths": [
    { "path": "/original/path", "product": "extracted-content" },
    { "path": "/another/path", "product": "another-content" }
  ]
}

CRITICAL REQUIREMENTS:
- Include every input path exactly once in the "paths" array
- No additional text, explanations, or formatting
- Valid JSON syntax only
- Content names should be lowercase and hyphenated when multi-word`;

  const userPrompt = `Extract the primary content identifier from each URL path.

DOMAIN: ${domain}

PATHS:
${JSON.stringify(paths, null, 2)}`;

  try {
    log.info('Extracting products from URL paths');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);
    if (promptResponse && promptResponse.content) {
      const { paths: parsedPaths } = JSON.parse(promptResponse.content);
      log.info('Successfully extracted products from URL paths');
      return { paths: parsedPaths, usage: promptResponse.usage };
    } else {
      log.info('No content received; defaulting to unknown products');
      return { paths: paths.map((path) => ({ path, product: 'unknown' })), usage: null };
    }
  } catch (error) {
    log.error(`Failed to extract products from paths: ${error.message}`);
    return { paths: paths.map((path) => ({ path, product: 'unknown' })), usage: null };
  }
}

function groupPathsByProduct(pathProductArray) {
  return pathProductArray.reduce((acc, { path, product }) => {
    if (!acc[product]) acc[product] = [];
    acc[product].push(path);
    return acc;
  }, {});
}

async function deriveRegexesForProducts(domain, groupedPaths, context) {
  const { log } = context;

  const systemPrompt = `You are a regex pattern generation specialist for URL path analysis in Amazon Athena SQL environments.

TASK: Analyze the actual input data provided and generate simple, practical regex patterns for each product/category that will match URL paths containing references to that specific product/category.

INPUT STRUCTURE:
You will receive a map/object where:
- Each KEY is a product or category name
- Each VALUE is an array of URL paths that have been assigned to that product/category

Your goal is to analyze the ACTUAL provided URL paths for each product/category and create a regex pattern that will match each of the following in order of priority:
1. The given example paths in the input data
2. Variations in naming, formatting, and structure
3. Similar paths that would logically belong to the same product/category

AMAZON ATHENA SQL REGEX REQUIREMENTS:
- Use POSIX Extended Regular Expression (ERE) syntax only
- NO lookahead (?=) or lookbehind (?<=) assertions
- NO non-capturing groups (?:)
- Use case-insensitive matching with (?i) flag at the start
- Escape special characters: \\., \\-, \\+, \\?, \\*, \\(, \\), \\[, \\], \\{, \\}, \\^, \\$

PATTERN DESIGN PRINCIPLES:
1. Use (?i) flag for case-insensitive matching - much simpler than character classes
2. Focus on key product identifiers, not exact word boundaries
3. Use simple word matching with optional separators [._-]
4. Make patterns readable and maintainable
5. Avoid overly specific patterns that might miss variations
6. Consider common URL variations (plurals, abbreviations, alternative naming)
7. IMPORTANT: Base patterns on the ACTUAL input data provided, not generic examples

ANALYSIS METHODOLOGY:
1. Look at each product's actual URL paths in the input data
2. Identify common patterns, keywords, and path segments
3. Extract the core product identifier from the actual paths
4. Create patterns that capture variations seen in the real data
5. Make patterns flexible enough to match similar future paths

OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact structure:
{
  "product-name": "(?i)regex-pattern",
  "another-product": "(?i)another-pattern"
}

CRITICAL REQUIREMENTS:
- Generate patterns for all product/category identifiers
- Only skip entries that clearly do not relate to any product or category
- Focus on creating meaningful patterns even for broad categories
- Each regex must be a valid POSIX ERE pattern with (?i) flag
- Patterns must be based on the ACTUAL input data provided
- Patterns should match the provided paths AND similar variations
- For broad categories like "unknown", create patterns that match unclassified content paths
- No additional text, explanations, or markdown formatting
- Valid JSON syntax only`;

  const userPrompt = `Generate regex patterns for the following domain, with the products and their URL paths:

DOMAIN: ${domain}

GROUPED PATHS BY PRODUCT:
${JSON.stringify(groupedPaths)}`;

  try {
    log.info('Generating regex patterns for products');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);
    if (promptResponse && promptResponse.content) {
      const parsed = JSON.parse(promptResponse.content);
      if (parsed && typeof parsed === 'object') {
        log.info('Successfully generated regex patterns for products');
        return { patterns: parsed, usage: promptResponse.usage };
      }
      log.warn('Unexpected format received; defaulting to fallback regexes');
      return {
        patterns: Object.keys(groupedPaths).reduce((acc, product) => {
          acc[product] = '.*';
          return acc;
        }, {}),
        usage: promptResponse.usage,
      };
    } else {
      log.warn('No content received; defaulting to fallback regexes');
      return {
        patterns: Object.keys(groupedPaths).reduce((acc, product) => {
          acc[product] = '.*';
          return acc;
        }, {}),
        usage: null,
      };
    }
  } catch (error) {
    log.error(`Failed to get regexes for products: ${error.message}`);
    return {
      patterns: Object.keys(groupedPaths).reduce((acc, product) => {
        acc[product] = '.*';
        return acc;
      }, {}),
      usage: null,
    };
  }
}

export async function analyzeProducts(domain, paths, context) {
  const { log } = context;
  const totalTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  log.info(`Starting product analysis for domain: ${domain}`);

  try {
    const pathClassifications = await deriveProductsForPaths(domain, paths, context);

    // Track token usage from path classification
    if (pathClassifications.usage) {
      totalTokenUsage.prompt_tokens += pathClassifications.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += pathClassifications.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += pathClassifications.usage.total_tokens || 0;
    }

    const concentratedClassifications = await concentrateProducts(
      pathClassifications.paths,
      context,
    );

    // Track token usage from concentration step
    if (concentratedClassifications.usage) {
      totalTokenUsage.prompt_tokens += concentratedClassifications.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += concentratedClassifications.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += concentratedClassifications.usage.total_tokens || 0;
    }

    const groupedPaths = groupPathsByProduct(concentratedClassifications.paths);
    const regexPatterns = await deriveRegexesForProducts(domain, groupedPaths, context);

    // Track token usage from regex generation
    if (regexPatterns.usage) {
      totalTokenUsage.prompt_tokens += regexPatterns.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += regexPatterns.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += regexPatterns.usage.total_tokens || 0;
    }

    // Add default patterns
    const defaultPatterns = {
      Robots: '.*/robots.txt$',
      Sitemap: '.*/sitemap.*.xml$',
      'Error Pages': '404|500|error|goodbye',
    };

    // Combine generated patterns with default patterns
    const combinedPatterns = { ...regexPatterns.patterns, ...defaultPatterns };

    // Remove "unknown" key if it exists
    delete combinedPatterns.unknown;

    log.info(`Completed product analysis for domain: ${domain}`);
    log.info(`Total token usage for product analysis: ${JSON.stringify(totalTokenUsage)}`);
    return combinedPatterns;
  } catch (error) {
    log.error(`Product analysis failed: ${error.message}`);
    if (totalTokenUsage.total_tokens > 0) {
      log.info(`Total token usage before error: ${JSON.stringify(totalTokenUsage)}`);
    }
    throw error;
  }
}
/* c8 ignore end */
