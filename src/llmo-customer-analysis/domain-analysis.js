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
   - Prefer broader paths over specific ones (e.g., "/products*" over "/products/specific-item*")
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

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting. Do NOT include markdown formatting, code blocks, or \`\`\`json tags.Return raw JSON only.

    Example input:
      [
        { "category": "Cloud Storage", "topic": "cloud storage", "region": "", "url": "https://example.com/storage*" },
        { "category": "File Storage Service", "topic": "file storage cloud", "region": "us", "url": "https://example.com/files*" },
        { "category": "Enterprise CRM", "topic": "crm enterprise", "region": "us", "url": "https://example.com/crm*" },
        { "category": "CRM Software", "topic": "customer management", "region": "us", "url": "https://example.com/crm-pro*" },
        { "category": "AI Assistant", "topic": "artificial intelligence", "region": "us", "url": "https://example.com/ai*" },
        { "category": "Business Analytics", "topic": "data analytics", "region": "us", "url": "https://example.com/analytics/business*" },
        { "category": "Marketing Analytics", "topic": "marketing data", "region": "us", "url": "https://example.com/analytics/marketing*" }
      ]

Example output:
  [
    { "category": "Cloud Storage Solutions", "topic": "cloud storage file management", "region": "us", "url": "https://example.com/storage*" },
    { "category": "Customer Management Platform", "topic": "crm enterprise customer management", "region": "us", "url": "https://example.com/crm*" },
    { "category": "Analytics Suite", "topic": "data analytics marketing business intelligence", "region": "us", "url": "https://example.com/analytics*" },
    { "category": "AI Assistant", "topic": "artificial intelligence", "region": "us", "url": "https://example.com/ai*" }
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

export async function analyzeDomainFromUrls(domain, urls, context = {}) {
  const { log } = context;
  const insights = [];
  const totalTokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  const systemPrompt = `You are an expert product analyst specializing in identifying core business offerings from URL patterns.

TASK: Analyze the provided domain and URL list to identify distinct PRODUCTS and SERVICES that this business offers to customers.

FOCUS CRITERIA - ONLY INCLUDE:
- Actual products or services that customers can purchase, use, or engage with
- Revenue-generating offerings or core business solutions
- Distinct product lines or service categories

EXCLUDE:
- Support content (help pages, documentation, FAQs, contact pages)
- Marketing content (about pages, company info, careers, press releases)
- Administrative content (login, account settings, terms of service)
- Generic website functionality (search, navigation, error pages)

INSTRUCTIONS:

1. Business Model Analysis:
   - Determine if this is a SaaS company, e-commerce site, service provider, etc.
   - Identify the primary value proposition and customer offerings
   - Focus on revenue-generating products and services

2. Product/Service Identification:
   - Look for URL patterns that indicate actual products or services
   - Examples: /products/, /services/, /solutions/, /plans/, /pricing/
   - Identify distinct product lines or service categories
   - Group related offerings under meaningful business categories

3. Category Definition:
   - Use the exact product or service name as the company calls it
   - Include version numbers, model names, or specific variants if mentioned
   - Capitalize the first character
   - Categories do NOT need to be unique - repeat the same category if it has different topics or regional variations
   - Examples: "iPhone 15 Pro", "Salesforce Sales Cloud", "Adobe Photoshop", "Tesla Model S"

4. Topic Description:
   - Write a concise, generic description of the product/service category
   - Focus on the general type or function, not specific features
   - Keep it brief and capitalize the first letter of each word (Title Case)
   - Different topics can be used for the same category if it serves multiple purposes
   - Examples: "Smartphone", "CRM Software", "Photo Editing Software", "Electric Vehicle"

Required Fields for Each Product/Service:
   - category: Exact product or service name as used by the company (capitalize first character)
   - topic: Concise, generic description of the product/service category (Title Case - capitalize first letter of each word)
   - region: ISO country code if regionally targeted, or "global" if no clear regional targeting
   - url: Representative URL with * wildcard for the product category
