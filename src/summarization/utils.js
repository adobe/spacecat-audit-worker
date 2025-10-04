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
 * Formats metrics into a consistent string format
 * @param {Object} metrics - Object containing metric values
 * @returns {string} Formatted metrics string or empty string if no metrics
 */
export function formatMetrics(metrics) {
  const metricStrings = [];
  if (metrics.word_count !== undefined && metrics.word_count !== null) {
    metricStrings.push(`Word count: ${metrics.word_count}`);
  }
  if (metrics.readability_score !== undefined && metrics.readability_score !== null) {
    const score = metrics.readability_score;
    let readabilityText = `${score}`;
    if (score >= 0 && score < 30) {
      readabilityText += ' => difficult to read';
    } else if (score >= 30 && score < 70) {
      readabilityText += ' => easy to read';
    } else if (score >= 70 && score <= 100) {
      readabilityText += ' => very easy to read';
    }
    metricStrings.push(`Readability: ${readabilityText}`);
  }
  return metricStrings.length > 0 ? metricStrings.join(' | ') : '';
}

/**
 * Generates formatted markdown from suggestions data
 * @param {Array} suggestions - Array of suggestion objects
 * @param {Object} log - Logger object
 * @returns {string} Formatted markdown string
 */
export function getSuggestionValue(suggestions, log) {
  let suggestionValue = '';
  let processedCount = 0;

  suggestions.forEach((suggestion) => {
    if (!suggestion.pageUrl) {
      log.warn(`No pageUrl found for suggestion: ${JSON.stringify(suggestion)}. Skipping this suggestion.`);
      return;
    }

    // Skip suggestions that don't have any meaningful content
    const hasPageSummary = (suggestion.pageSummary?.formatted_summary
      && suggestion.pageSummary.formatted_summary.trim())
      || (suggestion.pageSummary?.summary && suggestion.pageSummary.summary.trim());
    const hasKeyPoints = (suggestion.keyPoints?.formatted_items
      && suggestion.keyPoints.formatted_items.some((item) => item.trim()))
      || (suggestion.keyPoints?.items && suggestion.keyPoints.items.some((item) => item.trim()));
    const hasSectionSummaries = suggestion.sectionSummaries
      && suggestion.sectionSummaries.length > 0
      && suggestion.sectionSummaries.some(
        (section) => section.title && (
          (section.formatted_summary && section.formatted_summary.trim())
          || (section.summary && section.summary.trim())
        ),
      );

    if (!hasPageSummary && !hasKeyPoints && !hasSectionSummaries) {
      log.info(`Skipping suggestion with no meaningful content for URL: ${suggestion.pageUrl}`);
      return;
    }

    // Increment counter only for processed suggestions
    processedCount += 1;

    // Main section for each URL
    suggestionValue += `## ${processedCount}. ${suggestion.pageUrl}\n\n`;

    suggestionValue += '### Page Title\n\n';

    // Page title as subsection
    if (suggestion.pageSummary?.title) {
      suggestionValue += `${suggestion.pageSummary.title}\n\n`;
    }

    // Page Summary subsection
    const pageSummaryContent = suggestion.pageSummary?.formatted_summary
      || suggestion.pageSummary?.summary;
    if (pageSummaryContent) {
      suggestionValue += `### Page Summary (AI generated)\n\n> ${pageSummaryContent}\n\n`;

      // Add page summary metrics
      const pageSummaryMetrics = formatMetrics(suggestion.pageSummary);
      if (pageSummaryMetrics) {
        suggestionValue += `${pageSummaryMetrics}\n\n`;
      }
    }

    // Key Points subsection
    const keyPointsItems = suggestion.keyPoints?.formatted_items || suggestion.keyPoints?.items;
    if (keyPointsItems && Array.isArray(keyPointsItems)) {
      suggestionValue += '### Key Points (AI generated)\n\n';
      keyPointsItems.forEach((point) => {
        if (point.trim()) {
          suggestionValue += `> - ${point}\n`;
        }
      });

      // Add key points metrics
      const keyPointsMetrics = formatMetrics(suggestion.keyPoints);
      if (keyPointsMetrics) {
        suggestionValue += `\n${keyPointsMetrics}\n\n`;
      } else {
        suggestionValue += '\n';
      }
    }

    // Section Summaries subsection
    if (suggestion.sectionSummaries && suggestion.sectionSummaries.length > 0) {
      suggestionValue += '### Section Summaries (AI generated)\n\n';
      suggestion.sectionSummaries.forEach((section) => {
        const sectionContent = section.formatted_summary || section.summary;
        if (section.title && section.title.trim() && sectionContent && sectionContent.trim()) {
          suggestionValue += `#### ${section.title}\n\n> ${sectionContent}\n\n`;

          // Add section metrics
          const sectionMetrics = formatMetrics(section);
          if (sectionMetrics) {
            suggestionValue += `${sectionMetrics}\n\n`;
          }
        }
      });
    }

    suggestionValue += '---\n\n';
  });

  return suggestionValue;
}
