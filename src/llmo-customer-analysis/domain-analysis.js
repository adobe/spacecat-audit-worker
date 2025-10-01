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
import { getObjectFromKey } from '../utils/s3-utils.js';
import { prompt } from './utils.js';

async function concentrateProducts(products, context = {}) {
  const { log } = context;

  if (!products || products.length === 0) {
    return [];
  }

  const systemPrompt = `You are an expert product analyst specializing in strategic business categorization and market analysis.

TASK: Analyze the provided product list and create a concentrated version with EXACTLY 2 high-level categories, each containing EXACTLY 2 topics (4 total entries).

CRITICAL CONSTRAINTS:
- Output must contain EXACTLY 2 categories (no more, no less)
- Each category must have EXACTLY 2 topics (total of 4 entries)
- ALL 4 entries MUST share the SAME region value

STRATEGIC CATEGORIZATION APPROACH:
Given the constraint of only 2 categories, you must think strategically about the highest-level business segments:
- Focus on TOP-LEVEL BUSINESS AREAS rather than individual products
- Create BROADER STRATEGIC CATEGORIES that group related offerings into meaningful business segments
- Think in terms of MAJOR BUSINESS LINES that would be useful for marketing analysis
- Group related products/services into higher-level categories (e.g., "Cloud Services" instead of "File Storage", "Email Service", "Backup Service")
- Avoid granular product-specific categories - aim for business segment level

INSTRUCTIONS:

1. Region Determination (HIGHEST PRIORITY - FOCUS ON FIRST ENTRY):
   - The input product list is sorted by relevance/traffic, with the FIRST entry being the most important
   - The FIRST entry's region is the PRIMARY indicator for region determination
   - If the first entry has a region value, use that region for ALL 4 output entries
   - If multiple regions exist in the input, prioritize the region from the first entry
   - Only if the first entry lacks a region or it's unclear, analyze other entries or default to "us"
   - Apply this SAME region value to ALL 4 output entries

2. Category Selection (EXACTLY 2 - THINK BIG PICTURE):
   - Identify the 2 HIGHEST-LEVEL, most significant business segments
   - Merge ALL related products into these 2 broad strategic categories
   - Use descriptive names that represent entire business areas, not individual products
   - Examples of strategic categories: "Enterprise Software Solutions", "Professional Services", "Digital Products", "Hardware & Equipment"
   - Do NOT create product-specific categories like "Product X" or "Service Y"

3. Topic Assignment (EXACTLY 2 per category):
   - For each of the 2 categories, identify the 2 most important sub-segments or variations
   - Topics should represent meaningful subdivisions within the category
   - Create a topic that concisely describes (2-5 words) the intent of each sub-segment
   - Each word in category and topic is capitalized
   - Only use alphanumerical characters, spaces and dashes in category and topic

4. URL Selection:
   - Choose the most generic URL that represents the entire category/topic
   - Prefer broader paths over specific ones (e.g., "/products/*" over "/products/specific-item/*")
   - Generalize to the common parent path that encompasses all related offerings
   - Ensure the selected URL can logically encompass all products in the group

5. Output Format:
   - Maintain the same field structure: category, topic, region, url
   - Remove exact duplicates
   - MUST return exactly 4 entries (2 categories × 2 topics each)
   - ALL entries MUST have the SAME region value

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only.

Example input:
[
  {"category": "Drive Cloud Storage", "topic": "Personal File Sync", "region": "us", "url": "https://example.com/storage*"},
  {"category": "Enterprise File Vault", "topic": "Business Document Storage", "region": "us", "url": "https://example.com/files*"},
  {"category": "Salesforce CRM", "topic": "Lead Management System", "region": "us", "url": "https://example.com/crm*"},
  {"category": "HubSpot Sales Hub", "topic": "Sales Pipeline Automation", "region": "us", "url": "https://example.com/crm-pro*"},
  {"category": "ChatBot Pro", "topic": "Customer Support Automation", "region": "us", "url": "https://example.com/ai*"},
  {"category": "Business Intelligence Suite", "topic": "Sales Performance Analytics", "region": "us", "url": "https://example.com/analytics/business*"},
  {"category": "Marketing Campaign Tracker", "topic": "Campaign ROI Analysis", "region": "us", "url": "https://example.com/analytics/marketing*"}
]

Example output (EXACTLY 2 categories, EXACTLY 2 topics each, ALL same region):
[
  {"category": "Enterprise Document Hub", "topic": "Personal File Sync", "region": "us", "url": "https://example.com/storage*"},
  {"category": "Enterprise Document Hub", "topic": "Business Document Storage", "region": "us", "url": "https://example.com/files*"},
  {"category": "Sales Management Suite", "topic": "Lead Management System", "region": "us", "url": "https://example.com/crm*"},
  {"category": "Sales Management Suite", "topic": "Sales Pipeline Automation", "region": "us", "url": "https://example.com/crm-pro*"}
]`;

  const userPrompt = `Products to concentrate:

\`\`\`json
${JSON.stringify(products, null, 2)}
\`\`\``;

  try {
    const promptResponse = await prompt(systemPrompt, userPrompt, context);
    if (promptResponse && promptResponse.content) {
      let parsedContent;
      try {
        parsedContent = JSON.parse(promptResponse.content);
      } catch (parseError) {
        log.error(`Failed to parse concentration response as JSON: ${parseError.message}`);
        return { products, usage: promptResponse.usage }; // Return original if parsing fails
      }

      let concentratedArray;
      if (Array.isArray(parsedContent)) {
        concentratedArray = parsedContent;
      } else if (parsedContent && typeof parsedContent === 'object') {
        if (Array.isArray(parsedContent.products)) {
          concentratedArray = parsedContent.products;
        } else if (Array.isArray(parsedContent.data)) {
          concentratedArray = parsedContent.data;
        } else if (Array.isArray(parsedContent.items)) {
          concentratedArray = parsedContent.items;
        } else {
          concentratedArray = [parsedContent];
        }
      } else {
        log.warn('Unexpected concentration response structure received');
        return products;
      }

      const concentratedProducts = concentratedArray
        .filter((product) => product && typeof product === 'object' && product.category)
        .map((product) => ({
          category: product.category,
          topic: product.topic,
          region: product.region,
          url: product.url,
        }));

      log.info(`Concentrated ${products.length} products into ${concentratedProducts.length} products`);
      return { products: concentratedProducts, usage: promptResponse.usage };
    }
  } catch (err) {
    log.error(`Failed to concentrate products: ${err.message}`);
    return { products, usage: null };
  }

  return { products, usage: null };
}

