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

// 12 total = LLM-derived + 4 mandatory (homepage, robots, sitemap, error).
const MAX_TOTAL_PAGE_TYPES = 12;
const MAX_LLM_PAGE_TYPES = MAX_TOTAL_PAGE_TYPES - 4;

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

**IMPORTANT — Site-type aware labeling:**
- Use "product listing page" and "product detail page" ONLY for e-commerce / retail sites that sell physical or digital goods.
- For B2B / SaaS / corporate sites, use "product page" or "solution page" (NOT "product detail page") even if the URL contains "/products/" — these describe a single offering, not a SKU.
- For news / media sites, use "article", "section", "video", etc.
- For documentation, use "docs", "guide", "api reference".

### STEP 2: URL STRUCTURE DECOMPOSITION
For each URL path, break it down:
- **Path segments**: Identify /segment1/segment2/segment3
- **Keyword indicators**: Look for standard web keywords (blog, product, about, help, etc.)
- **Depth analysis**: How many levels deep? First segment often indicates page type
- **ID/Slug detection**: Does it contain identifiers (numbers, slugs, UUIDs)?

### STEP 3: PAGE TYPE IDENTIFICATION LOGIC
Ask yourself systematically (GROUP BY SECTION, not by function):
1. "Is this the homepage?" → Check for /, /home, /index - **ALWAYS CHECK THIS FIRST!**
2. "Is this an e-commerce site?" (decided in STEP 1) — if yes, use product listing / product detail labels. If no, do NOT use them.
3. "What section does this belong to?" → Look for keywords in the URL
   - Contains "blog", "article", "news", "post" → blog / article
   - Contains "help", "support", "faq", "docs", "guide" → help / docs / guide
   - Contains "about", "company", "team" → about
   - Contains "contact", "reach" → contact
   - For e-commerce: "product", "shop", "store", "category", "collection" → product listing / product detail (see below)
   - For B2B/SaaS: "product", "solution" → product page / solution page
4. "Is this a special page?" → Check for /cart, /checkout, /search
5. "Is this legal/policy?" → Check for /legal, /privacy, /terms, /cookies
6. "Cannot determine?" → Default to "other" (use this sparingly)

### IMPORTANT: product listing page vs product detail page Distinction (E-COMMERCE ONLY)
- **product listing page**: Category/listing pages showing multiple products (e.g., /products, /shop/electronics, /category/shoes)
- **product detail page**: Individual product pages with specific item identifier/slug (e.g., /products/iphone-15, /p/12345)
- Key indicator: Does the URL end with a specific product identifier (slug, SKU, ID)? → product detail page
- Key indicator: Is it a browsing/filtering page without specific item? → product listing page
- **NEVER apply these labels on a non-ecommerce site** — for B2B / corporate, use "product page" or "solution page".

### STEP 4: PATTERN MATCHING WITH EXAMPLES
Examples of thinking process:

Example A (e-commerce): "/products/nike-air-max-270"
- Site is e-commerce, specific product slug present → "product detail page"

Example B (e-commerce): "/products"
- Site is e-commerce, listing page → "product listing page"

Example C (B2B/SaaS): "/products/analytics"
- Site is B2B (Adobe Business), describes a single offering — NOT a SKU → "product page"
- NOT "product detail page"

Example D (B2B/SaaS): "/solutions/marketing-automation"
- B2B solution overview → "solution page"

Example E: "/blog/how-to-improve-seo-2024"
- Result: pageType = "blog"

Example F: "/help/getting-started"
- Result: pageType = "help"

Example G: "/"
- Result: pageType = "homepage"

Example H: "/user/dashboard/settings"
- Result: pageType = "other"

### STEP 5: VALIDATION & OUTPUT RULES
- "Is this the homepage (/, /home, /index)?" → Classify as "homepage" FIRST, don't apply keyword matching
- "Does this path have multiple possible classifications?" → Choose most specific
- "What if it doesn't fit anywhere?" → Try harder to find keywords before defaulting to "other"
- **IMPORTANT:** Minimize "other" usage - look for keywords anywhere in the URL path

## PAGE TYPE CLASSIFICATION APPROACH
You are FREE to discover and create page types based on what you see in the URLs. Common types include:
- homepage - root/landing pages
- product listing page - e-commerce category/listing pages (e-commerce ONLY)
- product detail page - e-commerce item pages with SKU/slug (e-commerce ONLY)
- product page - B2B/SaaS single-offering pages (non-ecom)
- solution page - B2B solution overviews
- blog / article - content/articles
- about - company info
- help / docs / guide - support/documentation
- legal - legal/policy pages
- search - search pages
- contact - contact pages

BUT you can create NEW page types if URLs suggest different categories!

Examples of flexible classification:
- URLs with "/learn/", "/education/" → could be "education" or "learning"
- URLs with "/gallery/", "/photos/" → could be "gallery"
- URLs with "/events/", "/calendar/" → could be "events"
- URLs with "/resources/", "/downloads/" → could be "resources"
- URLs with "/customer-success-stories/" → "customer story"
- URLs with "/podcast/" → "podcast"

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
- Do NOT use backslash escapes inside the regex strings — a stray "\\" makes your JSON invalid and breaks parsing. Match keywords as plain literal text (use a char class like [.] if you ever need a literal dot)
- Use double quotes to delimit JSON strings, not single quotes
- Do NOT put quotes INSIDE a regex. Alternation branches are bare words: write (discover|decouvrir), never ('discover'|'decouvrir') — quote characters never appear in URL paths and match nothing
- Ensure all strings are properly closed
- Return ONLY the JSON object

