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
 * Each question becomes a separate suggestion
 * @param {Array} faqs - Array of FAQ objects from Mystique
 * @returns {Array} Array of FAQ suggestion objects with transform rules
 */
export function getJsonFaqSuggestion(faqs) {
  const suggestionValues = [];

  faqs.forEach((faq) => {
    const { url, topic, suggestions } = faq;

    // Filter only suitable suggestions
    const suitableSuggestions = (suggestions || []).filter(
      (s) => s.isAnswerSuitable && s.isQuestionRelevant,
    );

    if (suitableSuggestions.length === 0) {
      return;
    }

    // Create one suggestion per FAQ question
    suitableSuggestions.forEach((suggestion) => {
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
          question: suggestion.question,
          answer: suggestion.answer,
          sources: normalizeSources(suggestion.sources),
          questionRelevanceReason: suggestion.questionRelevanceReason,
          answerSuitabilityReason: suggestion.answerSuitabilityReason,
        },
      });
    });
  });

  return suggestionValues;
}
