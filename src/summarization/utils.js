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
 * Generates formatted markdown from suggestions data
 * @param {Array} suggestions - Array of suggestion objects
 * @param {Object} log - Logger object
 * @returns {string} Formatted markdown string
 */
export function getMarkdownSummarySuggestion(suggestions, log) {
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

    // Main section for each URL - use page title as heading
    const pageTitle = suggestion.pageSummary?.title || `Page ${processedCount}`;
    const urlPath = suggestion.pageUrl.replace(/^https?:\/\/[^/]+/, '');
    suggestionValue += `## ${processedCount}. ${pageTitle}\n\n`;
    // Add URL path as smaller link
    if (urlPath) {
      suggestionValue += `[${urlPath}](${suggestion.pageUrl})\n\n`;
    }

    // Add summary ideally before the main content starts
    suggestionValue += '### Add summary ideally before the main content starts\n\n';
    // Summary section
    const pageSummaryContent = suggestion.pageSummary?.formatted_summary
      || suggestion.pageSummary?.summary;
    if (pageSummaryContent) {
      suggestionValue += `**Summary**\n\n${pageSummaryContent}\n\n`;
    }

    // Key Points section
    const keyPointsItems = suggestion.keyPoints?.formatted_items || suggestion.keyPoints?.items;
    if (keyPointsItems && Array.isArray(keyPointsItems)) {
      suggestionValue += '**Key points**\n\n';
      keyPointsItems.forEach((point) => {
        if (point.trim()) {
          suggestionValue += `- ${point}\n`;
        }
      });
      suggestionValue += '\n';
    }

    // Add section summaries above or below section content
    if (suggestion.sectionSummaries && suggestion.sectionSummaries.length > 0) {
      suggestionValue += '### Add section summaries above or below section content\n\n';
      suggestion.sectionSummaries.forEach((section) => {
        const sectionContent = section.formatted_summary || section.summary;
        if (section.title && section.title.trim() && sectionContent && sectionContent.trim()) {
          suggestionValue += `*Section:* **${section.title}**\n\n${sectionContent}\n\n`;
        }
      });
    }

    suggestionValue += '---\n\n';
  });

  return suggestionValue;
}

export function getJsonSummarySuggestion(suggestions) {
  const suggestionValues = [];
  suggestions.forEach((suggestion) => {
    // handle page level summary
    suggestionValues.push({
      summarizationText: suggestion.pageSummary?.formatted_summary,
      fullPage: true,
      url: suggestion.pageUrl,
      insertAfter: 'h1',
    });

    // handle paragraph level summary
    suggestion.sectionSummaries.forEach((section) => {
      suggestionValues.push({
        summarizationText: section.formatted_summary,
        fullPage: false,
        url: suggestion.pageUrl,
        insertAfter: section.heading_selector,
      });
    });
  });

  return suggestionValues;
}
