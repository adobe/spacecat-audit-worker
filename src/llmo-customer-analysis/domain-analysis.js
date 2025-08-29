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

export default async function analyzedDomain(domain, scrapes, context = {}) {
  const { log, env, s3Client } = context;
  const { S3_SCRAPER_BUCKET_NAME } = env;
  const insights = [];

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
   - Use language indicators (e.g., German content = "DE")
   - Look for currency symbols (€ with German = "DE", $ with English = "US")
   - Check for explicit country/region mentions
   - Default to "US" if no clear regional indicators exist

4. Data Quality:
   - If no clear products are found, return an empty array: []
   - If scrape data is too minimal or unclear, return an empty array: []
   - Ensure each product entry has all required fields

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting:

Example outputs:
[{"category": "Cloud Storage Service", "topic": "cloud storage enterprise", "region": "US", "url": "https://example.com/storage"}]

[{"category": "CRM Software", "topic": "customer relationship management", "region": "DE", "url": null}, {"category": "Email Marketing Platform", "topic": "email automation marketing", "region": "DE", "url": null}]

[]`;

  log.info(`Starting domain analysis for ${domain}`);

  let counter = 0;
  for (const scrape of scrapes) {
    if (counter === 10) break;
    counter += 1;
    // eslint-disable-next-line no-await-in-loop
    const data = await getObjectFromKey(s3Client, S3_SCRAPER_BUCKET_NAME, scrape.path);
    const { scrapeResult } = data;
    log.info('Scrape retrieved; starting analysis');

    // Build an object containing only the requested fields from scrapeResult if they exist
    // TODO:: Create a handler in spacecat-content-scraper
    const filtered = {};
    if ('tags' in scrapeResult) filtered.tags = scrapeResult.tags;
    if ('canonical' in scrapeResult) filtered.canonical = scrapeResult.canonical;
    if (scrapeResult.structuredData && scrapeResult.structuredData.microdata && 'Product' in scrapeResult.structuredData.microdata) {
      filtered.products = Array.isArray(scrapeResult.structuredData.microdata.Product)
        ? scrapeResult.structuredData.microdata.Product?.slice(0, 10)
        : scrapeResult.structuredData.microdata.Product;
    }

    if (Object.keys(filtered).length === 0 || !('products' in filtered)) {
      filtered.rawResult = scrapeResult.rawBody.slice(0, 20000);
    }

    const stringified = JSON.stringify(filtered);

    const userPrompt = `# Product Extraction Task

## Target Domain
**Domain:** ${domain}

## Scrape Data Analysis
Please analyze the following scraped data to identify prominent products:

\`\`\`json
${stringified}
\`\`\`

## Instructions
- Focus on the most prominent products actively marketed on this page
- Extract structured product information as specified in the system prompt
- Return only valid JSON array format`;

    try {
      // eslint-disable-next-line no-await-in-loop
      const rawContent = await prompt(systemPrompt, userPrompt, env);
      if (rawContent) {
        let parsedContent;
        try {
          parsedContent = JSON.parse(rawContent);
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
  return insights;
}
/* c8 ignore end */
