/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

export function removeTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Synchronizes existing suggestions with new data
 * by removing outdated suggestions and adding new ones.
 *
 * @param {Object} params - The parameters for the sync operation.
 * @param {Object} params.opportunity - The opportunity object to synchronize suggestions for.
 * @param {Array} params.newData - Array of new data objects to sync.
 * @param {Function} params.buildKey - Function to generate a unique key for each item.
 * @param {Function} params.mapNewSuggestion - Function to map new data to suggestion objects.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export async function syncMetatagsSuggestions({
  opportunity,
  newData,
  buildKey,
  mapNewSuggestion,
  log,
}) {
  const existingSuggestions = await opportunity.getSuggestions();
  const existingSuggestionsMap = new Map(
    existingSuggestions.map((existing) => [buildKey(existing.getData()), existing]),
  );

  // Create new suggestions and sync them with existing suggestions
  const newSuggestions = newData
    // map new audit data to suggestions format
    .map(mapNewSuggestion)
    // update new suggestions with data from existing suggestion of same key
    .map((newSuggestion) => {
      const existing = existingSuggestionsMap.get(buildKey(newSuggestion.data));
      if (existing) {
        return {
          ...newSuggestion,
          status: existing.getStatus(),
          data: {
            ...newSuggestion.data,
            ...(existing
              .getData().aiSuggestion && { aiSuggestion: existing.getData().aiSuggestion }),
            ...(existing.getData().aiRationale && { aiRationale: existing.getData().aiRationale }),
            ...(existing.getData().toOverride && { toOverride: existing.getData().toOverride }),
          },
        };
      }
      return newSuggestion;
    });

  // Remove existing suggestions
  await Promise.all(existingSuggestions.map((suggestion) => suggestion.remove()));

  // TODO: Skip deleting the suggestions created by BO UI
  //  once the createdBy field is introduced in suggestions schema

  // Add new suggestions
  if (newSuggestions.length > 0) {
    const suggestions = await opportunity.addSuggestions(newSuggestions);

    if (suggestions.errorItems?.length > 0) {
      log.error(`Suggestions for siteId ${opportunity.getSiteId()} contains ${suggestions.errorItems.length} items with errors`);
      suggestions.errorItems.forEach((errorItem) => {
        log.error(`Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
      });

      if (suggestions.createdItems?.length <= 0) {
        throw new Error(`Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
      }
    }
  }
}

const issueRankings = {
  title: {
    missing: 1,
    empty: 2,
    duplicate: 5,
    long: 8,
    short: 8,
  },
  description: {
    missing: 3,
    empty: 3,
    duplicate: 6,
    long: 9,
    short: 9,
  },
  h1: {
    missing: 4,
    empty: 4,
    duplicate: 7,
    long: 10,
    multiple: 11,
  },
};

/**
 * Returns the tag issues rank as per below ranking based on seo impact.
 * The rank can help in sorting by impact.
 * Rankling (low number means high rank):
 * 1. Missing Title
 * 2. Empty Title
 * 3. Missing Description
 * 4. Missing H1
 * 5. Duplicate Title
 * 6. Duplicate Description
 * 7. Duplicate H1
 * 8. Title Too Long/Short
 * 9. Description Too Long/Short
 * 10. H1 Too Long
 * 11. Multiple H1 on a Page
 * @param issue
 * @param tagName
 */
export function getIssueRanking(tagName, issue) {
  const tagIssues = issueRankings[tagName];
  const issueWords = issue.toLowerCase().split(' ');
  for (const word of issueWords) {
    if (tagIssues[word]) {
      return tagIssues[word];
    }
  }
  return -1;
}
