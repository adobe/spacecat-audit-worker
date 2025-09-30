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
   - Use the most descriptive category name and create a topic that concisely describes (2-5 words) the intent of the category
   - Do not add/create categories that are not core to the domain's offering (e.g., news category makes sense for a broadcasting domain, but not for a commercial domain)
   - If a domain has a very high number of individual products (e.g., ecommerce websites), create higher level categories rather than individual product categories

2. Limited Standalone Product Identification:
   - Products that are completely unrelated to any other offerings
   - Major business lines that are clearly distinct and cannot be reasonably grouped

3. URL Selection for Groupings:
   - Choose the most generic URL that still represents the product group distinctly
   - Prefer broader paths over specific ones (e.g., "/products/*" over "/products/specific-item/*")
   - If URLs are very specific, generalize to the common parent path
   - Ensure the selected URL can logically encompass all products in the group

4. Output Format:
   - For grouped products: Use the most descriptive category name and create a topic that concisely describes (2-5 words) the intent of the category
   - Maintain the same field structure: category, topic, region, url
   - Remove exact duplicates
   - Each word in category and topic is capitalized
   - Only use alphanumerical characters, spaces and dashes in category and topic


5. Data Quality Rules:
   - If input is empty or invalid, return empty array: []
   - Ensure each output entry has all required fields
   - Maintain regional accuracy
   - Make sure to not exceed 10 consolidated products unless absolutely necessary

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting. Do NOT include markdown formatting, code blocks, or \`\`\`json tags.Return raw JSON only.

Example input:
[
  {"category": "Drive Cloud Storage", "topic": "Personal File Sync", "region": "", "url": "https://example.com/storage*"},
  {"category": "Enterprise File Vault", "topic": "Business Document Storage", "region": "us", "url": "https://example.com/files*"},
  {"category": "Salesforce CRM", "topic": "Lead Management System", "region": "us", "url": "https://example.com/crm*"},
  {"category": "HubSpot Sales Hub", "topic": "Sales Pipeline Automation", "region": "us", "url": "https://example.com/crm-pro*"},
  {"category": "ChatBot Pro", "topic": "Customer Support Automation", "region": "us", "url": "https://example.com/ai*"},
  {"category": "Business Intelligence Suite", "topic": "Sales Performance Analytics", "region": "us", "url": "https://example.com/analytics/business*"},
  {"category": "Marketing Campaign Tracker", "topic": "Campaign ROI Analysis", "region": "us", "url": "https://example.com/analytics/marketing*"}
]

Example output:
[
  {"category": "Enterprise Document Hub", "topic": "Business File Management", "region": "us", "url": "https://example.com/storage*"},
  {"category": "Sales Management Suite", "topic": "Customer Relationship Automation", "region": "us", "url": "https://example.com/crm*"},
  {"category": "Business Analytics Dashboard", "topic": "Performance Intelligence Platform", "region": "us", "url": "https://example.com/analytics*"},
  {"category": "ChatBot Pro", "topic": "Customer Support Automation", "region": "us", "url": "https://example.com/ai*"}
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

  const systemPrompt = `You are an expert product analyst specializing in extracting structured product information from URL patterns.

TASK: Analyze the provided domain and URL list to identify distinct products, services, or content categories offered by this business.

INSTRUCTIONS:

1. Domain Context Analysis:
   - Consider the domain name and business context
   - Identify the primary business type or industry
   - Look for patterns that suggest the company's main offerings

2. URL Pattern Analysis:
   - Examine URL paths, parameters, and structure
   - Identify product/service categories from URL segments
   - Look for patterns that indicate different business areas
   - Consider both explicit product names and implicit categorizations

3. Product/Service Extraction:
   - Extract distinct products, services, or content categories
   - Group related URLs under broader product categories when appropriate
   - Focus on business-relevant categories that would be useful for marketing analysis
   - Do not add/create categories that are not core to the domain's offering (e.g., news category makes sense for a broadcasting domain, but not for a commercial domain)
   - If a domain has a very high number of individual products (e.g., ecommerce websites), create higher level categories rather than individual product categories

