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
 * Generates formatted markdown from FAQ data
 * @param {Array} faqs - Array of FAQ objects from Mystique
 * @param {Object} log - Logger object
 * @returns {string} Formatted markdown string
 */
export function getFaqMarkdown(faqs, log) {
  let markdown = '';
  let faqNumber = 1;

  faqs.forEach((faq) => {
    const {
      url, topic, prompts, suggestions,
    } = faq;

    // Filter only suitable suggestions
    const suitableSuggestions = (suggestions || []).filter(
      (s) => s.is_answer_suitable && s.is_question_relevant,
    );

    if (suitableSuggestions.length === 0) {
      log.info(`Skipping FAQ topic "${topic}" - no suitable suggestions`);
      return;
    }

    // Add URL as heading (or use topic if no URL)
    if (url) {
      const urlPath = url.replace(/^https?:\/\/[^/]+/, '');
      markdown += `## ${faqNumber}. Target URL: [${urlPath}](${url})\n\n`;
      if (topic) {
        markdown += `**Topic:** ${topic}\n\n`;
      }
    } else if (topic) {
      // Fallback to topic as heading if no URL
      markdown += `## ${faqNumber}. Topic: ${topic}\n\n`;
    }
    // If no URL and no topic, skip heading entirely

    // Add prompts that led to these FAQs
    if (prompts && Array.isArray(prompts) && prompts.length > 0) {
      markdown += '**Related Search Queries:**\n';
      prompts.forEach((prompt) => {
        markdown += `- ${prompt}\n`;
      });
      markdown += '\n';
    }

    // Add suggested FAQ section
    markdown += '### Suggested FAQs\n\n';

    suitableSuggestions.forEach((suggestion) => {
      const { question, answer, sources } = suggestion;

      // Add question and answer
      markdown += `#### ${question}\n\n`;
      markdown += `*AI suggested answer:* ${answer}\n\n`;

      // Add sources if available
      if (sources && Array.isArray(sources) && sources.length > 0) {
        markdown += '**Sources:**\n';
        sources.forEach((source) => {
          if (source.title && source.url) {
            markdown += `- [${source.title}](${source.url})\n`;
          } else if (source.url) {
            markdown += `- ${source.url}\n`;
          }
        });
        markdown += '\n';
      }

      // Add rationale in a collapsible section (optional, for transparency)
      if (suggestion.answer_suitability_reason || suggestion.question_relevance_reason) {
        markdown += '<details>\n<summary>AI Analysis</summary>\n\n';
        if (suggestion.answer_suitability_reason) {
          markdown += `**Answer Suitability:** ${suggestion.answer_suitability_reason}\n\n`;
        }
        if (suggestion.question_relevance_reason) {
          markdown += `**Question Relevance:** ${suggestion.question_relevance_reason}\n\n`;
        }
        markdown += '</details>\n\n';
      }
    });

    markdown += '---\n\n';
    faqNumber += 1;
  });

  return markdown;
}
