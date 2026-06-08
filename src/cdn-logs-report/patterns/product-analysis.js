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

// Code-level safety net; the concentrate prompt's ≤6 isn't strictly enforced.
const MAX_CATEGORIES_HARD_CAP = 12;

// Cap per classification call: the model echoes every path back, so larger
// batches overflow the output-token cap and truncate the JSON. Chunks run in
// parallel and their results are concatenated.
const PATHS_PER_CLASSIFY_CHUNK = 75;

async function concentrateProducts(
  pathProductArray,
  context,
  maxCategories = 6,
) {
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

  const systemPrompt = `You are an expert content categorization specialist focused on AGGRESSIVE GROUPING and SIMPLIFICATION of products into main categories.

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
   - Prioritize grouping less important products into broader categories to stay within the ${maxCategories} limit

VALIDATION STEP: Before returning your answer, count the unique category names (not including "unknown"). If you have more than ${maxCategories}, you MUST revise and group more categories together!

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

CRITICAL: Group related products under ONE main category. Remove version numbers and model variations!

ANTI-CATCH-ALL RULE: No single category may bundle more than 5 different product names into one alternation. If you have 6+ distinct products that share no real umbrella (e.g. analytics + marketo + audience-manager + target + campaigns), keep them as SEPARATE categories — do not invent a fake umbrella like "marketing" or "experience-cloud" that lumps them together. Customers want per-product traffic, not a "marketing" bucket.`;

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

async function classifyPathChunk(domain, paths, context) {
  const { log } = context;

  const systemPrompt = `You are an expert product classifier for URL path analysis. Your task is to analyze URL paths and map them to categories for Athena SQL analytics.

## OBJECTIVE
Classify each URL path by mapping it to the most relevant category.

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

### STEP 4: EXAMPLES (discover categories from URL structure)
Example A: "/products/analytics-platform/features"
- Thinking: "/products/" + "analytics-platform" → main keyword is "analytics"
- Result: product = "analytics"

Example B: "/solutions/cloud/pricing"
- Thinking: "/solutions/" + "cloud" → main keyword is "cloud"
- Result: product = "cloud"

Example C: "/products/photoshop/tutorials"
- Thinking: "photoshop" is a distinct product offering
- Result: product = "photoshop"

Example D: "/blog/design-tips"
- Thinking: Generic content under /blog/, no business offering → "unknown"
- Result: product = "unknown"

Example E: "/docs/machine-learning/guide"
- Thinking: "machine-learning" is the offering being documented → "ai" or "machine-learning"
- Result: product = "machine-learning"

### STEP 5: NAMING STANDARDIZATION & OUTPUT RULES
- **Format**: Lowercase, hyphenated (e.g., "marketing-automation" not "Marketing_Automation")
- **Singular form**: "solution" not "solutions", "software" not "softwares"
- **Product-focused**: "analytics" not "analytics-page" or "analytics-features"
- **Consistency**: Same product = same name across all paths
- **Business focus**: Only classify business offerings (products/services/solutions)
- **Exclusions**: Use "unknown" for generic content (blog, support, about, legal, careers, contact, press, investors)
- **Domain-agnostic**: Work for any industry (tech, retail, healthcare, finance, etc.)

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
- Do NOT use backslash escapes inside the regex strings — a stray "\\" makes your JSON invalid and breaks parsing. Match keywords as plain literal text (use a char class like [.] if you ever need a literal dot)
- Use double quotes to delimit JSON strings, not single quotes
- Do NOT put quotes INSIDE a regex. Alternation branches are bare words: write (discover|decouvrir), never ('discover'|'decouvrir') — quote characters never appear in URL paths and match nothing
- Ensure all strings are properly closed
- Return ONLY the JSON object

## CRITICAL REQUIREMENTS
- Include ALL provided paths in your response
- Return valid JSON with NO additional text or explanations
- ONLY return the JSON object, nothing else`;

  const userPrompt = `Domain: ${domain}

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

async function deriveProductsForPaths(domain, paths, context) {
  const { log } = context;

  // Small sites stay a single call.
  if (paths.length <= PATHS_PER_CLASSIFY_CHUNK) {
    return classifyPathChunk(domain, paths, context);
  }

  const chunks = [];
  for (let i = 0; i < paths.length; i += PATHS_PER_CLASSIFY_CHUNK) {
    chunks.push(paths.slice(i, i + PATHS_PER_CLASSIFY_CHUNK));
  }
  log.info(`Classifying ${paths.length} paths in ${chunks.length} chunks of ≤${PATHS_PER_CLASSIFY_CHUNK}`);

  // Parallel; a failed chunk degrades to "unknown" for its own paths only.
  const results = await Promise.all(
    chunks.map((chunk) => classifyPathChunk(domain, chunk, context)),
  );

  const mergedPaths = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let sawUsage = false;
  for (const result of results) {
    mergedPaths.push(...result.paths);
    if (result.usage) {
      sawUsage = true;
      usage.prompt_tokens += result.usage.prompt_tokens || 0;
      usage.completion_tokens += result.usage.completion_tokens || 0;
      usage.total_tokens += result.usage.total_tokens || 0;
    }
  }

  return { paths: mergedPaths, usage: sawUsage ? usage : null };
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
Pattern: (?i)(sacs|sectionals|accessories)
Explanation: These URLs contain product category names, so match those keywords

Example 2 - Category "Product" with URLs: ["/products/item-123", "/shop/widget", "/store/catalog"]
Pattern: (?i)(products?|shop|store)
Explanation: These URLs have shopping-related paths

Example 3 - Category "photoshop" with URLs: ["/ps/features", "/creative-cloud/photoshop", "/imaging-software"]
Pattern: (?i)(ps|photoshop|imaging-software|creative-cloud)
Explanation: Look for keywords that appear in the actual URLs

Example 4 - Category "Support" with URLs: ["/help", "/faq", "/contact-us"]
Pattern: (?i)(help|faq|contact)
Explanation: Match the actual keywords found in support URLs

Example 5 - Category "Cruiser" with URLs: ["/products/mens-cruiser-jersey", "/products/womens-cruiser-tee", "/products/cruiser-hoodie"]
Pattern: (?i)(cruiser)
Explanation: The distinguishing keyword sits in the MIDDLE of the slug. Match just that keyword so it is found anywhere in the path. Do NOT write (?i)products.(cruiser) — the section prefix ("products") plus a wildcard anchors the keyword to the front of the slug, but the keyword is mid-slug, so it matches nothing.

CRITICAL: Do NOT use the category name in the pattern unless it actually appears in the URLs!

## SLASH HANDLING
- URLs may or may not start with a forward slash
- Focus on KEYWORD MATCHING, not strict slash positioning
- DON'T require slashes before/after keywords: use (?i)(keyword) not (?i)/keyword/ or (?i)/(keyword)/
- The pattern should match keywords wherever they appear in the path
- DON'T prefix the keyword with the section name and a wildcard (e.g. NOT (?i)products.(cruiser)). E-commerce slugs often place the distinguishing keyword in the MIDDLE of the slug — like /products/mens-cruiser-jersey — so match the bare keyword (cruiser) and let it be found anywhere

## POSIX REGEX REQUIREMENTS (for Amazon Athena)
- Start with (?i) for case-insensitive matching
- NO lookahead (?=) or lookbehind (?<=)
- Use alternation (|) for multiple options
- Use ? for optional, * for zero-or-more
- DO NOT use backslash escapes (no \\., \\-, etc.) — a stray "\\" makes your JSON invalid and breaks parsing. Match keywords as plain literal text; use a char class like [.] for a literal dot.
- Keep patterns SIMPLE: Focus on keyword matching without requiring specific slash positions

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
- Do NOT use backslash escapes inside the regex strings — a stray "\\" makes your JSON invalid and breaks parsing. Match keywords as plain literal text (use a char class like [.] for a literal dot)
- Use double quotes to delimit JSON strings, not single quotes
- Do NOT put quotes INSIDE a regex. Alternation branches are bare words: write (discover|decouvrir), never ('discover'|'decouvrir') — quote characters never appear in URL paths and match nothing
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

export async function analyzeProducts(domain, paths, context) {
  const { log } = context;
  const totalTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  log.info(`Starting product analysis for domain: ${domain}`);

  try {
    // Step 1: classify each URL into a category
    const pathClassifications = await deriveProductsForPaths(domain, paths, context);
    if (pathClassifications.usage) {
      totalTokenUsage.prompt_tokens += pathClassifications.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += pathClassifications.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += pathClassifications.usage.total_tokens || 0;
    }

    // Step 2: concentrate to ≤12 umbrella categories (12 keeps multi-vertical
    // sites granular instead of collapsing into one mega-bucket).
    log.info('Concentrating classifications into ≤12 umbrella categories');
    const concentratedClassifications = await concentrateProducts(
      pathClassifications.paths,
      context,
      MAX_CATEGORIES_HARD_CAP,
    );
    if (concentratedClassifications.usage) {
      totalTokenUsage.prompt_tokens += concentratedClassifications.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens
        += concentratedClassifications.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += concentratedClassifications.usage.total_tokens || 0;
    }

    // Step 3: generate keyword regex per category
    const groupedPaths = groupPathsByProduct(concentratedClassifications.paths);
    const regexPatterns = await deriveRegexesForProducts(domain, groupedPaths, context);
    if (regexPatterns.usage) {
      totalTokenUsage.prompt_tokens += regexPatterns.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += regexPatterns.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += regexPatterns.usage.total_tokens || 0;
    }

    const combinedPatterns = regexPatterns.patterns;

    // Remove noise keys
    delete combinedPatterns.unknown;
    delete combinedPatterns.unclassified;
    delete combinedPatterns.other;

    // Hard cap — drop trailing entries if the LLM exceeded the soft limit.
    const allNames = Object.keys(combinedPatterns);
    if (allNames.length > MAX_CATEGORIES_HARD_CAP) {
      log.info(`Capping ${allNames.length} → ${MAX_CATEGORIES_HARD_CAP} categories (hard cap)`);
      allNames.slice(MAX_CATEGORIES_HARD_CAP).forEach((n) => {
        delete combinedPatterns[n];
      });
    }

    const finalCategories = Object.keys(combinedPatterns);
    log.info(`Final categories (${finalCategories.length}): ${finalCategories.join(', ')}`);
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