export async function analyzeDomainFromUrls(domain, urls, context = {}) {
  const { log } = context;
  const insights = [];
  const totalTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  log.info(`Starting URL-based domain analysis for domain: ${domain} with ${urls?.length || 0} URLs`);

  const systemPrompt = `You are an expert product analyst specializing in strategic business categorization from URL patterns.

TASK: Analyze the provided domain and URL list to identify EXACTLY 2 high-level business categories, each with EXACTLY 2 topics (4 total entries).

CRITICAL CONSTRAINTS:
- Output must contain EXACTLY 2 categories (no more, no less)
- Each category must have EXACTLY 2 topics (total of 4 entries)
- ALL 4 entries MUST share the SAME region value

STRATEGIC CATEGORIZATION APPROACH:
Given the constraint of only 2 categories, you must think strategically about the highest-level business segments:
- Focus on TOP-LEVEL BUSINESS AREAS rather than individual products
- Create BROADER STRATEGIC CATEGORIES that group related offerings into meaningful business segments
- Think in terms of MAJOR BUSINESS LINES that would be useful for marketing analysis
- Group related products/services into higher-level categories (e.g., "Cloud Services" instead of listing individual services)
- Avoid granular product-specific categories - aim for business segment level

INSTRUCTIONS:

1. Region Determination (HIGHEST PRIORITY - FOCUS ON FIRST URL):
   - The URL list is sorted by traffic, with the FIRST URL being the MOST VISITED page
   - The FIRST URL is the PRIMARY indicator for region detection
   - Analyze the FIRST URL's domain TLD to determine the region:
     * Country-specific TLDs: .uk/.co.uk → "gb", .de → "de", .ca → "ca", .au → "au", .fr → "fr", etc.
     * Language-specific paths in first URL: /en-us/ → "us", /de-de/ → "de", /fr-fr/ → "fr"
     * If first URL has ambiguous TLD (.com, .org, .net), check for language paths or default to "us"
   - Apply this SAME region value to ALL 4 output entries
   - The region MUST be consistent across all entries

2. Domain Context Analysis:
   - Consider the domain name and business context
   - Identify the primary business type or industry
   - Look for patterns in URLs that suggest the company's main business areas

3. Category Selection (EXACTLY 2 - THINK BIG PICTURE):
   - Identify the 2 HIGHEST-LEVEL, most significant business segments from URL patterns
   - Merge ALL related URLs into these 2 broad strategic categories
   - Use descriptive names that represent entire business areas, not individual products
   - Examples of strategic categories: "Enterprise Software Solutions", "Professional Services", "Digital Products", "Hardware & Equipment"
   - Do NOT create product-specific categories like "Product X" or "Service Y"

4. Topic Assignment (EXACTLY 2 per category):
   - For each of the 2 categories, identify the 2 most important sub-segments or variations
   - Topics should represent meaningful subdivisions within the category
   - Create a topic that concisely describes (2-5 words) the intent of each sub-segment
   - Each word in category and topic is capitalized
   - Only use alphanumerical characters, spaces and dashes in category and topic

5. URL Selection:
   - Choose the most representative URL for each topic
   - Prefer broader paths that encompass multiple related offerings
   - The canonical URL should not contain query parameters of any kind
   - Always add * at the end of the URL to indicate all subpaths

RESPONSE FORMAT: Return only a valid JSON array with this structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:
[
  {
    "category": "High-level business segment name",
    "topic": "Concise description of the sub-segment (2-5 words)",
    "region": "lower case ISO 3166-1 alpha-2 country code - MUST be determined from FIRST URL's TLD",
    "url": "The canonical URL; these should not contain query parameters of any kind; always add * at the end of the URL to indicate all subpaths"
  }
]

EXAMPLE OUTPUT (EXACTLY 2 categories, EXACTLY 2 topics each, ALL same region based on first URL):
[
  {"category": "Enterprise Document Hub", "topic": "Personal File Sync", "region": "us", "url": "https://example.com/storage*"},
  {"category": "Enterprise Document Hub", "topic": "Business Document Storage", "region": "us", "url": "https://example.com/files*"},
  {"category": "Sales Management Suite", "topic": "Lead Management System", "region": "us", "url": "https://example.com/crm*"},
  {"category": "Sales Management Suite", "topic": "Sales Pipeline Automation", "region": "us", "url": "https://example.com/crm-pro*"}
]`;

  const userPrompt = `Domain: ${domain}

URL List (sorted by traffic - FIRST URL is the MOST VISITED page):
${JSON.stringify(urls, null, 2)}

IMPORTANT: The FIRST URL in the list above is the most visited page. Use its domain TLD as the PRIMARY indicator for region detection. Apply the same region to all 4 output entries.

Please analyze this domain and URL list to extract the 2 highest-level business categories with 2 topics each.`;

  try {
    log.info(`Starting URL-based domain analysis for domain: ${domain} with ${urls.length} URLs`);
    const promptResponse = await prompt(systemPrompt, userPrompt, context, 'gpt-4o-mini');

    if (promptResponse && promptResponse.content) {
      // Track token usage
      if (promptResponse.usage) {
        totalTokenUsage.prompt_tokens += promptResponse.usage.prompt_tokens || 0;
        totalTokenUsage.completion_tokens += promptResponse.usage.completion_tokens || 0;
        totalTokenUsage.total_tokens += promptResponse.usage.total_tokens || 0;
      }

      let parsedContent;
      try {
        parsedContent = JSON.parse(promptResponse.content);
      } catch (parseError) {
        log.error(`Failed to parse URL-based domain analysis response as JSON: ${parseError.message}`);
        return insights;
      }

      if (Array.isArray(parsedContent)) {
        insights.push(...parsedContent);
        log.info(`Successfully extracted ${parsedContent.length} product categories from URL analysis`);
      } else {
        log.warn('URL-based domain analysis response was not an array, skipping');
      }
    } else {
      log.warn('No content received from URL-based domain analysis');
    }

    // Log total token usage
    log.info(`Total token usage for URL-based domain analysis: ${JSON.stringify(totalTokenUsage)}`);

    log.info(`URL-based domain analysis complete for domain: ${domain}`);
    return insights;
  } catch (error) {
    log.error(`Failed to complete URL-based domain analysis: ${error.message}`);
    throw error;
  }
}