## CRITICAL REQUIREMENTS
- Include ALL provided paths in your response
- You can create new page types based on what you discover
- **MAXIMUM 12 distinct page types** — merge near-duplicates (article + news → blog). Use lowercase labels (treat 'Sitemap' and 'sitemap' as the same).
- Do NOT emit 'homepage', 'robots', 'sitemap', or 'error pages' — they are auto-injected; focus on content-driven page types.
- **NO CATCH-ALL.** No single page-type may match more than 40% of URLs. If your regex needs 6+ alternation branches (especially enumerating locale prefixes like (de|fr|ja|ar|...)), you're labeling too broadly — split or drop. Locale prefixes are TRANSPARENT — use \`(^|/)token(/|$)\` which already handles any prefix, not \`(de/token|fr/token|...)\`.
- **PRODUCT NAMES ARE NOT PAGE TYPES.** Page-types describe URL FUNCTION (blog, listing, detail, support, legal, release notes, troubleshooting, tutorial). Product names (analytics, marketo, photoshop, journey-optimizer) belong in categories, NEVER as page-types. The right label for a product page is 'product detail page' or 'documentation', not the product name itself.
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
    if (!acc[pageType]) {
      acc[pageType] = [];
    }
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
Pattern: (?i)(products?|shop|store)
Explanation: These URLs contain shopping keywords, so match those

Example 3 - Page type "blog" with URLs: ["/articles/post", "/news/update", "/stories"]
Pattern: (?i)(articles?|news|stories)
Explanation: Look for keywords that actually appear in the URLs

Example 4 - Page type "help" with URLs: ["/help", "/support", "/faq"]
Pattern: (?i)(help|support|faq)
Explanation: Match the actual keywords found in these URLs

CRITICAL: Do NOT use the page type name in the pattern unless it actually appears in the URLs!

## SLASH HANDLING
- URLs may or may not start with a forward slash
- Focus on KEYWORD MATCHING, not strict slash positioning
- DON'T require slashes before/after keywords: use (?i)(keyword) not (?i)/keyword/ or (?i)/(keyword)/
- The pattern should match keywords wherever they appear in the path
- CRITICAL EXCEPTION: Root paths like "/" or "/home" or "/index" MUST be classified as "homepage" FIRST, before any keyword matching
- Homepage patterns need specific structure like (?i)^(/(home|index)?)?$ to match root URLs only

## POSIX REGEX REQUIREMENTS (for Amazon Athena)
- Start with (?i) for case-insensitive matching
- NO lookahead (?=) or lookbehind (?<=)
- Use alternation (|), ? for optional, * for zero-or-more
- DO NOT use backslash escapes (no \\., \\-, etc.) — a stray "\\" makes your JSON invalid and breaks parsing. Match keywords as plain literal text; use a char class like [.] for a literal dot.
- Keep patterns SIMPLE: Focus on keyword matching without requiring specific slash positions

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
- Do NOT use backslash escapes inside the regex strings — a stray "\\" makes your JSON invalid and breaks parsing. Match keywords as plain literal text (use a char class like [.] if you ever need a literal dot)
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

Page types with their example URLs:
${JSON.stringify(groupedPaths, null, 2)}

Generate simple regex patterns for each page type that can match these URLs and similar future URLs.`;

  const createFallbackPatterns = () => Object.keys(groupedPaths).reduce((acc, type) => {
    const keyword = type.toLowerCase().replace(/[^a-z0-9]/g, '-');
    acc[type] = `(?i)(${keyword})`;
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
    const commonPageTypes = ['homepage', 'product listing page', 'product detail page', 'blog', 'about', 'help', 'contact', 'search', 'cart', 'checkout', 'legal'];
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

    // Force our own homepage regex; an LLM-emitted one is often too narrow.
    // Covers "/", "/home", "/index" and up to 3 locale segments (e.g. /en-ca).
    // [.] not \. — backslash-free for the JSON→Athena pipeline.
    const homepageRegex = '(?i)^((/[a-z]{2}(-[a-z]{2})?){0,3})(/(home|index))?([.]html)?/?$';
    delete orderedRegexes.homepage;

    // Hoist homepage to front so the cap never drops it.
    const entries = [['homepage', homepageRegex], ...Object.entries(orderedRegexes)];
    if (entries.length > MAX_LLM_PAGE_TYPES + 1) {
      log.info(`Capping ${entries.length} → ${MAX_LLM_PAGE_TYPES + 1} page types (hard cap, before adding defaults)`);
    }
    const capped = Object.fromEntries(entries.slice(0, MAX_LLM_PAGE_TYPES + 1));

    // Anchored + [.] (not \.) for the JSON→Athena pipeline. Unanchored
    // substrings misclassified URLs like /docs/meta-robots-txt or
    // /blog/how-to-build-a-sitemap.
    const defaultPatterns = {
      robots: '(?i)/robots[.]txt$',
      sitemap: '(?i)/sitemap[^/]*[.]xml$',
      'error pages': '(?i)(404|500|error|goodbye)',
    };

    return { ...capped, ...defaultPatterns };
  } catch (error) {
    log.error(`Failed to complete page type analysis: ${error.message}`);
    throw error;
  }
}
/* c8 ignore end */
