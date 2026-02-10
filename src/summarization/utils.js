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

function joinKeyPoints(keyPoints) {
  if (!Array.isArray(keyPoints)) {
    return '';
  }
  return keyPoints.map((keyPoint) => `  * ${keyPoint}`).join('\n');
}

/**
 * Returns true if the string has meaningful content (not null, undefined, or blank)
 * @param {string} text
 * @returns {boolean}
 */
function hasSummaryText(text) {
  return typeof text === 'string' && text.trim().length > 0;
}

export function getJsonSummarySuggestion(suggestions) {
  const suggestionValues = [];
  suggestions.forEach((suggestion) => {
    // Get scrapedAt once for all suggestion values from this suggestion
    const scrapedAt = suggestion.scrapedAt || new Date().toISOString();

    // handle page level summary - only add if summary text is present
    const pageSummaryText = suggestion.pageSummary?.formatted_summary;
    if (hasSummaryText(pageSummaryText)) {
      suggestionValues.push({
        summarizationText: pageSummaryText,
        fullPage: true,
        keyPoints: false,
        url: suggestion.pageUrl,
        title: suggestion.pageSummary?.title,
        transformRules: {
          selector: suggestion.pageSummary?.heading_selector || 'body',
          action: suggestion.pageSummary?.insertion_method || 'appendChild',
        },
        scrapedAt,
      });
    }

    // handle key points summary - only add if there are key points
    const keyPointsText = joinKeyPoints(suggestion.keyPoints?.formatted_items);
    if (hasSummaryText(keyPointsText)) {
      suggestionValues.push({
        summarizationText: keyPointsText,
        fullPage: true,
        keyPoints: true,
        url: suggestion.pageUrl,
        title: suggestion.pageSummary?.title,
        transformRules: {
          selector: suggestion.pageSummary?.heading_selector || 'body',
          action: suggestion.pageSummary?.insertion_method || 'appendChild',
        },
        scrapedAt,
      });
    }
  });

  return suggestionValues;
}
