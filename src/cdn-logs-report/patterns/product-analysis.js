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

  let systemPrompt = `You are an expert product classifier for URL path analysis. Your task is to analyze URL paths and map them to categories for Athena SQL analytics.

## OBJECTIVE
Classify each URL path by mapping it to the most relevant category${hasConfigCategories ? ' from the user-provided categories' : ''}.

## ANALYTICAL THINKING PROCESS

Think like you're analyzing a spreadsheet of URLs - follow these steps systematically:

### STEP 1: DOMAIN UNDERSTANDING
- What industry is this domain in? (Tech, retail, healthcare, finance, media, etc.)
- What do they likely sell/offer? (Products, services, content, solutions)
- What business model? (SaaS, e-commerce, publishing, consulting)

### STEP 2: URL STRUCTURE ANALYSIS
For each URL path, examine:
- **Path segments**: Break down /segment1/segment2/segment3
- **Keywords**: Look for product names, category names, or related terms
- **Hierarchy clues**: First segment often indicates section type (/products/, /solutions/, /services/)
- **Naming patterns**: How does this domain structure their URLs?

### STEP 3: CATEGORY MAPPING LOGIC
For each URL, ask:
1. "Does this URL contain keywords related to any category?" → Check for exact or partial matches
2. "What section does this URL belong to?" → Look at path structure
3. "Is this clearly related to a specific category?" → Map it to that category
4. "If no clear match, is this business-relevant?" → Map to "other" or "unknown"

### STEP 4: EXAMPLES
Example A: "/products/analytics-platform/features" (categories: ["analytics", "cloud", "ai"])
- Thinking: Contains "analytics" keyword → maps to "analytics"
- Result: product = "analytics"

Example B: "/solutions/cloud/pricing" (categories: ["analytics", "cloud", "ai"])
- Thinking: Contains "cloud" keyword → maps to "cloud"
- Result: product = "cloud"

Example C: "/blog/design-tips" (categories: ["analytics", "cloud", "ai"])
- Thinking: Generic content, no category match → maps to "other"
- Result: product = "other"

Example D: "/docs/machine-learning/guide" (categories: ["analytics", "cloud", "ai"])
- Thinking: "machine-learning" related to "ai" → maps to "ai"
- Result: product = "ai"`;

  if (hasConfigCategories) {
    systemPrompt += `

## CRITICAL: USER-PROVIDED CATEGORIES (HIGHEST PRIORITY)
The following categories MUST be used for classification. Try to map as many URLs as possible to these categories:
${configCategories.map((cat) => `- ${cat}`).join('\n')}

STRICT RULES:
1. **First priority**: Look for EXACT keyword matches in the URL path (case-insensitive)
2. **Second priority**: Look for RELATED terms or PARTIAL matches (e.g., "ai" matches "artificial-intelligence", "ml", "machine-learning")
3. **Third priority**: Look at URL structure and context to infer the category
4. **Fallback**: If a URL is completely unrelated to ANY provided category, use "other"
5. **MAXIMIZE mapping**: Be generous in mapping URLs to provided categories - if there's any reasonable connection, use it
6. **Keywords to look for**: Category name itself, related terms, synonyms, abbreviations, product variants
7. **Do NOT invent new categories**: Only use the provided categories or "other"

Example mapping strategies:
- Category "photoshop" → matches "/products/photoshop", "/photoshop-features", "/ps-tools", "/photo-editing"
- Category "analytics" → matches "/analytics", "/data-insights", "/reporting", "/metrics"
- Category "cloud" → matches "/cloud", "/aws", "/hosting", "/infrastructure"`;
  } else {
    systemPrompt += `

### STEP 5: NAMING STANDARDIZATION & OUTPUT RULES
- **Format**: Lowercase, hyphenated (e.g., "marketing-automation" not "Marketing_Automation")
- **Singular form**: "solution" not "solutions", "software" not "softwares"
- **Product-focused**: "analytics" not "analytics-page" or "analytics-features"
- **Consistency**: Same product = same name across all paths
- **Business focus**: Only classify business offerings (products/services/solutions)
- **Exclusions**: Use "unknown" for generic content (blog, support, about, legal, careers, contact, press, investors)
- **Domain-agnostic**: Work for any industry (tech, retail, healthcare, finance, etc.)`;
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

## JSON FORMATTING RULES (CRITICAL)
- NO markdown formatting (no code blocks)
- NO explanations or comments
- NO line breaks inside strings
- Properly escape special characters in strings (use backslashes for escaping)
- Use double quotes, not single quotes
- Ensure all strings are properly closed
- Return ONLY the JSON object

## CRITICAL REQUIREMENTS
- Include ALL provided paths in your response
- Return valid JSON with NO additional text or explanations
- ONLY return the JSON object, nothing else`;

  const userPrompt = `Domain: ${domain}
${hasConfigCategories ? `\nPriority Categories: ${JSON.stringify(configCategories)}` : ''}

URL Paths:
${JSON.stringify(paths, null, 2)}`;

  const createDefaultPaths = () => paths.map((path) => ({ path, product: 'unknown' }));

  try {
    log.info('Extracting products from URL paths');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);

    if (!promptResponse?.content) {
      log.info('No content received; defaulting to unknown products');
      return { paths: createDefaultPaths(), usage: null };
    }

    // Clean up markdown formatting and parse
    let content = promptResponse.content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(content);
    if (parsed?.paths && Array.isArray(parsed.paths)) {
      log.info('Successfully extracted products from URL paths');
      return { paths: parsed.paths, usage: promptResponse.usage };
    }

    log.warn('Invalid response structure; defaulting to unknown products');
    return { paths: createDefaultPaths(), usage: promptResponse.usage };
  } catch (error) {
    log.error(`Failed to extract products: ${error.message}`);
    return { paths: createDefaultPaths(), usage: null };
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

  const systemPrompt = `You are a regex pattern generator for URL categorization in Amazon Athena SQL.

TASK: Generate SIMPLE, GENERIC regex patterns that can identify which category a URL belongs to.

INPUT: You receive categories with example URLs that belong to each category.

## GOAL
Create simple keyword-based patterns that:
1. Match URLs belonging to that category
2. Are easy to understand and maintain
3. Work with future URLs in the same category

## STRATEGY
**IMPORTANT**: The category name is just a LABEL. Analyze the ACTUAL URLs to find patterns!

For each category:
1. **Look at the actual URLs** in that category
2. **Find common keywords** that appear in those URLs
3. **Identify common path segments** in those URLs
4. **Create a pattern** based on what you see in the URLs, NOT the category name
5. **Keep it SIMPLE**: Prefer broad matching over complex patterns

## EXAMPLES (Category name is just a LABEL - analyze the actual URLs!)

Example 1 - Category "Brand" with URLs: ["/sacs/lovesac", "/sectionals/design", "/accessories"]
Pattern: (?i)/(sacs|sectionals|accessories)/
Explanation: These URLs contain product category names, so match those keywords

Example 2 - Category "Product" with URLs: ["/products/item-123", "/shop/widget", "/store/catalog"]
Pattern: (?i)/(products?|shop|store)/
Explanation: These URLs have shopping-related paths

Example 3 - Category "photoshop" with URLs: ["/ps/features", "/creative-cloud/photoshop", "/imaging-software"]
Pattern: (?i)/(ps|photoshop|imaging-software|creative-cloud)/
Explanation: Look for keywords that appear in the actual URLs

Example 4 - Category "Support" with URLs: ["/help", "/faq", "/contact-us"]
Pattern: (?i)/(help|faq|contact)/
Explanation: Match the actual keywords found in support URLs

CRITICAL: Do NOT use the category name in the pattern unless it actually appears in the URLs!

## POSIX REGEX REQUIREMENTS (for Amazon Athena)
- Start with (?i) for case-insensitive matching
- NO lookahead (?=) or lookbehind (?<=)
- NO non-capturing groups (?:)
- Use alternation (|) for multiple options
- Use ? for optional, * for zero-or-more
- Escape special chars: \\., \\-, \\+, \\?, \\*, \\(, \\), etc.

## OUTPUT FORMAT
Return ONLY valid JSON. No markdown, no code blocks, no explanations, no line breaks in strings:
{
  "Category1": "(?i)simple-pattern",
  "Category2": "(?i)simple-pattern"
}

## JSON FORMATTING RULES (CRITICAL)
- NO markdown formatting (no code blocks)
- NO explanations or comments
- NO line breaks inside strings
- Properly escape special characters in strings
- Use double quotes, not single quotes
- Ensure all strings are properly closed
- Return ONLY the JSON object

## CRITICAL RULES
- Analyze the ACTUAL URLs provided
- Keep patterns SIMPLE and GENERIC
- Each pattern must start with (?i)
- Return only JSON, no additional text`;

  const userPrompt = `Domain: ${domain}

Categories with their example URLs:
${JSON.stringify(groupedPaths, null, 2)}

Generate simple regex patterns for each category that can match these URLs and similar future URLs.`;

  const createFallbackPatterns = () => Object.keys(groupedPaths).reduce((acc, product) => {
    const keyword = product.toLowerCase().replace(/[^a-z0-9]/g, '-');
    acc[product] = `(?i)${keyword}`;
    return acc;
  }, {});

  try {
    log.info('Generating regex patterns for products');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);

    if (!promptResponse?.content) {
      log.warn('No content received; using fallback patterns');
      return { patterns: createFallbackPatterns(), usage: null };
    }

    // Clean up markdown formatting and parse
    let content = promptResponse.content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      log.info('Successfully generated regex patterns for products');
      return { patterns: parsed, usage: promptResponse.usage };
    }

    log.warn('Empty response; using fallback patterns');
    return { patterns: createFallbackPatterns(), usage: promptResponse.usage };
  } catch (error) {
    log.error(`Failed to generate regex patterns: ${error.message}`);
    return { patterns: createFallbackPatterns(), usage: null };
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
    // Step 1: Classify paths - if config categories exist, map to them; otherwise use LLM
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

    // Step 2: Apply category logic
    let concentratedClassifications;

    if (configCategoryCount > 0) {
      // Config categories provided - use them strictly, no additional LLM concentration needed
      log.info(`Config categories provided (${configCategoryCount}): Using strict mapping to config categories + "other" for unmatched`);
      // URLs are already mapped to config categories or "other" by deriveProductsForPaths
      concentratedClassifications = pathClassifications;
    } else {
      // No config categories - use LLM to generate and concentrate categories
      log.info('No config categories: Using LLM generation and concentration (max 6 categories)');
      concentratedClassifications = await concentrateProducts(
        pathClassifications.paths,
        context,
        [],
        6, // Max 6 LLM-only categories
      );

      // Track token usage from concentration step
      if (concentratedClassifications.usage) {
        totalTokenUsage.prompt_tokens += concentratedClassifications.usage.prompt_tokens || 0;
        totalTokenUsage.completion_tokens
          += concentratedClassifications.usage.completion_tokens || 0;
        totalTokenUsage.total_tokens += concentratedClassifications.usage.total_tokens || 0;
      }
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

    // Remove "unknown", "unclassified" and "other" keys if they exist
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
