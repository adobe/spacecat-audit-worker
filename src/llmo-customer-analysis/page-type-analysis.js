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

async function derivePageTypesForPaths(domain, paths, context) {
  const { log } = context;
  const systemPrompt = `You are an expert web page classifier. Your task is to analyze URL paths and categorize them into standardized page types based on web conventions and URL patterns.

## OBJECTIVE
Classify each provided URL path into one of the predefined page types and return results in strict JSON format.

## PAGE TYPE DEFINITIONS

### **homepage**
- Root path "/"
- Main landing pages (e.g., "/home", "/index")
- Domain homepage variants

### **product**
- Individual product/item detail pages
- Patterns: /products/[id], /items/[slug], /shop/[product-name]
- Contains product IDs, SKUs, or product slugs
- Examples: /products/123, /shop/nike-air-max, /items/ABC123

### **category**
- Product category/collection listing pages
- Patterns: /products, /shop, /categories/[name], /collections/[name]
- Browse/filter pages for multiple products
- Examples: /products, /shop/shoes, /categories/electronics, /collections/sale

### **blog**
- Blog posts, articles, news content
- Patterns: /blog/[slug], /news/[slug], /articles/[slug], /posts/[slug]
- Editorial/content pages with publication dates
- Examples: /blog/how-to-guide, /news/company-update, /articles/industry-trends

### **about**
- Company information pages
- Patterns: /about, /about-us, /company, /team, /history, /mission
- Corporate information and team pages
- Examples: /about, /about-us, /company/team, /our-story

### **help**
- Support and assistance pages
- Patterns: /help, /support, /faq, /docs, /documentation, /guides, /tutorials
- Customer service and self-help content
- Examples: /help/getting-started, /support/contact, /faq, /docs/api

### **legal**
- Legal and policy documents
- Patterns: /privacy, /terms, /legal, /cookies, /disclaimer
- Compliance and legal information
- Examples: /privacy-policy, /terms-of-service, /legal/copyright

### **search**
- Search results and query pages
- Patterns: /search, /results, /find
- Contains search parameters or query strings
- Examples: /search?q=shoes, /results, /find

### **contact**
- Contact and communication pages
- Patterns: /contact, /contact-us, /get-in-touch, /reach-us
- Contact forms and information
- Examples: /contact, /contact-us, /get-in-touch

### **cart**
- Shopping cart and basket pages
- Patterns: /cart, /basket, /bag, /shopping-cart
- Order review before checkout
- Examples: /cart, /shopping-bag, /basket

### **checkout**
- Payment and order completion flow
- Patterns: /checkout, /payment, /order, /billing, /shipping
- Transaction and fulfillment process
- Examples: /checkout, /checkout/payment, /order/review

### **other**
- Any page that doesn't match the above categories
- User profiles, login/signup, dashboards, etc.
- Use when no other category applies

## CLASSIFICATION RULES

1. **Path Analysis Priority**:
   - First segment typically indicates primary function
   - Look for standard web conventions and keywords
   - Consider the full path structure, not just individual segments

2. **ID/Slug Detection**:
   - Numeric IDs (123, 456789) usually indicate individual items (product pages)
   - Alphanumeric slugs (product-name, blog-post-title) also indicate individual items
   - Pure category names indicate listing pages

3. **Specificity Principle**:
   - Choose the most specific applicable category
   - product > category for e-commerce paths
   - blog > other for content paths

4. **Edge Case Handling**:
   - Multi-segment paths: classify by primary function
   - Ambiguous paths: use context clues from domain and structure
   - When genuinely uncertain: default to "other"

5. **Common Patterns**:
   - /[category]/[item] → product
   - /[category] → category
   - /[content-type]/[slug] → blog
   - Administrative paths → other

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

## TASK REQUIREMENTS

### 1. SCOPE RESTRICTION
- Generate regex patterns ONLY for the page types that are present in the provided grouped paths data
- Do NOT create patterns for page types that are not included in the input
- If a page type is not in the grouped paths, do not include it in your response

### 2. REGEX CONSTRAINTS
- Must be POSIX-compatible for Amazon Athena SQL
- Avoid lookahead (?=), lookbehind (?<=), and non-standard modifiers
- Use standard regex syntax: ^, $, *, +, ?, [], (), |, \\d, \\w, etc.
- Ensure patterns are specific enough to avoid false matches
- Use anchors (^ and $) where appropriate

### 3. PATTERN QUALITY
- Create precise patterns that match the actual path structures
- Account for variations in the provided paths
- Balance specificity with flexibility for similar future paths
- Consider common URL patterns and conventions

## OUTPUT FORMAT
Return ONLY valid JSON with this exact structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags.Return raw JSON only:
      {
        "pageType1": "^/pattern1$",
        "pageType2": "^/pattern2$"
      }

## CRITICAL REQUIREMENTS
    - Include ONLY page types that exist in the provided grouped paths
      - Return valid JSON with NO additional text or explanations
        - Ensure proper JSON syntax and escaping
          - Each regex must be a string value`;

  const userPrompt = `Domain: ${domain}

Grouped Paths:
${JSON.stringify(groupedPaths, null, 2)} `;

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
    log.error(`Failed to generate regexes for page types: ${error.message} `);
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

  log.info(`Starting page type analysis for domain: ${domain} `);

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
    const regexPatterns = await deriveRegexesForPageTypes(domain, groupedPaths, context);

    // Track token usage from regex generation
    if (regexPatterns.usage) {
      totalTokenUsage.prompt_tokens += regexPatterns.usage.prompt_tokens || 0;
      totalTokenUsage.completion_tokens += regexPatterns.usage.completion_tokens || 0;
      totalTokenUsage.total_tokens += regexPatterns.usage.total_tokens || 0;
    }

    // Log total token usage
    log.info(`Total token usage for page type analysis: ${JSON.stringify(totalTokenUsage)} `);

    log.info(`Page type analysis complete for domain: ${domain} `);
    return regexPatterns.regexes;
  } catch (error) {
    log.error(`Failed to complete page type analysis: ${error.message} `);
    throw error;
  }
}
/* c8 ignore end */
