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

async function derivePageTypesForPaths(domain, paths, context) {
  const { log } = context;
  const systemPrompt = `You are an expert web page classifier. Your task is to analyze URL paths and categorize them into standardized page types based on web conventions and URL patterns.

## OBJECTIVE
Classify each provided URL path into one of the predefined page types and return results in strict JSON format.

## ANALYTICAL THINKING PROCESS

Think like you're analyzing a spreadsheet of URLs - follow these steps systematically:

### STEP 1: DOMAIN CONTEXT ANALYSIS
- What type of website is this? (E-commerce, SaaS, content/publishing, corporate, community)
- What pages would this type of site typically have?
- What URL conventions does this domain appear to follow?

### STEP 2: URL STRUCTURE DECOMPOSITION
For each URL path, break it down:
- **Path segments**: Identify /segment1/segment2/segment3
- **Keyword indicators**: Look for standard web keywords (blog, product, about, help, etc.)
- **Depth analysis**: How many levels deep? First segment often indicates page type
- **ID/Slug detection**: Does it contain identifiers (numbers, slugs, UUIDs)?

### STEP 3: PAGE TYPE IDENTIFICATION LOGIC
Ask yourself systematically (GROUP BY SECTION, not by function):
1. "Is this the homepage?" → Check for /, /home, /index
2. "What section does this belong to?" → Look for keywords in the URL
   - Contains "product", "shop", "store", "item" → product
   - Contains "blog", "article", "news", "post" → blog
   - Contains "help", "support", "faq", "docs", "guide" → help
   - Contains "about", "company", "team" → about
   - Contains "contact", "reach" → contact
3. "Is this a special page?" → Check for /cart, /checkout, /search
4. "Is this legal/policy?" → Check for /legal, /privacy, /terms, /cookies
5. "Cannot determine?" → Default to "other" (use this sparingly)

### STEP 4: PATTERN MATCHING WITH EXAMPLES
Examples of thinking process:

Example A: "/products/nike-air-max-270"
- Thinking: "products" → e-commerce section, "nike-air-max-270" → specific product slug
- ID/Slug: Has descriptive slug (specific item identifier)
- Result: pageType = "product"

Example B: "/products"
- Thinking: "products" → products section, listing page but still product-related
- Pattern: Anything in /products/ is product content
- Result: pageType = "product"

Example C: "/shop/electronics/laptops"
- Thinking: URL contains "shop" keyword → product-related
- Pattern: Keyword-based matching, any URL with "shop" = product type
- Result: pageType = "product"

Example C2: "/en-us/products/photoshop/features"  
- Thinking: URL contains "product" keyword → product page
- Pattern: Keyword found in middle of URL, not just first segment
- Result: pageType = "product"

Example D: "/blog/how-to-improve-seo-2024"
- Thinking: "blog" → content section, "how-to-improve-seo-2024" → article slug
- Pattern: Follows /content-type/article-slug pattern
- Result: pageType = "blog"

Example E: "/help/getting-started"
- Thinking: "help" → support section, "getting-started" → specific help topic
- Pattern: Support/documentation structure
- Result: pageType = "help"

Example F: "/"
- Thinking: Root path, entry point to site
- Result: pageType = "homepage"

Example G: "/user/dashboard/settings"
- Thinking: User-specific path, doesn't match standard public page types
- Pattern: Application/admin interface
- Result: pageType = "other"

### STEP 5: VALIDATION & OUTPUT RULES
Ask yourself:
- "Does this path have multiple possible classifications?" → Choose most specific
- "Is this path ambiguous?" → Look for keywords in URL, not just first segment
- "Could this be misclassified?" → Check against common patterns  
- "What if it doesn't fit anywhere?" → Try harder to find keywords before defaulting to "other"
- **IMPORTANT:** Minimize "other" usage - look for keywords anywhere in the URL path

## VALID PAGE TYPES & KEYWORD-BASED CLASSIFICATION
Use ONLY these page types: **homepage, product, category, blog, about, help, legal, search, contact, cart, checkout, other**

Primary rule: Look for keywords ANYWHERE in the URL, not just first segment
- Contains "product", "shop", "store", "item" → product
- Contains "blog", "article", "news", "post" → blog  
- Contains "help", "support", "faq", "docs", "guide", "tutorial" → help
- Contains "about", "company", "team", "mission" → about
- Contains "contact", "reach-us", "get-in-touch" → contact
- Contains "search", "find", "query" → search
- Contains "cart", "basket", "bag" → cart
- Contains "checkout", "payment", "billing" → checkout
- Contains "privacy", "terms", "legal", "cookies" → legal

## RESPONSE FORMAT
Return ONLY valid JSON with this exact structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:
{
  "paths": [
    { "path": "/", "pageType": "homepage" },
    { "path": "/about", "pageType": "about" },
    { "path": "/products/123", "pageType": "product" }
  ]
}

## CRITICAL REQUIREMENTS
- Include ALL provided paths in your response
- Use ONLY the specified pageType values
- Return valid JSON with NO additional text or explanations
- Ensure proper JSON syntax and formatting`;

  const userPrompt = `Domain: ${domain}

URL Paths:
${JSON.stringify(paths, null, 2)}`;

  try {
    log.info('Extracting page types from URL paths');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);
    if (promptResponse && promptResponse.content) {
      const { paths: parsedPaths } = JSON.parse(promptResponse.content);
      log.info('Successfully extracted page types from URL paths');
      return { paths: parsedPaths, usage: promptResponse.usage };
    } else {
      log.info('No content received; defaulting all paths to "other"');
      return { paths: paths.map((path) => ({ path, pageType: 'other' })), usage: null };
    }
  } catch (error) {
    log.error(`Failed to get page types for paths: ${error.message}`);
    return { paths: paths.map((path) => ({ path, pageType: 'other' })), usage: null };
  }
}

