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

import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
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
  // Group issues by url
  const issuesByUrl = {};

  for (const suggestion of suggestions) {
    const suggestionData = suggestion.getData();
    const suggestionId = suggestion.getId();
    if (suggestionData.issues && Array.isArray(suggestionData.issues)) {
      for (const issue of suggestionData.issues) {
        if (issueTypesForMystique.includes(issue.type)) {
          const { url } = suggestionData;
          if (!issuesByUrl[url]) {
            issuesByUrl[url] = [];
          }
          issuesByUrl[url].push({ ...suggestionData, suggestionId });
        }
      }
    }
  }

  for (const [url, issues] of Object.entries(issuesByUrl)) {
    const issuesList = [];
    for (const issue of issues) {
      if (isNonEmptyArray(issue.issues)) {
        const singleIssue = issue.issues[0];
        if (isNonEmptyArray(singleIssue.htmlWithIssues)) {
          const singleHtmlWithIssue = singleIssue.htmlWithIssues[0];
          issuesList.push({
            issueName: singleIssue.type,
            faultyLine: singleHtmlWithIssue.update_from || '',
            targetSelector: singleHtmlWithIssue.target_selector || '',
            issueDescription: singleIssue.description || '',
            suggestionId: issue.suggestionId,
          });
        }
      }
    }
    messageData.push({
      url,
      issuesList,
    });
  }

  return messageData;
}
