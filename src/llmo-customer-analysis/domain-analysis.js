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
  const { log, env } = context;

  if (!products || products.length === 0) {
    return [];
  }

  const systemPrompt = `You are an expert product analyst specializing in product categorization and market analysis.

TASK: Analyze the provided product list and create a concentrated version by grouping similar products together, either in higher level categories (i.e. tennis shoe + tennis racket = tennis), or by merging very similar or equivalent products (i.e. Ultra 1 + Ultra 2 = Ultra).

INSTRUCTIONS:

1. Primary Focus - Product Grouping:
   - Merge products that represent the same core offering but with slight variations
   - Create a representative entry for each group with the most comprehensive information
   - Use the most descriptive category name and combine all relevant topics

2. Limited Standalone Product Identification:
   - Products that are completely unrelated to any other offerings
   - Major business lines that are clearly distinct and cannot be reasonably grouped

3. URL Selection for Groupings:
   - Choose the most generic URL that still represents the product group distinctly
   - Prefer broader paths over specific ones (e.g., "/products/*" over "/products/specific-item/*")
   - If URLs are very specific, generalize to the common parent path
   - Ensure the selected URL can logically encompass all products in the group

4. Output Format:
   - For grouped products: Use the most representative category and combine all relevant topics
   - Maintain the same field structure: category, topic, region, url
   - Remove exact duplicates
   - Prioritize aggressive consolidation over granular separation

5. Data Quality Rules:
   - If input is empty or invalid, return empty array: []
   - Ensure each output entry has all required fields
   - Maintain regional accuracy
   - Make sure to not exceed 10 consolidated products unless absolutely necessary

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting.

Example input:
[
  {"category": "Cloud Storage", "topic": "cloud storage", "region": "", "url": "https://example.com/storage/*"},
  {"category": "File Storage Service", "topic": "file storage cloud", "region": "us", "url": "https://example.com/files/*"},
  {"category": "Enterprise CRM", "topic": "crm enterprise", "region": "us", "url": "https://example.com/crm/*"},
  {"category": "CRM Software", "topic": "customer management", "region": "us", "url": "https://example.com/crm-pro/*"},
  {"category": "AI Assistant", "topic": "artificial intelligence", "region": "us", "url": "https://example.com/ai/*"},
  {"category": "Business Analytics", "topic": "data analytics", "region": "us", "url": "https://example.com/analytics/business/*"},
  {"category": "Marketing Analytics", "topic": "marketing data", "region": "us", "url": "https://example.com/analytics/marketing/*"}
]

Example output:
[
  {"category": "Cloud Storage Solutions", "topic": "cloud storage file management", "region": "us", "url": "https://example.com/storage/*"},
  {"category": "Customer Management Platform", "topic": "crm enterprise customer management", "region": "us", "url": "https://example.com/crm/*"},
  {"category": "Analytics Suite", "topic": "data analytics marketing business intelligence", "region": "us", "url": "https://example.com/analytics/*"},
  {"category": "AI Assistant", "topic": "artificial intelligence", "region": "us", "url": "https://example.com/ai/*"}
]`;

  const userPrompt = `Products to concentrate:

\`\`\`json
${JSON.stringify(products, null, 2)}
\`\`\``;

  try {
    const promptResponse = await prompt(systemPrompt, userPrompt, env);
    if (promptResponse && promptResponse.content) {
      let parsedContent;
      try {
        parsedContent = JSON.parse(promptResponse.content);
      } catch (parseError) {
        log.error(`Failed to parse concentration response as JSON: ${parseError.message}`);
        return { products, usage: promptResponse.usage }; // Return original if parsing fails
      }

      // Flexible extraction similar to original function
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

      // Validate concentrated products
      const validatedProducts = concentratedArray
        .filter((product) => product && typeof product === 'object' && product.category)
        .map((product) => ({
          category: product.category,
          topic: product.topic,
          region: product.region,
          url: product.url,
        }));

      log.info(`Concentrated ${products.length} products into ${validatedProducts.length} products`);
      return { products: validatedProducts, usage: promptResponse.usage };
    }
  } catch (err) {
    log.error(`Failed to concentrate products: ${err.message}`);
    return { products, usage: null }; // Return original array if concentration fails
  }

  return { products, usage: null };
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

  const systemPrompt = `You are an expert product analyst specializing in extracting structured product information from web page data.

TASK: Analyze the provided page scrape data and identify the most prominent products actively marketed on the page.

INSTRUCTIONS:
1. Product Identification:
   - Look for products that are prominently featured, actively promoted, or central to the page content
   - If multiple products are equally prominent, create separate entries for each
   - Ignore minor mentions, accessories, or secondary offerings
   - Focus on what the business is actively trying to sell or promote

2. Required Fields for Each Product:
   - category: The main product name or category (be specific and descriptive)
   - topic: 2-4 relevant keywords that describe the product's domain/industry
   - region: lower case ISO 3166-1 alpha-2 country code based on content language, currency, or explicit regional indicators
   - url: The canonical URL if available in the scrape data, otherwise null; these should not contain query parameters of any kind; always add /* at the end of the URL to indicate all subpaths

3. Regional Detection Guidelines:
   - Use language indicators (e.g., German content = "de")
   - Look for currency symbols (€ with German = "de", $ with English = "us")
   - Check for explicit country/region mentions
   - Default to "US" if no clear regional indicators exist

4. Data Quality:
   - If no clear products are found, return an empty array: []
   - If scrape data is too minimal or unclear, return an empty array: []
   - Do not consider scrapes that were denied access
   - Ensure each product entry has all required fields

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting:

Example outputs:
[{"category": "Cloud Storage Service", "topic": "cloud storage enterprise", "region": "us", "url": "https://example.com/storage"}]

[{"category": "CRM Software", "topic": "customer relationship management", "region": "de", "url": null}, {"category": "Email Marketing Platform", "topic": "email automation marketing", "region": "de", "url": null}]

[]`;

  log.info(`Starting domain analysis for ${domain}`);

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

Scrape Data:
\`\`\`json
${stringified}
\`\`\``;

    try {
      // eslint-disable-next-line no-await-in-loop
      const promptResponse = await prompt(systemPrompt, userPrompt, env);
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
