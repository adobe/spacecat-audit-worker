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

import { syncSuggestions } from '../utils/data-access.js';

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
  // Create a wrapper for mapNewSuggestion that preserves existing fields
  const existingSuggestions = await opportunity.getSuggestions();
  const existingSuggestionsMap = new Map(
    existingSuggestions.map((existing) => [buildKey(existing.getData()), existing]),
  );

  const enhancedMapNewSuggestion = (data) => {
    const baseSuggestion = mapNewSuggestion(data);
    const existing = existingSuggestionsMap.get(buildKey(baseSuggestion.data));
    if (existing) {
      return {
        ...baseSuggestion,
        status: existing.getStatus(),
        data: {
          ...baseSuggestion.data,
          ...(existing.getData().aiSuggestion && { aiSuggestion: existing.getData().aiSuggestion }),
          ...(existing.getData().aiRationale && { aiRationale: existing.getData().aiRationale }),
          ...(existing.getData().toOverride && { toOverride: existing.getData().toOverride }),
        },
      };
    }
    return baseSuggestion;
  };

  await syncSuggestions({
    opportunity,
    newData,
    buildKey,
    mapNewSuggestion: enhancedMapNewSuggestion,
    log,
  });
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
