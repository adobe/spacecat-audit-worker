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