4. Geographic and Regional Considerations:
   - Identify any regional or geographic targeting from URLs
   - Note language-specific paths or country codes
   - Consider global vs. regional product offerings

5. Output Requirements:
   - Return a JSON array of product/service insights
   - Each insight should include: category, topic, region, and representative URL
   - Limit to the most significant and distinct offerings (typically 3-10 items)
   - Ensure categories are meaningful for business analysis
   - Each word in category and topic is capitalized
   - Only use alphanumerical characters, spaces and dashes in category and topic

RESPONSE FORMAT: Return only a valid JSON array with this structure. Do NOT include markdown formatting, code blocks, or \`\`\`json tags. Return raw JSON only:
[
  {
    "category": "Primary product/service/series/product line name",
    "topic": "Concise description of the intent of the category/offering/series/product line (2-5 words)",
    "region": "lower case ISO 3166-1 alpha-2 country code based on content language, currency, or explicit regional indicators",
    "url": "The canonical URL; these should not contain query parameters of any kind; always add * at the end of the URL to indicate all subpaths"
  }
]

EXAMPLE OUTPUT:
[
  {"category": "Enterprise Document Hub", "topic": "Business File Management", "region": "us", "url": "https://example.com/storage*"},
  {"category": "Sales Management Suite", "topic": "Customer Relationship Automation", "region": "us", "url": "https://example.com/crm*"},
  {"category": "Business Analytics Dashboard", "topic": "Performance Intelligence Platform", "region": "us", "url": "https://example.com/analytics*"},
  {"category": "ChatBot Pro", "topic": "Customer Support Automation", "region": "us", "url": "https://example.com/ai*"}
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

  const systemPrompt = `You are an expert product analyst specializing in extracting structured product information from web page data.

TASK: Analyze the provided page scrape data and identify the most prominent products actively marketed on the page.

INSTRUCTIONS:
1. Product Identification:
   - Look for offerings that are prominently featured, actively promoted, or central to the page content
   - If multiple products are equally prominent, create separate entries for each
   - Ignore minor mentions, accessories, or secondary offerings
   - Focus on what the business is actively trying to sell or promote

2. Required Fields for Each Product:
   - category: The main offering name (be specific and descriptive)
   - topic: 2-4 relevant keywords that describe the offerings use and/or purpose
   - region: lower case ISO 3166-1 alpha-2 country code based on content language, currency, or explicit regional indicators
   - url: The canonical URL; these should not contain query parameters of any kind; always add * at the end of the URL to indicate all subpaths.

3. Regional Detection Guidelines:
   - Use language indicators (e.g., German content = "de")
   - Look for currency symbols (€ with German = "de", $ with English = "us")
   - Check for explicit country/region mentions
   - Default to "global" if no clear regional indicators exist

4. Data Quality:
   - If no clear products are found, return an empty array: []
   - If scrape data is too minimal or unclear, return an empty array: []
   - Do not consider scrapes that were denied access
   - Ensure each product entry has all required fields
   - Each word in category and topic is capitalized
   - Only use alphanumerical characters, spaces and dashes in category and topic

RESPONSE FORMAT: Return only a valid JSON array with no additional text or formatting. Do NOT include markdown formatting, code blocks, or \`\`\`json tags.Return raw JSON only:

Example outputs:
[{"category": "Enterprise Document Hub", "topic": "Business File Management", "region": "us", "url": "https://example.com/storage*"}]

[{"category": "Sales Management Suite", "topic": "Customer Relationship Automation", "region": "de", "url": "https://example.de/crm*"}, {"category": "Email Marketing Platform", "topic": "Campaign Automation", "region": "de", "url": "https://example.de/email*"}]

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
