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

import { ContentAIClient } from '../utils/content-ai.js';

/**
 * Column indices for the brand presence spreadsheet.
 * Excel uses 1-based indexing for columns.
 */
export const SPREADSHEET_COLUMNS = {
  CATEGORY: 1,
  TOPICS: 2,
  PROMPT: 3,
  ORIGIN: 4,
  REGION: 5,
  VOLUME: 6,
  URL: 7,
  ANSWER: 8,
  SOURCES: 9,
  CITATIONS: 10,
  MENTIONS: 11,
  SENTIMENT: 12,
  BUSINESS_COMPETITORS: 13,
  ORGANIC_COMPETITORS: 14,
  CONTENT_AI_RESULT: 15,
  IS_ANSWERED: 16,
  SOURCE_TO_ANSWER: 17,
  POSITION: 18,
  VISIBILITY_SCORE: 19,
  DETECTED_BRAND_MENTIONS: 20,
  EXECUTION_DATE: 21,
};

/**
 * Normalizes sources to an array of URL strings
 * Sources can be strings, objects with 'url' key, or objects with 'link' key
 * @param {Array} sources - Array of source objects or strings
 * @returns {Array} Array of URL strings
 */
function normalizeSources(sources) {
  if (!sources || !Array.isArray(sources)) {
    return [];
  }

  return sources
    .map((source) => {
      if (typeof source === 'string') {
        return source;
      }
      if (source && typeof source === 'object') {
        return source.url || source.link || null;
      }
      return null;
    })
    .filter((url) => url !== null);
}

/**
 * Generates JSON FAQ suggestions with transform rules for code changes
 * Each suggestion has nested FAQs array
 * @param {Array} suggestions - Array of suggestions from Mystique
 * @returns {Array} Array of FAQ suggestion objects with transform rules
 */
export function getJsonFaqSuggestion(suggestions) {
  const suggestionValues = [];

  suggestions.forEach((suggestion) => {
    const { url, topic, faqs } = suggestion;

    // Filter only suitable FAQs
    const suitableFaqs = (faqs || []).filter(
      (faq) => faq.isAnswerSuitable && faq.isQuestionRelevant,
    );

    if (suitableFaqs.length === 0) {
      return;
    }

    // Create one suggestion per FAQ question
    suitableFaqs.forEach((faq) => {
      suggestionValues.push({
        headingText: 'FAQs',
        shouldOptimize: true, // Default to true, will be updated based on analysis
        url: url || '',
        topic: topic || '',
        transformRules: {
          selector: 'body',
          action: 'appendChild',
        },
        item: {
          question: faq.question,
          answer: faq.answer,
          sources: normalizeSources(faq.sources),
          questionRelevanceReason: faq.questionRelevanceReason,
          answerSuitabilityReason: faq.answerSuitabilityReason,
          scrapedAt: faq.scrapedAt || new Date().toISOString(),
        },
      });
    });
  });

  return suggestionValues;
}

/**
 * Validates if Content AI configuration exists and is working for a site
 * by checking for the configuration and testing the search endpoint
 * @param {Object} site - The site object
 * @param {Object} context - The context object with env and log
 * @returns {Promise<{uid: string|null, indexName: string|null,
 *   genSearchEnabled: boolean, isWorking: boolean}>}
 */
export async function validateContentAI(site, context) {
  const { log } = context;

  try {
    // Initialize Content AI client once (token generated once)
    const client = new ContentAIClient(context);
    await client.initialize();

    const existingConf = await client.getConfigurationForSite(site);
    const baseURL = site.getBaseURL();

    if (!existingConf) {
      log.warn(`[ContentAI] No configuration found for site ${baseURL}`);
      return {
        uid: null,
        indexName: null,
        genSearchEnabled: false,
        isWorking: false,
      };
    }

    // Extract UID and index name from configuration
    const uid = existingConf.uid || null;
    const indexStep = existingConf.steps?.find((step) => step.type === 'index');
    const indexName = indexStep?.name;

    if (!indexName) {
      log.warn(`[ContentAI] No index name found in configuration for site ${baseURL}`);
      return {
        uid,
        indexName: null,
        genSearchEnabled: false,
        isWorking: false,
      };
    }

    log.info(`[ContentAI] Found configuration with UID: ${uid}, index name: ${indexName}`);

    // Check if generative search is enabled (generative step exists and is not empty)
    const generativeStep = existingConf.steps?.find((step) => step.type === 'generative');
    const genSearchEnabled = !!(generativeStep && Object.keys(generativeStep).length > 1);

    // Test the search endpoint with a simple query (reuses token from client)
    const searchOptions = {
      numCandidates: 3,
      boost: 1,
    };
    const searchResponse = await client.runSemanticSearch('website', 'vector', indexName, searchOptions, 1);

    const isWorking = searchResponse.ok;
    log.info(`[ContentAI] Search endpoint validation: ${searchResponse.status} (${isWorking ? 'working' : 'not working'})`);

    return {
      uid,
      indexName,
      genSearchEnabled,
      isWorking,
    };
  } catch (error) {
    log.error(`[ContentAI] Validation failed: ${error.message}`);
    return {
      uid: null,
      indexName: null,
      genSearchEnabled: false,
      isWorking: false,
    };
  }
}
