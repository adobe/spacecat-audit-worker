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

import { isNonEmptyArray, isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { issueTypesForMystique } from '../utils/constants.js';

/**
 * Processes suggestions directly to create Mystique message data
 *
 * @param {Array} suggestions - Array of suggestion objects from the opportunity
 * @returns {Array} Array of message data objects ready for SQS sending
 */
export function processSuggestionsForMystique(suggestions) {
  if (!suggestions || !Array.isArray(suggestions)) {
    return [];
  }

  // Group suggestions by url
  const suggestionsByUrl = {};
  for (const suggestion of suggestions) {
    const suggestionData = suggestion.getData();
    const suggestionId = suggestion.getId();
    // skip sending to M suggestions that are fixed or skipped
    if (![SuggestionDataAccess.STATUSES.FIXED, SuggestionDataAccess.STATUSES.SKIPPED]
      .includes(suggestion.getStatus())) {
      // Handle both old and new data formats
      let shouldProcess = false;
      let issueType = '';
      let hasGuidance = false;

      // Check for old format
      if (suggestionData.issues && isNonEmptyArray(suggestionData.issues)
        && isNonEmptyArray(suggestionData.issues[0].htmlWithIssues)) {
        const singleIssue = suggestionData.issues[0];
        const singleHtmlWithIssue = singleIssue.htmlWithIssues[0];
        issueType = singleIssue.type;
        hasGuidance = isNonEmptyObject(singleHtmlWithIssue.guidance);
        shouldProcess = true;
      } else if (suggestionData.violationDetails && suggestionData.htmlData) {
        // Fallback to new format
        issueType = suggestionData.violationDetails.issueType;
        hasGuidance = isNonEmptyObject(suggestionData.guidance);
        shouldProcess = true;
      }
      // Skip sending to Mystique suggestions that already have guidance
      if (shouldProcess && issueTypesForMystique.includes(issueType) && !hasGuidance) {
        const { url } = suggestionData;
        if (!suggestionsByUrl[url]) {
          suggestionsByUrl[url] = [];
        }
        suggestionsByUrl[url].push({ ...suggestionData, suggestionId });
      }
    }
  }

  const messageData = [];
  for (const [url, suggestionsForUrl] of Object.entries(suggestionsByUrl)) {
    const issuesList = [];
    for (const suggestion of suggestionsForUrl) {
      // Handle old format
      if (suggestion.issues && isNonEmptyArray(suggestion.issues)) {
        const singleIssue = suggestion.issues[0];
        if (isNonEmptyArray(singleIssue.htmlWithIssues)) {
          const singleHtmlWithIssue = singleIssue.htmlWithIssues[0];
          issuesList.push({
            issueName: singleIssue.type,
            faultyLine: singleHtmlWithIssue.update_from || singleHtmlWithIssue.updateFrom || '',
            targetSelector: singleHtmlWithIssue.target_selector || singleHtmlWithIssue.targetSelector || '',
            issueDescription: singleIssue.description || '',
            suggestionId: suggestion.suggestionId,
          });
        }
      } else if (suggestion.violationDetails && suggestion.htmlData) {
        // Handle new format
        issuesList.push({
          issueName: suggestion.violationDetails.issueType,
          faultyLine: suggestion.htmlData.updateFrom || '',
          targetSelector: suggestion.htmlData.targetSelector || '',
          issueDescription: suggestion.violationDetails.description || '',
          suggestionId: suggestion.suggestionId,
        });
      }
    }
    messageData.push({
      url,
      issuesList,
    });
  }

  return messageData;
}
