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

async function deriveProductsForPaths(domain, paths, context) {
  const { log, env } = context;
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

  const userPrompt = [
    'ANALYSIS REQUEST:',
    'Please extract the primary content identifier from each URL path for the following website.',
    '',
    `DOMAIN: ${domain}`,
    '',
    `URL PATHS TO ANALYZE (${paths.length} total):`,
    JSON.stringify(paths, null, 2),
    '',
    'REQUIRED OUTPUT:',
    'Return a JSON object with one entry per path, mapping each path to its extracted content identifier.',
    'Use the content identification rules and examples provided in the system prompt.',
    '',
    'REMINDER: Include every path exactly once. Return only valid JSON with no additional text.',
  ].join('\n');

  try {
    log.info('Extracting products from URL paths');
    const content = await prompt(systemPrompt, userPrompt, env);
    if (content) {
      const { paths: parsedPaths } = JSON.parse(content);
      log.info('Successfully extracted products from URL paths');
      return parsedPaths;
    } else {
      log.info('No content received; defaulting to unknown products');
      return paths.map((path) => ({ path, product: 'unknown' }));
    }
  } catch (error) {
    log.error(`Failed to extract products from paths: ${error.message}`);
    return paths.map((path) => ({ path, product: 'unknown' }));
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
  const { env, log } = context;

  const systemPrompt = `You are a regex pattern generation specialist for URL path analysis in Amazon Athena SQL environments.

TASK: Generate POSIX-compatible regex patterns for each product that will match all URL paths containing references to that specific product.

AMAZON ATHENA SQL REGEX REQUIREMENTS:
- Use POSIX Extended Regular Expression (ERE) syntax only
- NO lookahead (?=) or lookbehind (?<=) assertions
- NO non-capturing groups (?:)
- NO word boundaries \\b
- NO case-insensitive flags - handle case variations explicitly
- Use basic character classes: [a-z], [0-9], [a-zA-Z0-9]
- Escape special characters: \\., \\-, \\+, \\?, \\*, \\(, \\), \\[, \\], \\{, \\}, \\^, \\$

PATTERN DESIGN PRINCIPLES:
1. Start with ^ and end with $ to match full path
2. Use .* for flexible matching of path segments
3. Handle case variations: [Ii][Pp][Hh][Oo][Nn][Ee] for "iphone"
4. Use [._-]? for optional separators between words
5. Make patterns flexible enough to catch variations but specific enough to avoid false positives
6. Account for URL encoding and common path structures

COMMON URL PATTERN EXAMPLES:
- Product pages: /product/item-name, /shop/category/item, /items/item-name
- Hyphenated names: /product/iphone-15-pro → match "iphone[._-]?15[._-]?pro"
- Version numbers: /item/macbook-pro-2024 → match "macbook[._-]?pro[._-]?[0-9]*"
- Categories: /category/electronics/phones → match in any path segment

REGEX PATTERN EXAMPLES:
For "iphone-15": "^/.*[Ii][Pp][Hh][Oo][Nn][Ee][._-]?15.*$"
For "macbook-pro": "^/.*[Mm][Aa][Cc][Bb][Oo][Oo][Kk][._-]?[Pp][Rr][Oo].*$"
For "airpods": "^/.*[Aa][Ii][Rr][Pp][Oo][Dd][Ss].*$"
For "quarterly-report": "^/.*[Qq][Uu][Aa][Rr][Tt][Ee][Rr][Ll][Yy][._-]?[Rr][Ee][Pp][Oo][Rr][Tt].*$"

SPECIAL CASES:
- Single words: Use case-insensitive character matching
- Multi-word products: Include optional separators [._-]? between words
- Numbers in names: Include literal digits and optional separators
- Unknown products: Use "^/.*$" as catch-all pattern

OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact structure:
{
  "product-name": "^/.*regex-pattern.*$",
  "another-product": "^/.*another-pattern.*$"
}

CRITICAL REQUIREMENTS:
- Include regex for every product provided in the input
- Each regex must be a valid POSIX ERE pattern
- No additional text, explanations, or markdown formatting
- Valid JSON syntax only`;

  const userPrompt = [
    'ANALYSIS REQUEST:',
    'Please generate POSIX-compatible regex patterns for each product based on the grouped URL paths below.',
    '',
    `DOMAIN: ${domain}`,
    '',
    'GROUPED PATHS BY PRODUCT:',
    Object.keys(groupedPaths).map((product) => {
      const paths = groupedPaths[product];
      return `Product: "${product}"\nPaths (${paths.length} total):\n${paths.map((p) => `  ${p}`).join('\n')}`;
    }).join('\n\n'),
    '',
    'REQUIRED OUTPUT:',
    'Return a JSON object with one regex pattern per product, following these requirements:',
    '- Each regex must use POSIX ERE syntax compatible with Amazon Athena SQL',
    '- Patterns should match all provided paths for each product',
    '- Handle case variations explicitly (no case-insensitive flags)',
    '- Use [._-]? for optional separators between words',
    '- Start patterns with ^ and end with $ to match full paths',
    '',
    'EXAMPLE OUTPUT FORMAT:',
    '{',
    '  "iphone-15": "^/.*[Ii][Pp][Hh][Oo][Nn][Ee][._-]?15.*$",',
    '  "macbook-pro": "^/.*[Mm][Aa][Cc][Bb][Oo][Oo][Kk][._-]?[Pp][Rr][Oo].*$"',
    '}',
    '',
    'REMINDER: Return only valid JSON with no additional text or formatting.',
  ].join('\n');

  try {
    log.info('Generating regex patterns for products');
    const content = await prompt(systemPrompt, userPrompt, env);
    if (content) {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        log.info('Successfully generated regex patterns for products');
        return parsed;
      }
      log.warn('Unexpected format received; defaulting to fallback regexes');
      return Object.keys(groupedPaths).reduce((acc, product) => {
        acc[product] = '.*';
        return acc;
      }, {});
    } else {
      log.warn('No content received; defaulting to fallback regexes');
      return Object.keys(groupedPaths).reduce((acc, product) => {
        acc[product] = '.*';
        return acc;
      }, {});
    }
  } catch (error) {
    log.error(`Failed to get regexes for products: ${error.message}`);
    return Object.keys(groupedPaths).reduce((acc, product) => {
      acc[product] = '.*';
      return acc;
    }, {});
  }
}

export async function analyzeProducts(domain, paths, context) {
  const { log } = context;

  log.info(`Starting product analysis for domain: ${domain}`);

  try {
    const pathClassifications = await deriveProductsForPaths(domain, paths, context);
    const groupedPaths = groupPathsByProduct(pathClassifications);
    const regexPatterns = await deriveRegexesForProducts(domain, groupedPaths, context);
    log.info(`Completed product analysis for domain: ${domain}`);
    return regexPatterns;
  } catch (error) {
    log.error(`Product analysis failed: ${error.message}`);
    throw error;
  }
}
/* c8 ignore end */
