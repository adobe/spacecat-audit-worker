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

export function getJsonSummarySuggestion(suggestions) {
  const suggestionValues = [];
  suggestions.forEach((suggestion) => {
    // handle page level summary
    suggestionValues.push({
      summarizationText: suggestion.pageSummary?.formatted_summary,
      fullPage: true,
      url: suggestion.pageUrl,
      title: suggestion.pageSummary?.title,
      transformRules: {
        selector: suggestion.pageSummary?.heading_selector || 'body',
        action: suggestion.pageSummary?.insertion_method || 'appendChild',
      },
    });

    // handle paragraph level summary
    suggestion.sectionSummaries?.forEach((section) => {
      suggestionValues.push({
        summarizationText: section.formatted_summary,
        fullPage: false,
        url: suggestion.pageUrl,
        title: section.title,
        transformRules: {
          selector: section.heading_selector,
          action: section.insertion_method || 'insertAfter',
        },
      });
    });
  });

  return suggestionValues;
}