function groupPathsByPageType(pathTypeArray) {
  return pathTypeArray.reduce((acc, { path, pageType }) => {
    if (!acc[pageType]) acc[pageType] = [];
    acc[pageType].push(path);
    return acc;
  }, {});
}

async function deriveRegexesForPageTypes(domain, groupedPaths, context) {
  const { log } = context;

  const systemPrompt = `You are an expert regex pattern generator specialized in creating URL path matching expressions for web analytics.

## OBJECTIVE
Generate POSIX-compatible regex patterns for URL path classification that work specifically with Amazon Athena SQL queries.

## INPUT DATA
You will receive:
- A domain name for context
- Grouped paths organized by page type (only page types that were actually found)

## ANALYTICAL THINKING PROCESS

For each page type, follow this systematic analysis (think like you're analyzing URLs in Excel):

### STEP 1: STRUCTURAL PATTERN RECOGNITION
- Examine all URLs for this page type: What structure do they share?
- Identify fixed segments: Which path parts are constant? (/blog/, /products/, /help/)
- Identify variable segments: Which parts change? (article slugs, product IDs, dates)
- Detect depth patterns: Are all paths the same depth? (/blog/[slug] vs /blog/[category]/[slug])

### STEP 2: COMMONALITY EXTRACTION
- Find the core path pattern: What makes this page type unique?
- Identify common prefixes: Do all paths start the same? (^/blog/, ^/products/)
- Identify common suffixes: Do paths end similarly? (.html, /index, query params)
- Detect separators: How are segments separated? (hyphens, underscores, slashes)

### STEP 3: VARIATION MAPPING
Examples of what to look for:
- **ID variations**: Numeric (123), alphanumeric (ABC123), UUIDs (a1b2c3d4)
- **Slug variations**: hyphenated (article-title), underscored (article_title)
- **Depth variations**: /blog/post vs /blog/2024/01/post vs /blog/category/post
- **Optional segments**: With/without trailing slashes, with/without file extensions

### STEP 4: REGEX CONSTRUCTION LOGIC
Based on your analysis:

Example A: Homepage paths: ["/", "/home", "/index"]
- Thinking: Very short paths, root or single segment
- Core pattern: Empty path or specific keywords
- Regex: (?i)^/(home|index)?$

Example B: Product paths: ["/products/123", "/PRODUCTS/ABC-456", "/Shop/item/789"]
- Thinking: Multiple parent paths (products, shop), case variations possible
- Pattern: /[parent]/optional-segment/[id-or-slug]
- Regex: (?i)^/(products|shop)(/[^/]+)?/[^/]+$

Example C: Blog paths: ["/blog/seo-tips", "/Blog/news/update", "/ARTICLES/guide"]
- Thinking: Content sections with slugs, case variations
- Pattern: /[content-type]/optional-category/[slug]
- Regex: (?i)^/(blog|articles|news)(/[^/]+){1,2}$

### STEP 5: VALIDATION THINKING
Ask yourself:
- "Does this regex match ALL provided example paths?" (Must be 100%)
- "Is this specific enough to avoid false positives?" (e.g., /blog shouldn't match /blog-backup)
- "Is this flexible enough for variations?" (new article slugs, new product IDs)
- "Are my anchors correct?" (^ for start, $ for end, or no anchors if mid-path matching)
- "Did I escape special regex characters?" (dots, dashes in literal matches)

### STEP 6: POSIX COMPATIBILITY CHECK
- **MANDATORY**: Use (?i) flag at the start for case-insensitive matching
- No lookahead (?=) or lookbehind (?<=)
- No non-capturing groups (?:) - use regular groups ()
- Use \\d for digits, \\w for word chars, [^/] for any-except-slash
- Properly escape: \\., \\-, \\+, \\?, \\*, \\(, \\), \\[, \\], \\{, \\}, \\^, \\$

## TASK REQUIREMENTS
- Generate patterns ONLY for page types in the provided grouped paths data
- Must be POSIX-compatible for Amazon Athena SQL (no lookahead/lookbehind, no (?:))
- **MANDATORY**: Start every regex with (?i) for case-insensitive matching
- Use standard regex syntax: ^, $, *, +, ?, [], (), |, \\d, \\w, [^/]
- Use anchors (^ and $) where appropriate
- Each regex MUST match ALL provided example paths for that page type

## OUTPUT FORMAT
Return ONLY valid JSON with this exact structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags.Return raw JSON only:
{
  "pageType1": "(?i)^/pattern1$",
  "pageType2": "(?i)^/pattern2$"
}

## CRITICAL REQUIREMENTS
- Base patterns on the ACTUAL input data provided (not the examples above)
- ALL regexes MUST start with (?i) flag
- Return valid JSON with NO additional text or explanations`;

  const userPrompt = `Domain: ${domain}

Grouped Paths:
${JSON.stringify(groupedPaths, null, 2)}`;

  try {
    log.info('Generating regex patterns for page types');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);
    if (promptResponse && promptResponse.content) {
      const parsed = JSON.parse(promptResponse.content);
      if (parsed && typeof parsed === 'object') {
        log.info('Successfully generated regex patterns for page types');
        return { regexes: parsed, usage: promptResponse.usage };
      }

      log.warn('Unexpected response received; defaulting to fallback regexes');
      return {
        regexes: Object.keys(groupedPaths).reduce((acc, type) => {
          acc[type] = '.*';
          return acc;
        }, {}),
        usage: promptResponse.usage,
      };
    } else {
      log.warn('No content received; defaulting to fallback regexes');
      return {
        regexes: Object.keys(groupedPaths).reduce((acc, type) => {
          acc[type] = '.*';
          return acc;
        }, {}),
        usage: null,
      };
    }
  } catch (error) {
    log.error(`Failed to generate regexes for page types: ${error.message}`);
    return {
      regexes: Object.keys(groupedPaths).reduce((acc, type) => {
        acc[type] = '.*';
        return acc;
      }, {}),
      usage: null,
    };
  }
}

