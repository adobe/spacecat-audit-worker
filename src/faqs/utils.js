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

export const RELATED_URLS_COLUMN_HEADER = 'Related URLs';
export const RELATED_URLS_DELIMITER = '; ';

/**
 * Builds a column-name-to-index map by scanning the header row.
 * Matching is case-insensitive so the spreadsheet layout can evolve
 * without breaking consumers.
 * @param {Object} worksheet - ExcelJS worksheet
 * @returns {Object} Map of lowercase header text to 1-based column index
 */
export function buildColumnMap(worksheet) {
  const headerRow = worksheet.getRow(1);
  const headerValues = headerRow?.values || [];
  const map = {};
  for (let i = 1; i < headerValues.length; i += 1) {
    const text = headerValues[i]?.toString?.().trim();
    if (text) {
      map[text.toLowerCase()] = i;
    }
  }
  return map;
}

/**
 * Gets the 1-based column index for a header name from the column map.
 * @param {Object} columnMap - Map from buildColumnMap
 * @param {string} headerName - Header text to look up (case-insensitive)
 * @returns {number} 1-based column index, or 0 if not found
 */
export function getColumn(columnMap, headerName) {
  return columnMap[headerName.toLowerCase()] || 0;
}

/**
 * Normalizes URLs for overlap comparisons.
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL or empty string
 */
function normalizeUrlForComparison(url) {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const normalizedPath = parsed.pathname.replace(/\/$/, '') || '/';
    return `${parsed.origin}${normalizedPath}${parsed.search}`;
  } catch {
    return url.toString().trim().replace(/\/$/, '');
  }
}

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
 * Selects the final target URL for an FAQ suggestion.
 * Priority:
 * 1. Top related URL overlapping with customer desired URLs
 * 2. Top related URL overlapping with FAQ sources
 * 3. Top related URL from prompt-to-URL analysis
 * 4. Original URL column
 * 5. Empty URL for generic FAQs
 * @param {Object} options - URL selection inputs
 * @param {string[]} [options.relatedUrls] - Related URLs from prompt-to-URL analysis
 * @param {Set<string>} [options.includedURLsSet] - Site desired URLs
 * @param {string} [options.originalUrl] - Original spreadsheet URL column value
 * @param {Array} [options.sources] - FAQ sources from Mystique
 * @returns {string} Final URL for the FAQ suggestion
 */
export function decorateFaqSuggestionUrl({
  relatedUrls = [],
  includedURLsSet = new Set(),
  originalUrl = '',
  sources = [],
} = {}) {
  const normalizedIncludedUrls = new Set(
    [...includedURLsSet]
      .map((url) => normalizeUrlForComparison(url))
      .filter(Boolean),
  );
  const normalizedSources = new Set(
    normalizeSources(sources)
      .map((url) => normalizeUrlForComparison(url))
      .filter(Boolean),
  );

  const relatedUrlOverlap = (candidateSet) => relatedUrls.find(
    (url) => candidateSet.has(normalizeUrlForComparison(url)),
  );

  return relatedUrlOverlap(normalizedIncludedUrls)
    || relatedUrlOverlap(normalizedSources)
    || relatedUrls[0]
    || originalUrl
    || '';
}

/**
 * Generates JSON FAQ suggestions with transform rules for code changes
 * Each suggestion has nested FAQs array
 * @param {Array} suggestions - Array of suggestions from Mystique
 * @param {Object} [options] - FAQ decoration options
 * @param {Set<string>} [options.includedURLsSet] - Site desired URLs
 * @returns {Array} Array of FAQ suggestion objects with transform rules
 */
export function getJsonFaqSuggestion(suggestions, options = {}) {
  const suggestionValues = [];
  const includedURLsSet = options.includedURLsSet || new Set();

  suggestions.forEach((suggestion) => {
    const {
      url,
      originalUrl = url || '',
      relatedUrls = [],
      topic,
      faqs,
    } = suggestion;

    // Filter only suitable FAQs
    const suitableFaqs = (faqs || []).filter(
      (faq) => faq.isAnswerSuitable && faq.isQuestionRelevant,
    );

    if (suitableFaqs.length === 0) {
      return;
    }

    // Create one suggestion per FAQ question
    suitableFaqs.forEach((faq) => {
      const decoratedUrl = decorateFaqSuggestionUrl({
        relatedUrls,
        includedURLsSet,
        originalUrl,
        sources: faq.sources,
      });

      suggestionValues.push({
        headingText: 'FAQs',
        shouldOptimize: true, // Default to true, will be updated based on analysis
        url: decoratedUrl,
        originalUrl,
        relatedUrls,
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
