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

import { issueTypesForMystique } from '../utils/constants.js';

/**
 * Processes suggestions directly to create Mystique message data
 *
 * @param {Array} suggestions - Array of suggestion objects from the opportunity
 * @returns {Array} Array of message data objects ready for SQS sending
 */
export function processSuggestionsForMystique(suggestions) {
  // Handle null/undefined inputs safely
  if (!suggestions || !Array.isArray(suggestions)) {
    return [];
  }

  const messageData = [];

  for (const suggestion of suggestions) {
    const suggestionData = suggestion.getData();
    if (suggestionData.issues && Array.isArray(suggestionData.issues)) {
      // Group issues by type for this suggestion
      const issuesByType = {};

      for (const issue of suggestionData.issues) {
        if (!issuesByType[issue.type]) {
          issuesByType[issue.type] = [];
        }

        const faultyLine = Array.isArray(issue.htmlWithIssues) && issue.htmlWithIssues.length > 0
          ? issue.htmlWithIssues[0]
          : '';
        const targetSelector = issue.targetSelector || '';

        issuesByType[issue.type].push({
          issue_name: issue.type,
          faulty_line: faultyLine,
          target_selector: targetSelector,
          issue_description: issue.description || '',
        });
      }

      // Create message data for each issue type
      for (const [issueType, issuesList] of Object.entries(issuesByType)) {
        if (issueTypesForMystique.includes(issueType)) {
          messageData.push({
            suggestion,
            suggestionData,
            issueType,
            issuesList,
          });
        }
      }
    }
  }

  return messageData;
}
