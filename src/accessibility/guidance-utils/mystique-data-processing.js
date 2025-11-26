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

import { isNonEmptyArray, isNonEmptyObject, buildAggregationKey } from '@adobe/spacecat-shared-utils';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { issueTypesForMystique } from '../utils/constants.js';

/**
 * Processes suggestions directly to create Mystique message data
 *
 * Supports multiple aggregation strategies:
 * - PER_ELEMENT: Each suggestion has one issue with one htmlWithIssues element
 * - PER_ISSUE_TYPE_PER_PAGE: Each suggestion has one issue with multiple htmlWithIssues elements
 * - PER_PAGE: Each suggestion has multiple issues with multiple htmlWithIssues elements
 *
 * @param {Array} suggestions - Array of suggestion objects from the opportunity
 * @returns {Array} Array of message data objects ready for SQS sending
 */
export function processSuggestionsForMystique(suggestions) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return [];
  }

  const SKIPPED_STATUSES = [
    SuggestionDataAccess.STATUSES.FIXED,
    SuggestionDataAccess.STATUSES.SKIPPED,
  ];

  // Helper: Extract issue items from a suggestion that need Mystique processing
  const extractIssueItems = (suggestion) => {
    const data = suggestion.getData();
    const suggestionId = suggestion.getId();

    if (!isNonEmptyArray(data.issues)) {
      return [];
    }

    return data.issues
      .filter((issue) => issueTypesForMystique.includes(issue.type))
      .filter((issue) => isNonEmptyArray(issue.htmlWithIssues))
      .flatMap((issue) => issue.htmlWithIssues
        .filter((html) => !isNonEmptyObject(html.guidance))
        .map((html) => {
          // Build aggregation key based on granularity strategy for this issue type
          const targetSelector = html.target_selector || html.targetSelector || '';
          const aggregationKey = buildAggregationKey(
            issue.type,
            data.url,
            targetSelector,
            data.source,
          );

          return {
            issueName: issue.type,
            faultyLine: html.update_from || html.updateFrom || '',
            targetSelector,
            issueDescription: issue.description || '',
            suggestionId,
            url: data.url,
            aggregationKey,
          };
        }));
  };

  // Process all suggestions and extract issue items
  const allIssueItems = suggestions
    .filter((suggestion) => !SKIPPED_STATUSES.includes(suggestion.getStatus()))
    .flatMap(extractIssueItems);

  // Group by aggregation key
  const byAggregationKey = allIssueItems.reduce((acc, item) => {
    const { aggregationKey, ...issueItem } = item;
    if (!acc[aggregationKey]) {
      acc[aggregationKey] = {
        url: item.url,
        issuesList: [],
      };
    }
    acc[aggregationKey].issuesList.push(issueItem);
    return acc;
  }, {});

  // Convert to final format
  return Object.entries(byAggregationKey).map(([aggregationKey, data]) => ({
    url: data.url,
    aggregationKey,
    issuesList: data.issuesList,
  }));
}
