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
 * Generates JSON FAQ suggestions with transform rules for code changes
 * @param {Array} faqs - Array of FAQ objects from Mystique
 * @returns {Array} Array of FAQ suggestion objects with transform rules
 */
export function getJsonFaqSuggestion(faqs) {
  const suggestionValues = [];

  faqs.forEach((faq) => {
    const { url, suggestions } = faq;

    // Filter only suitable suggestions
    const suitableSuggestions = (suggestions || []).filter(
      (s) => s.isAnswerSuitable && s.isQuestionRelevant,
    );

    if (suitableSuggestions.length === 0 || !url) {
      return;
    }

    // Group all FAQs for this URL into a single suggestion
    const faqContent = suitableSuggestions.map((suggestion) => ({
      question: suggestion.question,
      answer: suggestion.answer,
      sources: suggestion.sources || [],
    }));

    // Generate markdown text
    let markdown = '## FAQs\n\n';
    faqContent.forEach((item) => {
      markdown += `### ${item.question}\n\n`;
      markdown += `${item.answer}\n\n`;
    });

    suggestionValues.push({
      text: markdown.trim(),
      data: {
        items: faqContent,
      },
      url,
      transformRules: {
        selector: 'body',
        action: 'appendChild',
      },
    });
  });

  return suggestionValues;
}
