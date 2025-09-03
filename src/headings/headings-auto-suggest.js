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

  log.info('Generating brand guidelines using Azure OpenAI');

  const prompt = await getPrompt(
    {
      baseUrl,
      healthyHeadings: JSON.stringify(healthyHeadings),
    },
    'headings-brand-guidelines',
    log,
  );

  const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
    responseFormat: 'json_object',
  });

  if (!aiResponse?.choices?.[0]?.message?.content) {
    throw new Error(
      `Invalid AI response received while generating brand guidelines: ${JSON.stringify(aiResponse)}`,
    );
  }

  const brandGuidelines = aiResponse.choices[0].message.content;
  log.info(`Azure OpenAI generated brand guidelines: ${brandGuidelines}`);

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

    const aiResponse = await azureOpenAIClient.fetchChatCompletion(prompt, {
      responseFormat: 'json_object',
    });

    if (!aiResponse?.choices?.[0]?.message?.content) {
      log.error(`No suggestions found for ${endpoint}`);
      return;
    }

    const suggestions = JSON.parse(aiResponse.choices[0].message.content);
    // eslint-disable-next-line no-param-reassign
    allAiResponses[endpoint] = suggestions;
  } catch (error) {
    log.error(`Error generating suggestions for ${endpoint}: ${error}`);
    throw error;
  }
}

export default async function headingsAutoSuggest(allHeadings, context, site, options = {
  forceAutoSuggest: false,
}) {
  const { s3Client, dataAccess, log } = context;
  const {
    detectedHeadings,
    extractedHeadings,
    healthyHeadings,
  } = allHeadings;
  const { forceAutoSuggest = false } = options;
  const { Configuration } = dataAccess;

  const configuration = await Configuration.findLatest();
  if (!forceAutoSuggest && !configuration.isHandlerEnabledForSite('headings-auto-suggest', site)) {
    log.info('Headings auto-suggest is disabled for site');
    return detectedHeadings;
  }

  log.debug('Generating suggestions for Headings using Azure OpenAI.');

  // Prepare requests and scrape data
  const scrapedData = {};
  const requestsData = [];

  // eslint-disable-next-line no-await-in-loop
  const promises = Object.entries(detectedHeadings).map(async ([endpoint]) => {
    const presignedUrlString = await getPresignedUrl(
      s3Client,
      log,
      extractedHeadings[endpoint],
    );
    const data = await getScrapedData(presignedUrlString);
    scrapedData[endpoint] = data;
    requestsData.push(endpoint);
  });
  await Promise.all(promises);

  const azureOpenAIClient = AzureOpenAIClient.createFrom(context);
  context.azureOpenAIClient = azureOpenAIClient;

  // Generate brand guidelines
  const { brandGuidelines } = await getBrandGuidelines(
    { ...context, conversation_identifier: null },
    site.getBaseURL(),
    healthyHeadings,
  );

  // Process in batches
  const batchSize = 15;
  log.info(`Generating suggestions for ${requestsData.length} pages`);
  const allAiResponses = {};

  for (let i = 0; i < requestsData.length; i += batchSize) {
    const batch = requestsData.slice(i, i + batchSize);
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
  }

  // Map AI responses back to detectedHeadings
  const updatedDetectedHeadings = { ...detectedHeadings };

  for (const [endpoint, suggestions] of Object.entries(allAiResponses)) {
    if (suggestions && updatedDetectedHeadings[endpoint]) {
      // Add AI suggestions to existing heading data
      Object.keys(suggestions).forEach((headingType) => {
        if (suggestions[headingType]?.aiSuggestion && suggestions[headingType]?.aiRationale) {
          if (!updatedDetectedHeadings[endpoint][headingType]) {
            updatedDetectedHeadings[endpoint][headingType] = {};
          }
          const { aiSuggestion, aiRationale } = suggestions[headingType];
          updatedDetectedHeadings[endpoint][headingType].aiSuggestion = aiSuggestion;
          updatedDetectedHeadings[endpoint][headingType].aiRationale = aiRationale;
        }
      });
    }
  }

  log.info('Generated AI suggestions for Headings using Azure OpenAI.');
  return updatedDetectedHeadings;
}
