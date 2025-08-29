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
  const { env, log } = context;
  const systemPrompt = `You are a web page classification expert. Analyze URL paths to determine their page type based on common web patterns and conventions.

**Task**: Classify each URL path for the given domain and return results in the exact JSON format specified below.

**Classification Guidelines**:
- **homepage**: Root path "/" or main landing pages
- **product**: Individual product/item pages (e.g., /products/item-123, /shop/product-name)
- **category**: Product category/listing pages (e.g., /products, /shop, /categories/shoes)
- **blog**: Blog posts and articles (e.g., /blog/post-title, /news/article)
- **about**: About us, company info, team pages
- **help**: Support, FAQ, documentation, tutorials
- **legal**: Privacy policy, terms, legal documents
- **search**: Search results pages
- **contact**: Contact us, support contact forms
- **cart**: Shopping cart pages
- **checkout**: Payment and checkout flow pages
- **other**: Any page that doesn't fit the above categories

**Classification Rules**:
1. Analyze URL structure, keywords, and common web conventions
2. Look for path segments that indicate functionality (e.g., "product", "category", "blog")
3. Consider numeric IDs as indicators of individual items (product pages)
4. Use the most specific applicable type
5. When uncertain, default to "other"

**Required Response Format**:
Return ONLY valid JSON with this exact structure:
{
  "paths": [
    { "path": "/", "pageType": "homepage" },
    { "path": "/about", "pageType": "about" },
    { "path": "/products/123", "pageType": "product" }
  ]
}

**Important**:
- Include ALL provided paths in your response
- Use only the specified pageType values
- Do not include explanations or additional text
- Ensure valid JSON syntax`;

  const userPrompt = [
    'Classify each URL path for the following domain according to the page type categories defined above.',
    '',
    `Domain: ${domain}`,
    '',
    'URL Paths to classify:',
    JSON.stringify(paths, null, 2),
    '',
    'Remember:',
    '- Classify ALL provided paths',
    '- Return ONLY the JSON response in the specified format',
    '- Use only the predefined pageType values',
    '- When uncertain, use "other"',
  ].join('\n');

  try {
    log.info('Extracting page types from URL paths');
    const content = await prompt(systemPrompt, userPrompt, env);
    if (content) {
      const { paths: parsedPaths } = JSON.parse(content);
      log.info('Successfully extracted page types from URL paths');
      return parsedPaths;
    } else {
      log.info('No content received; defaulting all paths to "other"');
      return paths.map((path) => ({ path, pageType: 'other' }));
    }
  } catch (error) {
    log.error(`Failed to get page types for paths: ${error.message}`);
    return paths.map((path) => ({ path, pageType: 'other' }));
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
  const { env, log } = context;

  const systemPrompt = 'For the given domain and groups of paths below, generate a POSIX-compatible regex string for each pageType that works in Amazon Athena SQL. Avoid lookahead, lookbehind, and non-standard modifiers. Return ONLY valid JSON in the format: { "homepage": "^/$", "about": "^/about$", ... }.';

  const userPrompt = [
    'Generate regexes for the following domain and grouped paths:',
    `Domain: ${domain}`,
    JSON.stringify(groupedPaths),
  ].join('\n\n');

  try {
    log.info('Generating regex patterns for page types');
    const content = await prompt(systemPrompt, userPrompt, env);
    if (content) {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        log.info('Successfully generated regex patterns for page types');
        return parsed;
      }

      log.warn('Unexpected response received; defaulting to fallback regexes');
      return Object.keys(groupedPaths).reduce((acc, type) => {
        acc[type] = '.*';
        return acc;
      }, {});
    } else {
      log.warn('No content received; defaulting to fallback regexes');
      return Object.keys(groupedPaths).reduce((acc, type) => {
        acc[type] = '.*';
        return acc;
      }, {});
    }
  } catch (error) {
    log.error(`Failed to generate regexes for page types: ${error.message}`);
    return Object.keys(groupedPaths).reduce((acc, type) => {
      acc[type] = '.*';
      return acc;
    }, {});
  }
}

export async function analyzePageTypes(domain, paths, context) {
  const { log } = context;

  log.info(`Starting page type analysis for domain: ${domain}`);

  try {
    const pathClassifications = await derivePageTypesForPaths(domain, paths, context);
    const groupedPaths = groupPathsByPageType(pathClassifications);
    const regexPatterns = await deriveRegexesForPageTypes(domain, groupedPaths, context);
    log.info(`Page type analysis complete for domain: ${domain}`);
    return regexPatterns;
  } catch (error) {
    log.error(`Failed to complete page type analysis: ${error.message}`);
    throw error;
  }
}
/* c8 ignore end */
