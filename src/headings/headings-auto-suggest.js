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

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { getPrompt } from '@adobe/spacecat-shared-utils';

const EXPIRY_IN_SECONDS = 25 * 60;

/**
 * Returns the pre-signed url for a AWS S3 object with a defined expiry.
 * This url will be consumed by Azure OpenAI API to access the scraped content.
 * Pre-signed URl format: https://{bucket}.s3.{region}.amazonaws.com/{object-path}?{query-params}
 * @param s3Client
 * @param log
 * @param scrapedData
 * @returns {Promise<string>} Presigned url
 */
async function getPresignedUrl(s3Client, log, scrapedData) {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_SCRAPER_BUCKET_NAME,
      Key: scrapedData.s3key,
    });
    return await getSignedUrl(s3Client, command, {
      expiresIn: EXPIRY_IN_SECONDS,
    });
  } catch (error) {
    log.error(`Error generating presigned URL for ${scrapedData.s3key}:`, error);
    return '';
  }
}

/**
 * Downloads and extracts HTML elements from an S3 presigned URL
 * @param {string} presignedUrl - The presigned URL to download content from
 * @returns {Promise<Object>} Object containing mainContent, title, h1, description
 */
async function getScrapedData(presignedUrl) {
  try {
    if (!presignedUrl) {
      throw new Error("Presigned url can't be empty");
    }

    const response = await fetch(presignedUrl);
    const data = await response.json();
    const { rawBody, tags } = data.scrapeResult;

    if (!rawBody || !tags) {
      throw new Error("Invalid JSON structure: Missing 'rawBody' or 'tags'");
    }

    // Extract main content (first 3000 characters)
    const mainContent = rawBody.replace(/\s+/g, ' ').trim().substring(0, 3000);

    return {
      mainContent,
      title: tags.title || null,
      h1: tags.h1 || null,
      description: tags.description || null,
    };
  } catch (error) {
    throw new Error(`Error downloading or processing scraped content: ${error.message}`);
  }
}

/**
 * Generates brand guidelines using Azure OpenAI based on healthy headings
 * @param {Object} params - Parameters including azureOpenAIClient
 * @param {string} baseUrl - Base URL of the site
 * @param {Object} healthyHeadings - Object containing healthy heading examples
 * @returns {Promise<Object>} Object containing brandGuidelines and conversation_identifier
 */
async function getBrandGuidelines(params, baseUrl, healthyHeadings) {
  const { azureOpenAIClient, log } = params;

  log.info('[Headings Auto-Suggest] Generating brand guidelines using Azure OpenAI');
  log.debug(`[Headings Auto-Suggest] Brand guidelines prompt parameters - Base URL: ${baseUrl}, Healthy headings count: ${Object.keys(healthyHeadings).length}`);

  const prompt = await getPrompt(
    {
      baseUrl,
      healthyHeadings: JSON.stringify(healthyHeadings),
    },
    'headings-brand-guidelines',
    log,
  );

  log.debug(`[Headings Auto-Suggest] Brand guidelines prompt generated, length: ${prompt.length} chars`);

  const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
    responseFormat: 'json_object',
  });

  if (!aiResponse?.choices?.[0]?.message?.content) {
    log.error(`[Headings Auto-Suggest] Invalid AI response for brand guidelines: ${JSON.stringify(aiResponse)}`);
    throw new Error(
      `Invalid AI response received while generating brand guidelines: ${JSON.stringify(aiResponse)}`,
    );
  }

  const brandGuidelines = aiResponse.choices[0].message.content;
  log.info(`[Headings Auto-Suggest] Azure OpenAI generated brand guidelines successfully. Length: ${brandGuidelines.length} chars`);
  log.debug(`[Headings Auto-Suggest] Brand guidelines preview: ${brandGuidelines.substring(0, 200)}...`);

  return {
    brandGuidelines,
    conversation_identifier: aiResponse.id,
  };
}

/**
 * Generates AI suggestions for headings using Azure OpenAI
 * @param {Object} params - Parameters including azureOpenAIClient
 * @param {string} endpoint - The endpoint/URL being processed
 * @param {Object} scrapedData - Scraped content data
 * @param {string} baseUrl - Base URL of the site
 * @param {string} brandGuidelines - Brand guidelines for consistency
 * @param {Object} allAiResponses - Object to store all AI responses
 */