export default async function analyzeDomain(domain, scrapes, context = {}) {
  const { log, env, s3Client } = context;
  const { S3_SCRAPER_BUCKET_NAME } = env;
  const insights = [];
  const totalTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  log.info(`Starting domain analysis for ${domain}`);

  // Note: Scrapes are sorted by traffic, with the first scrape being the most visited page
  let isFirstScrape = true;

  const systemPrompt = `You are an expert product analyst specializing in extracting structured product information from web page data.

TASK: Analyze the provided page scrape data and identify the most prominent products actively marketed on the page.

IMPORTANT: The output from multiple scrapes will be combined and concentrated into EXACTLY 2 high-level categories with EXACTLY 2 topics each (4 total entries), all sharing the SAME region value. Your task is to extract products from THIS scrape that will contribute to that final structure.

STRATEGIC FOCUS:
- Think about BROADER BUSINESS SEGMENTS rather than individual products
- Extract offerings that can be grouped into higher-level categories
- Focus on what the business is actively trying to sell or promote at a strategic level

INSTRUCTIONS:
1. Product Identification:
   - Look for offerings that are prominently featured, actively promoted, or central to the page content
   - If multiple products are equally prominent, create separate entries for each
   - Ignore minor mentions, accessories, or secondary offerings
   - Focus on what the business is actively trying to sell or promote

2. Required Fields for Each Product:
   - category: The main offering name (be specific and descriptive, but think in terms of business segments)
   - topic: 2-4 relevant keywords that describe the offerings use and/or purpose
   - region: lower case ISO 3166-1 alpha-2 country code based on canonical URL's TLD or content indicators
   - url: The canonical URL; these should not contain query parameters of any kind; always add * at the end of the URL to indicate all subpaths

3. Region Detection Guidelines:
   - Analyze the canonical URL's domain TLD to determine the region:
     * Country-specific TLDs: .uk/.co.uk → "gb", .de → "de", .ca → "ca", .au → "au", .fr → "fr", etc.
     * If TLD is ambiguous (.com, .org, .net), look for:
       - Language used in content (German → "de", French → "fr", Spanish → "es")
       - Currency symbols (€ with German → "de", £ → "gb", $ → "us")
       - Explicit country/region mentions
     * Default to "us" if region cannot be determined
   - Be consistent: use the same region for all products extracted from this scrape

4. Data Quality:
   - If no clear products are found, return an empty array: []
   - If scrape data is too minimal or unclear, return an empty array: []
   - Do not consider scrapes that were denied access
   - Ensure each product entry has all required fields
   - Each word in category and topic is capitalized
   - Only use alphanumerical characters, spaces and dashes in category and topic

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:

Example outputs:
[{"category": "Enterprise Document Hub", "topic": "Business File Management", "region": "us", "url": "https://example.com/storage*"}]

[{"category": "Sales Management Suite", "topic": "Customer Relationship Automation", "region": "de", "url": "https://example.de/crm*"}, {"category": "Email Marketing Platform", "topic": "Campaign Automation", "region": "de", "url": "https://example.de/email*"}]

[]`;

  for (const scrape of scrapes) {
    // eslint-disable-next-line no-await-in-loop
    const data = await getObjectFromKey(s3Client, S3_SCRAPER_BUCKET_NAME, scrape);
    const { scrapeResult } = data;
    log.info('Scrape retrieved; starting analysis');

    // Build an object containing only the requested fields from scrapeResult if they exist
    // TODO:: Create a handler in spacecat-content-scraper
    const filtered = {};
    if ('tags' in scrapeResult) filtered.tags = scrapeResult.tags;
    if ('canonical' in scrapeResult) filtered.canonical = scrapeResult.canonical;
    if (scrapeResult.structuredData && scrapeResult.structuredData.microdata && 'Product' in scrapeResult.structuredData.microdata) {
      filtered.products = Array.isArray(scrapeResult.structuredData.microdata.Product)
        ? scrapeResult.structuredData.microdata.Product?.slice(0, 5)
        : scrapeResult.structuredData.microdata.Product;
    }

    if (Object.keys(filtered).length === 0 || !('products' in filtered)) {
      filtered.rawResult = scrapeResult.rawBody.slice(0, 10000);
    }

    const stringified = JSON.stringify(filtered);

    const userPrompt = `Domain: ${domain}
${isFirstScrape ? '\n⚠️ IMPORTANT: This is the FIRST scrape (MOST VISITED page). The canonical URL in this scrape is the PRIMARY indicator for region detection. Use its domain TLD to determine the region for ALL products across ALL scrapes.\n' : ''}
Scrape Data:
\`\`\`json
${stringified}
\`\`\``;

    try {
      // eslint-disable-next-line no-await-in-loop
      const promptResponse = await prompt(systemPrompt, userPrompt, context, 'gpt-4o-mini');
      if (promptResponse && promptResponse.content) {
        // Track token usage
        if (promptResponse.usage) {
          totalTokenUsage.prompt_tokens += promptResponse.usage.prompt_tokens || 0;
          totalTokenUsage.completion_tokens += promptResponse.usage.completion_tokens || 0;
          totalTokenUsage.total_tokens += promptResponse.usage.total_tokens || 0;
        }

        let parsedContent;
        try {
          parsedContent = JSON.parse(promptResponse.content);
        } catch (parseError) {
          log.error(`Failed to parse response as JSON; continuing to next scrape - ${parseError.message}`);
          // eslint-disable-next-line no-continue
          continue;
        }

        // Flexible extraction
        let productArray;
        if (Array.isArray(parsedContent)) {
          productArray = parsedContent;
        } else if (parsedContent && typeof parsedContent === 'object') {
          if (Array.isArray(parsedContent.products)) {
            productArray = parsedContent.products;
          } else if (Array.isArray(parsedContent.data)) {
            productArray = parsedContent.data;
          } else if (Array.isArray(parsedContent.items)) {
            productArray = parsedContent.items;
          } else {
            productArray = [parsedContent];
          }
        } else {
          log.info('Unexpected response structure received; continuing to next scrape');
          // eslint-disable-next-line no-continue
          continue;
        }

        if (productArray && productArray.length > 0) {
          productArray.forEach((product) => {
            if (product && typeof product === 'object' && product.category) {
              const {
                category, topic, region, url,
              } = product;
              insights.push({
                category,
                topic,
                region,
                url,
              });
            } else {
              log.warn(`Invalid product object structure obtained during extraction: ${JSON.stringify(product)}`);
            }
          });
          log.info(`Extracted ${productArray.length} products from scrape.`);
        } else {
          log.info('No products found in this scrape.');
        }
      }
    } catch (err) {
      log.error(`Failed to extract products from scrape: ${err.message}`);
    }

    isFirstScrape = false;
  }

  const concentratedInsights = await concentrateProducts(insights, context);

  // Track token usage from concentration step
  if (concentratedInsights.usage) {
    totalTokenUsage.prompt_tokens += concentratedInsights.usage.prompt_tokens || 0;
    totalTokenUsage.completion_tokens += concentratedInsights.usage.completion_tokens || 0;
    totalTokenUsage.total_tokens += concentratedInsights.usage.total_tokens || 0;
  }

  // Log total token usage before returning
  log.info(`Total token usage for domain analysis: ${JSON.stringify(totalTokenUsage)}`);

  return concentratedInsights.products;
}
/* c8 ignore end */
