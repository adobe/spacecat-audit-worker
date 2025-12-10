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

import {
  isNonEmptyArray,
  isNonEmptyObject,
  buildAggregationKey,
  buildKey,
} from '@adobe/spacecat-shared-utils';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { issueTypesForMystique } from '../utils/constants.js';

/**
 * Determines if an HTML issue should be sent to Mystique for processing
 *
 * Rules:
 * - Always send if no guidance exists
 * - If codeFixFlow is enabled: also send if guidance exists but no code fix is available
 * - If codeFixFlow is disabled: skip issues that already have guidance
 *
 * @param {Object} html - The HTML issue object
 * @param {Object} suggestionData - The suggestion data containing isCodeChangeAvailable flag
 * @param {boolean} useCodeFixFlow - Whether code fix flow is enabled
 * @returns {boolean} True if the issue should be sent to Mystique
 */
function shouldSendIssueToMystique(html, suggestionData, useCodeFixFlow) {
  const hasGuidance = isNonEmptyObject(html.guidance);

  // Always send if no guidance exists
  if (!hasGuidance) {
    return true;
  }

  // If codeFixFlow is enabled, also send if code fix is not available
  if (useCodeFixFlow) {
    const hasCodeFix = suggestionData.isCodeChangeAvailable === true;
    return !hasCodeFix;
  }

  // Has guidance and codeFixFlow not enabled, skip
  return false;
}

/**
 * Processes suggestions directly to create Mystique message data
 *
 * Supports multiple aggregation strategies:
 * - Code Fix Flow (useCodeFixFlow=true): Uses buildAggregationKey for granular grouping
 * - Legacy Flow (useCodeFixFlow=false): Groups all issues by URL only
 *
 * @param {Array} suggestions - Array of suggestion objects from the opportunity
 * @param {boolean} useCodeFixFlow - Whether to use code fix flow (granular) or legacy flow (by URL)
 * @returns {Array} Array of message data objects ready for SQS sending
 */
export function processSuggestionsForMystique(suggestions, useCodeFixFlow = true) {
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
        .filter((html) => shouldSendIssueToMystique(html, data, useCodeFixFlow))
        .map((html) => {
          const targetSelector = html.target_selector || html.targetSelector || '';
          const aggregationKey = useCodeFixFlow
            ? buildAggregationKey(issue.type, data.url, targetSelector, data.source)
            : buildKey(data.url);

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