async function generateSuggestions(
  params,
  endpoint,
  scrapedData,
  baseUrl,
  brandGuidelines,
  allAiResponses,
) {
  const { azureOpenAIClient, log } = params;

  try {
    log.debug(`[Headings Auto-Suggest] Generating suggestions for endpoint: ${endpoint}`);
    log.debug(`[Headings Auto-Suggest] Scraped data for ${endpoint} - Content length: ${scrapedData.mainContent?.length || 0} chars, Title: ${scrapedData.title || 'N/A'}, H1: ${scrapedData.h1 || 'N/A'}`);

    const prompt = await getPrompt(
      {
        baseUrl,
        endpoint,
        brandGuidelines,
        scrapedData: JSON.stringify(scrapedData),
      },
      'headings-suggestions',
      log,
    );

    log.debug(`[Headings Auto-Suggest] Suggestions prompt generated for ${endpoint}, length: ${prompt.length} chars`);

    const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
      responseFormat: 'json_object',
    });

    if (!aiResponse?.choices?.[0]?.message?.content) {
      log.warn(`[Headings Auto-Suggest] No suggestions found for ${endpoint} - Invalid AI response`);
      return;
    }

    const suggestions = JSON.parse(aiResponse.choices[0].message.content);
    // eslint-disable-next-line no-param-reassign
    allAiResponses[endpoint] = suggestions;

    log.debug(`[Headings Auto-Suggest] Successfully generated suggestions for ${endpoint}. Heading types: ${Object.keys(suggestions).join(', ')}`);
  } catch (error) {
    log.error(`[Headings Auto-Suggest] Error generating suggestions for ${endpoint}: ${error.message}`);
    throw error;
  }
}