RESPONSE FORMAT: Return only a valid JSON array with this structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:
[
  {
    "category": "Exact product or service name",
    "topic": "Concise description of what it is",
    "region": "ISO country code or 'global'",
    "url": "Representative URL with * wildcard"
  }
]

EXAMPLE OUTPUT:
[
  {"category": "iPhone 15 Pro Max", "topic": "Smartphone", "region": "global", "url": "https://apple.com/iphone-15-pro/*"},
  {"category": "iPhone 15 Pro Max", "topic": "Camera Device", "region": "global", "url": "https://apple.com/iphone-15-pro/*"},
  {"category": "Salesforce Sales Cloud", "topic": "CRM Software", "region": "global", "url": "https://salesforce.com/products/sales-cloud/*"},
  {"category": "Adobe Creative Suite", "topic": "Photo Editing Software", "region": "global", "url": "https://adobe.com/products/photoshop/*"},
  {"category": "Adobe Creative Suite", "topic": "Video Editing Software", "region": "global", "url": "https://adobe.com/products/premiere/*"}
]`;

  const userPrompt = `Domain: ${domain}

URL List:
${JSON.stringify(urls, null, 2)}

Please analyze this domain and URL list to extract distinct product/service categories.`;

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
        return { insights: [], usage: totalTokenUsage };
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
    return { insights, usage: totalTokenUsage };
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

  const systemPrompt = `You are an expert product analyst specializing in identifying core business offerings from web page content.

TASK: Analyze the provided page scrape data to identify distinct PRODUCTS and SERVICES that this business offers to customers.

FOCUS CRITERIA - ONLY INCLUDE:
- Actual products or services that customers can purchase, use, or engage with
- Revenue-generating offerings prominently featured on the page
- Core business solutions that are actively marketed

EXCLUDE:
- Support content (help sections, documentation, FAQs)
- Marketing content (about us, company info, careers)
- Administrative content (login, account management, legal pages)
- Generic website functionality (search, navigation)

INSTRUCTIONS:

1. Product/Service Identification:
   - Look for products or services that are prominently featured and actively promoted
   - Focus on what the business is trying to sell or have customers engage with
   - If multiple distinct offerings are equally prominent, create separate entries
   - Ignore minor mentions, accessories, or secondary content

2. Category Definition:
   - Use the exact product or service name as the company calls it
   - Include version numbers, model names, or specific variants if mentioned
   - Capitalize the first character
   - Categories do NOT need to be unique - repeat the same category if it has different topics or regional variations
   - Examples: "iPhone 15 Pro", "Salesforce Sales Cloud", "Adobe Photoshop", "Tesla Model S"

3. Topic Description:
   - Write a concise, generic description of the product/service category
   - Focus on the general type or function, not specific features
   - Keep it brief and capitalize the first letter of each word (Title Case)
   - Different topics can be used for the same category if it serves multiple purposes
   - Examples: "Smartphone", "CRM Software", "Photo Editing Software", "Electric Vehicle"

4. Regional Detection:
   - Use language indicators (German content = "de", French = "fr")
   - Look for currency symbols and regional pricing
   - Check for explicit country/region targeting
   - Default to "global" if no clear regional targeting is detected

5. Data Quality Standards:
   - If no clear products/services are found, return empty array
   - Ignore pages with access denied or minimal content
   - Focus on pages that showcase actual business offerings
   - Ensure each product/service entry has all required fields

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:

EXAMPLE OUTPUTS:
[{"category": "iPhone 15 Pro Max", "topic": "Smartphone", "region": "global", "url": "https://apple.com/iphone-15-pro/*"}, {"category": "iPhone 15 Pro Max", "topic": "Camera Device", "region": "global", "url": "https://apple.com/iphone-15-pro/*"}]

[{"category": "Microsoft Office 365", "topic": "Productivity Software", "region": "de", "url": null}, {"category": "Microsoft Office 365", "topic": "Email Platform", "region": "de", "url": null}]

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
