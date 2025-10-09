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

  const systemPrompt = `You are an expert content categorization specialist focused on grouping products into categories; these should as a low-level as possible.

TASK: Analyze the provided product list and create a concentrated version by:
1. Grouping products into specific categories
2. Preferring product series over higher level categories
3. Fallback to high-level categories if no series can be identified
4. Creating representative category names that encompass multiple products

INSTRUCTIONS:

1. Series and Product Line Grouping (HIGHEST PRIORITY):
   - When multiple products belong to the same series or product line, group them under the series name
   - Examples: "iphone-15", "iphone-15-pro", "iphone-15-pro-max" → "iphone-15-series"
   - Examples: "galaxy-s24", "galaxy-s24-plus", "galaxy-s24-ultra" → "galaxy-s24-series"
   - Examples: "macbook-air-13", "macbook-air-15" → "macbook-air-series"
   - Use "-series" suffix for product families with multiple variants

2. High-Level Category Grouping (SECONDARY PRIORITY):
   - If no series grouping applies, prefer broad categories over specific products
   - Group by activity, industry, or general purpose rather than brand or model
   - Examples: "tennis-racket-wilson" → "tennis", "running-shoes-nike" → "running"
   - Use the most general meaningful category that still provides useful distinction
   - Do not add/create categories that are not core to the domain's offering (e.g., news category makes sense for a broadcasting domain, but not for a commercial domain)
   - If a domain has a very high number of individual products (e.g., ecommerce websites), create higher level categories rather than individual product categories

3. Series Detection Guidelines:
   - Look for common patterns: base model + variants (Pro, Plus, Max, Ultra, Mini)
   - Version numbers: v1, v2, v3 or generational naming (2023, 2024, etc.)
   - Size variants: 13-inch, 15-inch, or Small, Medium, Large
   - Performance tiers: Basic, Standard, Premium, Enterprise
   - When in doubt, group related products into series rather than individual categories

4. Category Guidelines (when no series applies):
   - Prioritize grouping brands, series or product lines
   - Sports products should group by sport type: "tennis", "basketball", "golf", etc.
   - Technology products should group by broad categories: "smartphones", "computers", "software"
   - Clothing/fashion should group by type: "clothing", "footwear", "accessories"
   - Food/beverage should group by specific types: "coffee", "wine", "pizza", "bakery", "dairy", "snacks"
   - Services should group by specific service type: "consulting", "support", "training", "hosting", "analytics", "marketing", "design", "development"

5. Mapping Rules:
   - PRIORITIZE series grouping over individual product mapping
   - Multiple specific products should map to the same series or high-level category
   - Series names should be lowercase and hyphenated with "-series" suffix
   - For non-series products, avoid brand names and model numbers in category names
   - Focus on what the product IS rather than who makes it or specific variants

4. Data Quality Rules:
   - If input is empty or invalid, return empty object: {}
   - Ensure all original product names are included in the mapping
   - Target MAXIMUM 5-6 distinct categories representing the most prominent product offerings
   - Focus on the most important products that drive business value
   - Use descriptive but appropriately broad category names
   - Keep "unknown" as standalone if present
   - Prioritize grouping less important products into broader categories to stay within the 5-6 limit

RESPONSE FORMAT: Return only a valid JSON object mapping original names to high-level category names. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only.

Example input products: ["iphone-15", "iphone-15-pro", "iphone-15-pro-max", "galaxy-s24", "galaxy-s24-plus", "macbook-air-13", "macbook-air-15", "tennis-racket-wilson", "unknown"]

Example output:
{
  "iphone-15": "iphone-15-series",
  "iphone-15-pro": "iphone-15-series",
  "iphone-15-pro-max": "iphone-15-series",
  "galaxy-s24": "galaxy-s24-series",
  "galaxy-s24-plus": "galaxy-s24-series",
  "macbook-air-13": "macbook-air-series",
  "macbook-air-15": "macbook-air-series",
  "tennis-racket-wilson": "tennis",
  "unknown": "unknown"
}`;

  const userPrompt = `Products to concentrate:
${JSON.stringify(uniqueProducts)}`;

  try {
    log.info('Concentrating products into categories');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);
    if (promptResponse && promptResponse.content) {
      const mapping = JSON.parse(promptResponse.content);
      const concentratedPaths = pathProductArray.map(({ path, product }) => ({
        path,
        product: mapping[product] || product,
      }));
      log.info('Successfully concentrated products');
      return { paths: concentratedPaths, usage: promptResponse.usage };
    } else {
      log.info('No content received; skipping concentration');
      return { paths: pathProductArray, usage: null };
    }
  } catch (error) {
    log.error(`Failed to concentrate products: ${error.message}`);
    return { paths: pathProductArray, usage: null };
  }
}

async function deriveProductsForPaths(domain, paths, context) {
  const { log } = context;
  const systemPrompt = `You are an expert product classifier for URL path analysis. Your task is to analyze URL paths and identify the product or product category they represent.

## OBJECTIVE
Classify each provided URL path to identify what product or product category it represents based on the path structure and content.

## CLASSIFICATION APPROACH

### Product Identification Strategies:
1. **Direct Product References**: Look for product names, SKUs, or identifiers in the path
2. **Category Inference**: Infer product from category or section names
3. **Path Structure Analysis**: Use path hierarchy to determine product context
4. **Domain Context**: Consider the domain's business type when classifying

### Product Naming Guidelines:
- Use lowercase, hyphenated format: "product-name"
- Be specific when possible: "iphone-15" not just "phone"
- Use singular form: "laptop" not "laptops"
- Avoid generic terms when specific products are identifiable
- For ambiguous paths, use broader category: "electronics", "clothing", "services"
- Use "unknown" only when no product can be reasonably inferred

## RESPONSE FORMAT
Return ONLY valid JSON with this exact structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:
{
  "paths": [
    { "path": "/products/iphone-15", "product": "iphone-15" },
    { "path": "/shop/laptops/macbook", "product": "macbook" },
    { "path": "/about", "product": "unknown" }
  ]
}

## CRITICAL REQUIREMENTS
- Include ALL provided paths in your response
- Return valid JSON with NO additional text or explanations
- Ensure proper JSON syntax and formatting
- Use descriptive product names when identifiable`;

  const userPrompt = `Domain: ${domain}

URL Paths:
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
Return ONLY a valid JSON object with this exact structure.Do NOT include markdown formatting, code blocks, or \`\`\`json tags.Return raw JSON only:
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

    const combinedPatterns = regexPatterns.patterns;

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