export default async function headingsAutoSuggest(allHeadings, context, site, options = {
  forceAutoSuggest: false,
}) {
  // Validate required parameters
  if (!context) {
    throw new Error('Context object is required for headingsAutoSuggest');
  }

  if (!site) {
    throw new Error('Site object is required for headingsAutoSuggest');
  }

  if (!allHeadings) {
    throw new Error('AllHeadings object is required for headingsAutoSuggest');
  }

  const { s3Client, dataAccess, log } = context;
  // Validate required context properties
  if (!s3Client || !dataAccess || !log) {
    throw new Error('Context must contain s3Client, dataAccess, and log properties');
  }

  const {
    detectedHeadings,
    extractedHeadings,
    healthyHeadings,
  } = allHeadings;
  // Validate allHeadings structure
  if (!detectedHeadings || !extractedHeadings || !healthyHeadings) {
    throw new Error('AllHeadings must contain detectedHeadings, extractedHeadings, and healthyHeadings properties');
  }

  const { forceAutoSuggest = false } = options;
  const { Configuration } = dataAccess;

  log.info(`[Headings Auto-Suggest] Starting AI suggestions generation for site: ${site.getBaseURL()}`);
  log.info(`[Headings Auto-Suggest] Detected headings count: ${Object.keys(detectedHeadings).length}`);
  log.info(`[Headings Auto-Suggest] Extracted headings count: ${Object.keys(extractedHeadings).length}`);
  log.info(`[Headings Auto-Suggest] Healthy headings samples - H1: ${healthyHeadings.h1?.length || 0}, H2: ${healthyHeadings.h2?.length || 0}, H3: ${healthyHeadings.h3?.length || 0}`);

  const configuration = await Configuration.findLatest();
  if (!forceAutoSuggest && !configuration.isHandlerEnabledForSite('headings-auto-suggest', site)) {
    log.info('[Headings Auto-Suggest] Feature is disabled for this site, skipping AI suggestions');
    return detectedHeadings;
  }

  log.info('[Headings Auto-Suggest] Feature is enabled, proceeding with AI suggestions generation');

  // Prepare requests and scrape data
  const scrapedData = {};
  const requestsData = [];

  log.info(`[Headings Auto-Suggest] Starting S3 content scraping for ${Object.keys(detectedHeadings).length} endpoints`);

  // eslint-disable-next-line no-await-in-loop
  const promises = Object.entries(detectedHeadings).map(async ([endpoint]) => {
    try {
      const presignedUrlString = await getPresignedUrl(
        s3Client,
        log,
        extractedHeadings[endpoint],
      );

      if (!presignedUrlString) {
        log.warn(`[Headings Auto-Suggest] Failed to generate presigned URL for endpoint: ${endpoint}`);
        return;
      }

      log.debug(`[Headings Auto-Suggest] Generated presigned URL for ${endpoint}: ${presignedUrlString.substring(0, 100)}...`);

      const data = await getScrapedData(presignedUrlString);
      scrapedData[endpoint] = data;
      requestsData.push(endpoint);

      log.debug(`[Headings Auto-Suggest] Successfully scraped content for ${endpoint}, content length: ${data.mainContent?.length || 0} chars`);
    } catch (error) {
      log.error(`[Headings Auto-Suggest] Error processing endpoint ${endpoint}: ${error.message}`);
    }
  });

  await Promise.all(promises);

  log.info(`[Headings Auto-Suggest] Completed S3 content scraping. Successfully processed: ${requestsData.length}/${Object.keys(detectedHeadings).length} endpoints`);

  const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
  context.azureOpenAIClient = azureOpenAIClient;

  log.info('[Headings Auto-Suggest] Azure OpenAI client initialized successfully');

  // Generate brand guidelines
  log.info('[Headings Auto-Suggest] Starting brand guidelines generation using Azure OpenAI');
  const { brandGuidelines } = await getBrandGuidelines(
    { ...context, conversation_identifier: null },
    site.getBaseURL(),
    healthyHeadings,
  );

  log.info(`[Headings Auto-Suggest] Brand guidelines generated successfully. Length: ${brandGuidelines?.length || 0} chars`);

  // Process in batches
  const batchSize = 15;
  const totalBatches = Math.ceil(requestsData.length / batchSize);
  log.info(`[Headings Auto-Suggest] Starting AI suggestions generation for ${requestsData.length} pages in ${totalBatches} batches of ${batchSize}`);
  const allAiResponses = {};

  for (let i = 0; i < requestsData.length; i += batchSize) {
    const batch = requestsData.slice(i, i + batchSize);
    const currentBatch = Math.floor(i / batchSize) + 1;

    log.info(`[Headings Auto-Suggest] Processing batch ${currentBatch}/${totalBatches} with ${batch.length} endpoints`);

    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      batch.map((endpoint) => generateSuggestions(
        context,
        endpoint,
        scrapedData[endpoint],
        site.getBaseURL(),
        brandGuidelines,
        allAiResponses,
      )),
    );

    log.info(`[Headings Auto-Suggest] Completed batch ${currentBatch}/${totalBatches}. Total AI responses so far: ${Object.keys(allAiResponses).length}`);
  }

  // Map AI responses back to detectedHeadings
  const updatedDetectedHeadings = { ...detectedHeadings };
  let totalSuggestionsAdded = 0;
  let totalEndpointsProcessed = 0;

  log.info(`[Headings Auto-Suggest] Starting to merge AI suggestions back into detected headings. Total AI responses: ${Object.keys(allAiResponses).length}`);

  for (const [endpoint, suggestions] of Object.entries(allAiResponses)) {
    if (suggestions && updatedDetectedHeadings[endpoint]) {
      totalEndpointsProcessed += 1;
      let endpointSuggestionsAdded = 0;

      // Add AI suggestions to existing heading data
      for (const headingType of Object.keys(suggestions)) {
        if (suggestions[headingType]?.aiSuggestion && suggestions[headingType]?.aiRationale) {
          if (!updatedDetectedHeadings[endpoint][headingType]) {
            updatedDetectedHeadings[endpoint][headingType] = {};
          }
          const { aiSuggestion, aiRationale } = suggestions[headingType];
          updatedDetectedHeadings[endpoint][headingType].aiSuggestion = aiSuggestion;
          updatedDetectedHeadings[endpoint][headingType].aiRationale = aiRationale;
          endpointSuggestionsAdded += 1;
          totalSuggestionsAdded += 1;
        }
      }

      if (endpointSuggestionsAdded > 0) {
        log.debug(`[Headings Auto-Suggest] Added ${endpointSuggestionsAdded} AI suggestions for endpoint: ${endpoint}`);
      }
    }
  }

  log.info(`[Headings Auto-Suggest] Successfully merged AI suggestions. Processed ${totalEndpointsProcessed} endpoints, added ${totalSuggestionsAdded} total suggestions`);
  log.info('[Headings Auto-Suggest] AI suggestions generation completed successfully');
  return updatedDetectedHeadings;
}