export async function analyzePageTypes(domain, paths, context) {
  const { log } = context;

  log.info(`Starting page type analysis for domain: ${domain}`);

  const totalTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  try {
    const pathClassifications = await derivePageTypesForPaths(domain, paths, context);

    // Track token usage from path classification
    if (pathClassifications.usage) {
      totalTokenUsage.prompt_tokens += pathClassifications.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += pathClassifications.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += pathClassifications.usage.total_tokens || 0;
    }

    const groupedPaths = groupPathsByPageType(pathClassifications.paths);
    
    // Filter out "other" and "unknown" page types before generating regexes
    const filteredGroupedPaths = Object.entries(groupedPaths)
      .filter(([pageType]) => pageType !== 'other' && pageType !== 'unknown')
      .reduce((acc, [pageType, paths]) => {
        acc[pageType] = paths;
        return acc;
      }, {});
    
    const regexPatterns = await deriveRegexesForPageTypes(domain, filteredGroupedPaths, context);

    // Track token usage from regex generation
    if (regexPatterns.usage) {
      totalTokenUsage.prompt_tokens += regexPatterns.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += regexPatterns.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += regexPatterns.usage.total_tokens || 0;
    }

    // Log total token usage
    log.info(`Total token usage for page type analysis: ${JSON.stringify(totalTokenUsage)}`);

    log.info(`Page type analysis complete for domain: ${domain}`);

    // Filter out "other" and "unknown" page types
    const filteredRegexes = Object.entries(regexPatterns.regexes)
      .filter(([pageType]) => pageType !== 'other' && pageType !== 'unknown')
      .reduce((acc, [pageType, regex]) => {
        acc[pageType] = regex;
        return acc;
      }, {});

    // Order page types: homepage first, then alphabetically
    const pageTypeOrder = ['homepage', 'product', 'blog', 'help', 'about', 'contact', 'search', 'cart', 'checkout', 'legal', 'category'];
    const orderedRegexes = {};
    
    pageTypeOrder.forEach((pageType) => {
      if (filteredRegexes[pageType]) {
        orderedRegexes[pageType] = filteredRegexes[pageType];
      }
    });
    
    // Add any remaining page types not in the order list
    Object.keys(filteredRegexes).forEach((pageType) => {
      if (!orderedRegexes[pageType]) {
        orderedRegexes[pageType] = filteredRegexes[pageType];
      }
    });

    // Add default patterns at the end
    const defaultPatterns = {
      Robots: '(?i).*/robots.txt$',
      Sitemap: '(?i).*/sitemap.*.xml$',
      'Error Pages': '(?i)(404|500|error|goodbye)',
    };

    return { ...orderedRegexes, ...defaultPatterns };
  } catch (error) {
    log.error(`Failed to complete page type analysis: ${error.message}`);
    throw error;
  }
}
/* c8 ignore end */
