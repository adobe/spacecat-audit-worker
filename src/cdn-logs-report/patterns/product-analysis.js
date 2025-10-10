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

async function concentrateProducts(
  pathProductArray,
  context,
  configCategories = [],
  maxCategories = 6,
) {
  const { log } = context;

  if (!pathProductArray || pathProductArray.length === 0) {
    return { paths: [], usage: null };
  }

  // Extract unique product names for concentration
  const uniqueProducts = [...new Set(pathProductArray.map((item) => item.product))];
  const configCategoryCount = configCategories.length;

  // If we have config categories and enough products, prioritize them
  if (configCategoryCount >= 3) {
    log.info('Config categories >= 3: Using config categories only, no concentration needed');
    return { paths: pathProductArray, usage: null };
  }

  if (uniqueProducts.length <= 1) {
    return {
      paths: pathProductArray,
      usage: null,
    }; // No need to concentrate if only one or no products
  }

  const hasConfigCategories = configCategories.length > 0;

  let systemPrompt = `You are an expert content categorization specialist focused on AGGRESSIVE GROUPING and SIMPLIFICATION of products into main categories.

TASK: Reduce the product list to ${maxCategories} or fewer main categories by:
1. Finding the MAIN umbrella category for each product (tennis, basketball, golf, etc.)
2. Ignoring all version numbers, model names, and sub-types
3. Grouping ALL related products under ONE main category
4. Being VERY aggressive - err on the side of grouping too much rather than too little

CRITICAL RULES BEFORE YOU START:
- Maximum ${maxCategories} final categories - if you have more, group more aggressively!
- NO version numbers in output (v1, v2, v3, v9, 2024, etc.)
- NO series names (pro-staff-series, blade-series, etc.)
- NO model variations (pro, plus, max, ultra) - just main category!

INSTRUCTIONS:

1. Umbrella Category Grouping (HIGHEST PRIORITY - ALWAYS DO THIS FIRST):
   - **CRITICAL**: Look for the MAIN umbrella category FIRST, ignore specific models/series/versions
   - If products are related to same activity/purpose → group under ONE main category
   - **DO NOT** create sub-categories with version numbers (v1, v2, v3, 2024, etc.)
   - **DO NOT** create multiple series for same category (just use main category name)
   - **DO NOT** include model names, variants, or specific product lines in final categories

2. High-Level Category Grouping (SECONDARY PRIORITY):
   - **CRITICAL RULE**: If multiple products can be grouped under ONE umbrella category, do it
   - Look for common prefixes or themes - group them together
   - Use the most general meaningful category that still provides useful distinction
   - If a domain has many products, create higher level categories rather than individual product categories

3. Aggressive Simplification Rules:
   - **Remove ALL version numbers**: product-v3 → product, product-2024 → product
   - **Remove ALL model variations**: product-pro, product-plus, product-max → all become product
   - **Remove ALL series suffixes**: Don't use "-series", just use main category name
   - **Maximum simplification**: Always choose the broadest category that makes sense

4. Mapping Rules:
   - Focus on WHAT the product is for, not the specific model
   - Group by activity/purpose or main product line
   - Aim for 4-6 final categories maximum
   - If you have more than 6 categories, you're not grouping aggressively enough!

5. Data Quality Rules:
   - If input is empty or invalid, return empty object: {}
   - Ensure all original product names are included in the mapping
   - **MANDATORY**: Result must have ${maxCategories} or fewer distinct category names
   - Count unique values in your output - if > ${maxCategories}, go back and group more aggressively
   - Focus on the most important products that drive business value
   - Use descriptive but appropriately broad category names
   - Keep "unknown" as standalone if present
   - Prioritize grouping less important products into broader categories to stay within the 5-6 limit

VALIDATION STEP: Before returning your answer, count the unique category names (not including "unknown"). If you have more than ${maxCategories}, you MUST revise and group more categories together!`;

  if (hasConfigCategories) {
    const isExactMatch = maxCategories === configCategories.length;

    systemPrompt += `

## CRITICAL: PRESERVE CONFIG CATEGORIES
The following categories are provided by the user and MUST be preserved EXACTLY as-is in your output:
${configCategories.map((cat) => `- ${cat}`).join('\n')}

RULES for config categories:
1. If a product name matches a config category EXACTLY, map it to itself (preserve it)
2. If a product is a variant of a config category (e.g., "product-x-2024" when "product-x" is config), map it to the config category
3. NEVER rename or change config categories - they are fixed and cannot be modified
4. ${isExactMatch ? 'ONLY map products that are TRULY RELEVANT to these config categories. SKIP/OMIT products that don\'t belong to any of these categories - do NOT force them into a category!' : `CREATE additional categories for products that DON'T match config categories. Target: ${maxCategories} total categories (${configCategories.length} config + ${maxCategories - configCategories.length} new)`}
5. Config categories are already optimized - treat them as immutable
6. Look for keywords, themes, or related terms to map products to config categories (e.g., "category-x-accessories", "category-x-parts" → "category-x")
7. ${isExactMatch ? 'If a product is unrelated to ANY config category, simply DON\'T include it in the output. The user only cares about these specific categories.' : 'DO NOT map unrelated products to config categories just to avoid creating new ones - create new categories when products are genuinely different!'}

Example (Config Categories: ${configCategories.length}, Target: ${maxCategories}):
Config categories: ${isExactMatch ? '["category-a", "category-b", "category-c"]' : '["product-x", "product-y"]'}
Input: ${isExactMatch ? '["category-a-item1", "category-a-item2", "category-b-item1", "category-b-accessories", "category-c-variant", "unrelated-item1", "unrelated-item2"]' : '["product-x", "product-x-2024", "product-x-pro", "product-z", "product-w", "service-m"]'}
Output: {
  ${isExactMatch ? `"category-a-item1": "category-a",        ← Maps to category-a config
  "category-a-item2": "category-a",        ← Maps to category-a config
  "category-b-item1": "category-b",        ← Maps to category-b config
  "category-b-accessories": "category-b",  ← Maps to category-b config
  "category-c-variant": "category-c"       ← Maps to category-c config
  (Note: "unrelated-item1" and "unrelated-item2" are OMITTED - not relevant to any config category)` : `"product-x": "product-x",              ← Preserve config category exactly
  "product-x-2024": "product-x",         ← Variant maps to config category
  "product-x-pro": "product-x",          ← Variant maps to config category
  "product-y": "product-y",              ← Preserve config category
  "product-z": "services",               ← Create new category for unrelated products
  "product-w": "tools",                  ← Create new category
  "service-m": "services"                ← Group with similar products`}
}`;
  }

  systemPrompt += `

RESPONSE FORMAT: Return only a valid JSON object mapping original names to high-level category names. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only.

Example input: ["product-a", "product-a-v2", "product-a-pro", "category-x", "category-x-accessories", "category-y", "category-y-shoes", "service-z", "unknown"]

Example output:
{
  "product-a": "product-a",
  "product-a-v2": "product-a",
  "product-a-pro": "product-a",
  "category-x": "category-x",
  "category-x-accessories": "category-x",
  "category-y": "category-y",
  "category-y-shoes": "category-y",
  "service-z": "service-z",
  "unknown": "unknown"
}

CRITICAL: Group related products under ONE main category. Remove version numbers and model variations!`;

  const userPrompt = `Products to concentrate:
${JSON.stringify(uniqueProducts)}
${hasConfigCategories ? `\n\nCONFIG CATEGORIES (must preserve exactly):\n${JSON.stringify(configCategories)}` : ''}`;

  try {
    log.info('Concentrating products into categories');
    if (hasConfigCategories) {
      log.info(`Config categories to preserve: ${configCategories.join(', ')}`);
    }
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

async function deriveProductsForPaths(domain, paths, context, configCategories = []) {
  const { log } = context;
  const hasConfigCategories = configCategories.length > 0;

  let systemPrompt = `You are an expert product classifier for URL path analysis. Your task is to analyze URL paths and identify BUSINESS PRODUCTS/SERVICES categories for Athena SQL analytics.

## OBJECTIVE
Classify each URL path to identify BUSINESS PRODUCTS/SERVICES categories that are useful for business analytics and reporting.

## ANALYTICAL THINKING PROCESS

Think like you're analyzing a spreadsheet of URLs - follow these steps systematically:

### STEP 1: DOMAIN UNDERSTANDING
- What industry is this domain in? (Tech, retail, healthcare, finance, media, etc.)
- What do they likely sell/offer? (Products, services, content, solutions)
- What business model? (SaaS, e-commerce, publishing, consulting)

### STEP 2: URL STRUCTURE ANALYSIS
For each URL path, examine:
- **Path segments**: Break down /segment1/segment2/segment3
- **Hierarchy clues**: First segment often indicates section type (/products/, /solutions/, /services/)
- **Business indicators**: Keywords that signal commercial offerings vs. informational content
- **Naming patterns**: How does this domain structure their URLs?

### STEP 3: PRODUCT/SERVICE IDENTIFICATION
Ask yourself for each path:
1. "Does this represent something the company sells or provides?" → Product/Service
2. "Is this generic content (blog, about, careers, legal)?" → Unknown
3. "What specific offering does this relate to?" → Extract the product name
4. "What's the most specific identifier?" → Use the lowest-level meaningful category

### STEP 4: CATEGORY EXTRACTION LOGIC
Examples of thinking process:

Example A: "/products/analytics-platform/features"
- Thinking: "products" → business offering, "analytics-platform" → specific product, "features" → content type
- Result: product = "analytics-platform"

Example B: "/solutions/cloud/pricing"
- Thinking: "solutions" → business offering, "cloud" → product category, "pricing" → content type
- Result: product = "cloud"

Example C: "/blog/design-tips"
- Thinking: "blog" → generic content, not a business offering
- Result: product = "unknown"

Example D: "/enterprise/marketing-automation/integrations"
- Thinking: "enterprise" → customer segment, "marketing-automation" → specific product
- Result: product = "marketing-automation"

### STEP 5: NAMING STANDARDIZATION & OUTPUT RULES
- **Format**: Lowercase, hyphenated (e.g., "marketing-automation" not "Marketing_Automation")
- **Singular form**: "solution" not "solutions", "software" not "softwares"
- **Product-focused**: "analytics" not "analytics-page" or "analytics-features"
- **Consistency**: Same product = same name across all paths
- **Business focus**: Only classify business offerings (products/services/solutions)
- **Exclusions**: Use "unknown" for generic content (blog, support, about, legal, careers, contact, press, investors)
- **Domain-agnostic**: Work for any industry (tech, retail, healthcare, finance, etc.)`;

  if (hasConfigCategories) {
    systemPrompt += `

## PRIORITY CATEGORIES
The following categories are provided by the user and should be PRIORITIZED when classifying paths:
${configCategories.map((cat) => `- ${cat}`).join('\n')}

When a URL path could match one of these categories, prefer these over generic classifications.
If none of these categories fit, then use your standard classification approach.`;
  }

  systemPrompt += `

## RESPONSE FORMAT
Return ONLY valid JSON with this exact structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:

{
  "paths": [
    { "path": "/products/software", "product": "software" },
    { "path": "/solutions/analytics", "product": "analytics" },
    { "path": "/about", "product": "unknown" }
  ]
}

## CRITICAL REQUIREMENTS
- Include ALL provided paths in your response
- Return valid JSON with NO additional text or explanations
- ONLY return the JSON object, nothing else`;

  const userPrompt = `Domain: ${domain}
${hasConfigCategories ? `\nPriority Categories: ${JSON.stringify(configCategories)}` : ''}

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

## ANALYTICAL THINKING PROCESS

For each product/category, follow this systematic analysis (think like you're analyzing URLs in Excel):

### STEP 1: STRUCTURAL PATTERN RECOGNITION
- Examine the URL structure: What sections appear? (/products/, /solutions/, /docs/)
- Identify fixed vs. variable parts: What stays constant? What changes?
- Detect hierarchy levels: Is there a consistent depth? (/level1/level2/level3)
- Look for versioning patterns: Are there dates, versions, or generations? (2024, v2, pro, enterprise)

### STEP 2: COMMONALITY EXTRACTION
- Find the core identifier: What keyword consistently appears across all paths?
- Identify separators: Do paths use hyphens, underscores, slashes, or mixed? (-_, /)
- Detect variants: Are there plurals, abbreviations, or alternative spellings? (photo/photos, ai/artificial-intelligence)
- Recognize suffixes/prefixes: Any consistent additions? (mobile-, -app, -pro, -enterprise)

### STEP 3: VARIATION MAPPING
Examples of what to look for:
- Path position: Does the identifier appear in different URL segments?
- Case variations: PhotoShop vs photoshop vs PHOTOSHOP
- Separators: photoshop-cc vs photoshop_cc vs photoshop/cc
- Compound forms: photoshop, photoshop-2024, photoshop-pro, adobe-photoshop
- Pluralization: product vs products, service vs services

### STEP 4: REGEX CONSTRUCTION LOGIC
Based on your analysis:
1. Start with the core identifier (the consistent keyword)
2. Add optional separators: [._-]? or [/_-] depending on what you observed
3. Add optional version/variant patterns: ([._-]?(2024|2025|pro|enterprise))?
4. Consider path boundaries: Should it match anywhere in URL or specific positions?
5. Balance specificity vs flexibility: Too narrow = miss valid URLs; too broad = false positives

### STEP 5: VALIDATION THINKING
Ask yourself:
- "Will this match ALL the example paths provided?" (Must match 100%)
- "Will this match reasonable variations?" (Version updates, new releases)
- "Could this create false positives?" (photoshop matching photography)
- "Is this maintainable?" (Simple enough to understand and update)

## AMAZON ATHENA SQL REGEX REQUIREMENTS
- Use POSIX Extended Regular Expression (ERE) syntax only
- NO lookahead (?=) or lookbehind (?<=) assertions
- NO non-capturing groups (?:)
- Use case-insensitive matching with (?i) flag at the start
- Escape special characters: \\., \\-, \\+, \\?, \\*, \\(, \\), \\[, \\], \\{, \\}, \\^, \\$

## PATTERN EXAMPLES (To guide your thinking)

Example 1 - Simple product:
Paths: ["/products/photoshop", "/docs/photoshop", "/photoshop-features"]
Thinking: Core = "photoshop", appears in various positions, no complex variants
Regex: (?i)photoshop

Example 2 - Versioned product:
Paths: ["/products/iphone-15", "/iphone-15-pro", "/store/iphone-15-pro-max"]
Thinking: Core = "iphone-15", has variants (pro, max), uses hyphens
Regex: (?i)iphone[._-]?15([._-]?(pro|max))*

Example 3 - Category with variations:
Paths: ["/sports/tennis", "/tennis-equipment", "/products/tennis-rackets"]
Thinking: Core = "tennis", appears with related terms, different positions
Regex: (?i)tennis

Example 4 - Broad category:
Paths: ["/solutions/analytics", "/products/analytics-platform", "/analytics-tools"]
Thinking: Core = "analytics", consistent keyword, various contexts
Regex: (?i)analytics

## OUTPUT FORMAT
Return ONLY a valid JSON object with this exact structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:
{
  "product-name": "(?i)regex-pattern",
  "another-product": "(?i)another-pattern"
}

## CRITICAL REQUIREMENTS
- Base patterns on the ACTUAL input data provided (not the examples above)
- Generate patterns for all product/category identifiers
- Each regex must be a valid POSIX ERE pattern with (?i) flag
- No additional text, explanations, or markdown formatting - return valid JSON only`;

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

export async function analyzeProducts(domain, paths, context, configCategories = []) {
  const { log } = context;
  const totalTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  log.info(`Starting product analysis for domain: ${domain}`);
  const configCategoryCount = configCategories.length;

  if (configCategoryCount > 0) {
    log.info(`Using ${configCategoryCount} config categories with priority`);
  }

  try {
    // Step 1: Classify paths with config category priority
    const pathClassifications = await deriveProductsForPaths(
      domain,
      paths,
      context,
      configCategories,
    );

    // Track token usage from path classification
    if (pathClassifications.usage) {
      totalTokenUsage.prompt_tokens += pathClassifications.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += pathClassifications.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += pathClassifications.usage.total_tokens || 0;
    }

    // Step 2: Apply category count logic and concentration
    let concentratedClassifications;

    if (configCategoryCount >= 3) {
      // Use ONLY config categories - map all derived products to config categories
      log.info(`Config categories >= 3 (${configCategoryCount}): Mapping to config categories only (limit ${configCategoryCount})`);
      concentratedClassifications = await concentrateProducts(
        pathClassifications.paths,
        context,
        configCategories,
        configCategoryCount, // Limit to ONLY the config categories provided
      );
    } else if (configCategoryCount >= 1) {
      // Use config categories + LLM concentration to reach 6 total
      log.info(`Config categories 1-2 (${configCategoryCount}): Adding LLM categories to reach 6 total`);
      concentratedClassifications = await concentrateProducts(
        pathClassifications.paths,
        context,
        configCategories,
        6, // Target 6 total categories
      );
    } else {
      // Pure LLM generation - max 6 categories
      log.info('No config categories: Using LLM-only generation (max 6)');
      concentratedClassifications = await concentrateProducts(
        pathClassifications.paths,
        context,
        [],
        6, // Max 6 LLM-only categories
      );
    }

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

    // Remove "unknown", "unclassified", and "other" keys if they exist
    delete combinedPatterns.unknown;
    delete combinedPatterns.unclassified;
    delete combinedPatterns.other;

    log.info(`Completed product analysis for domain: ${domain}`);

    const finalCategories = Object.keys(combinedPatterns);
    log.info(`Final categories (${finalCategories.length}): ${finalCategories.join(', ')}`);

    // Log category breakdown if config categories were provided
    if (configCategoryCount > 0) {
      const matchedConfig = finalCategories.filter((c) => configCategories.includes(c));
      const extraCategories = finalCategories.filter((c) => !configCategories.includes(c));
      log.info(`├─ Matched config categories (${matchedConfig.length}): ${matchedConfig.join(', ') || 'none'}`);
      if (extraCategories.length > 0) {
        log.info(`└─ Additional LLM categories (${extraCategories.length}): ${extraCategories.join(', ')}`);
      }
    }

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
