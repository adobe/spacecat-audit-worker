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
  const systemPrompt = `You are an expert web page classifier. Your task is to analyze URL paths and categorize them into page types based on web conventions and URL patterns.

## OBJECTIVE
Classify each provided URL path by discovering and assigning appropriate page types. Return results in strict JSON format.

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

## PAGE TYPE CLASSIFICATION APPROACH
You are FREE to discover and create page types based on what you see in the URLs. Common types include:
- homepage - root/landing pages
- product - shopping/product pages
- category - category/collection pages
- blog - content/articles
- about - company info
- help - support/documentation
- legal - legal/policy pages
- search - search pages
- contact - contact pages

BUT you can create NEW page types if URLs suggest different categories!

Examples of flexible classification:
- URLs with "/learn/", "/education/" → could be "education" or "learning"
- URLs with "/gallery/", "/photos/" → could be "gallery" 
- URLs with "/events/", "/calendar/" → could be "events"
- URLs with "/resources/", "/downloads/" → could be "resources"

Primary rule: Look for patterns and group similar URLs together, then name the group appropriately

## RESPONSE FORMAT
Return ONLY valid JSON with this exact structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:
{
  "paths": [
    { "path": "/", "pageType": "homepage" },
    { "path": "/about", "pageType": "about" },
    { "path": "/products/123", "pageType": "product" }
  ]
}

## JSON FORMATTING RULES (CRITICAL)
- NO markdown formatting (no code blocks)
- NO explanations or comments
- NO line breaks inside strings
- Properly escape special characters in strings
- Use double quotes, not single quotes
- Ensure all strings are properly closed
- Return ONLY the JSON object

## CRITICAL REQUIREMENTS
- Include ALL provided paths in your response
- You can create new page types based on what you discover
- Return valid JSON with NO additional text or explanations
- Ensure proper JSON syntax and formatting`;

  const userPrompt = `Domain: ${domain}

URL Paths:
${JSON.stringify(paths, null, 2)}`;

  const createDefaultPaths = () => paths.map((path) => ({ path, pageType: 'other' }));

  try {
    log.info('Extracting page types from URL paths');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);

    if (!promptResponse?.content) {
      log.info('No content received; defaulting all paths to "other"');
      return { paths: createDefaultPaths(), usage: null };
    }

    // Clean up markdown formatting and parse
    let content = promptResponse.content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(content);
    if (parsed?.paths && Array.isArray(parsed.paths)) {
      log.info('Successfully extracted page types from URL paths');
      return { paths: parsed.paths, usage: promptResponse.usage };
    }

    log.warn('Invalid response structure; defaulting all paths to "other"');
    return { paths: createDefaultPaths(), usage: promptResponse.usage };
  } catch (error) {
    log.error(`Failed to get page types: ${error.message}`);
    return { paths: createDefaultPaths(), usage: null };
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

  const systemPrompt = `You are a regex pattern generator for URL page type classification in Amazon Athena SQL.

## OBJECTIVE
Generate SIMPLE, GENERIC regex patterns that can identify which page type a URL belongs to.

## INPUT
You receive page types with example URLs that belong to each page type.

## GOAL
Create simple patterns that:
1. Match URLs of that page type
2. Are easy to understand and maintain
3. Work with future URLs of the same page type

## STRATEGY
**IMPORTANT**: The page type name is just a LABEL. Analyze the ACTUAL URLs to find patterns!

For each page type:
1. **Look at the actual URLs** in that page type
2. **Find common keywords** that appear in those URLs
3. **Identify common path segments** in those URLs
4. **Create a pattern** based on what you see in the URLs, NOT the page type name
5. **Keep it SIMPLE**: Prefer broad matching over complex patterns

## EXAMPLES (Page type is just a LABEL - analyze the actual URLs!)

Example 1 - Page type "homepage" with URLs: ["/", "/home", "/index"]
Pattern: (?i)^(/(home|index)?)?$
Explanation: These are root-level URLs, so match empty or home/index

Example 2 - Page type "product" with URLs: ["/products/item-123", "/shop/widget", "/store/catalog"]
Pattern: (?i)/(products?|shop|store)/
Explanation: These URLs contain shopping keywords, so match those

Example 3 - Page type "blog" with URLs: ["/articles/post", "/news/update", "/stories"]
Pattern: (?i)/(articles?|news|stories)/
Explanation: Look for keywords that actually appear in the URLs

Example 4 - Page type "help" with URLs: ["/help", "/support", "/faq"]
Pattern: (?i)/(help|support|faq)/
Explanation: Match the actual keywords found in these URLs

CRITICAL: Do NOT use the page type name in the pattern unless it actually appears in the URLs!

## POSIX REGEX REQUIREMENTS (for Amazon Athena)
- Start with (?i) for case-insensitive matching
- NO lookahead (?=) or lookbehind (?<=)
- NO non-capturing groups (?:)
- Use alternation (|), ? for optional, * for zero-or-more
- Escape special chars: \\., \\-, \\+, \\?, \\*, etc.

## OUTPUT FORMAT
Return ONLY valid JSON. No markdown, no code blocks, no explanations:
{
  "pageType1": "(?i)simple-pattern",
  "pageType2": "(?i)simple-pattern"
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

Page types with their example URLs:
${JSON.stringify(groupedPaths, null, 2)}

Generate simple regex patterns for each page type that can match these URLs and similar future URLs.`;

  const createFallbackPatterns = () => Object.keys(groupedPaths).reduce((acc, type) => {
    const keyword = type.toLowerCase().replace(/[^a-z0-9]/g, '-');
    acc[type] = `(?i)/${keyword}/`;
    return acc;
  }, {});

  try {
    log.info('Generating regex patterns for page types');
    const promptResponse = await prompt(systemPrompt, userPrompt, context);

    if (!promptResponse?.content) {
      log.warn('No content received; using fallback patterns');
      return { regexes: createFallbackPatterns(), usage: null };
    }

    // Clean up markdown formatting and parse
    let content = promptResponse.content.trim();
    if (content.startsWith('```')) {
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
      log.info('Successfully generated regex patterns for page types');
      return { regexes: parsed, usage: promptResponse.usage };
    }

    log.warn('Empty response; using fallback patterns');
    return { regexes: createFallbackPatterns(), usage: promptResponse.usage };
  } catch (error) {
    log.error(`Failed to generate regex patterns: ${error.message}`);
    return { regexes: createFallbackPatterns(), usage: null };
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

    // Keep all discovered page types - don't limit to predefined list
    const filteredGroupedPaths = Object.entries(groupedPaths)
      .filter(([pageType]) => pageType !== 'other' && pageType !== 'unknown')
      .reduce((acc, [pageType, pathsForType]) => {
        acc[pageType] = pathsForType;
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

    // Order page types: homepage first, then common types, then discovered types alphabetically
    const commonPageTypes = ['homepage', 'product', 'category', 'blog', 'about', 'help', 'contact', 'search', 'cart', 'checkout', 'legal'];
    const orderedRegexes = {};

    commonPageTypes.forEach((pageType) => {
      if (filteredRegexes[pageType]) {
        orderedRegexes[pageType] = filteredRegexes[pageType];
      }
    });

    const discoveredTypes = Object.keys(filteredRegexes)
      .filter((pageType) => !commonPageTypes.includes(pageType))
      .sort();

    discoveredTypes.forEach((pageType) => {
      orderedRegexes[pageType] = filteredRegexes[pageType];
    });

    if (!orderedRegexes.homepage) {
      orderedRegexes.homepage = '(?i)^(/(home|index)?)?$';
      log.info('Added default homepage pattern as it was not detected in the data');
    }

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
