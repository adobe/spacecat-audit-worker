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

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dirName = dirname(fileURLToPath(import.meta.url));

/**
 * Loads the per-site topic dataset from the bundled data directory.
 * The filename is derived from the site hostname (e.g. adobe.com → adobe-com-sample.json).
 * Throws if no data file exists for the given site.
 */
export function loadTopicsForSite(baseUrl) {
  const hostname = new URL(baseUrl).hostname.replace(/\./g, '-');
  const dataFile = join(dirName, `data/${hostname}-sample.json`);
  if (!existsSync(dataFile)) {
    throw new Error(`No topic data available for ${baseUrl} (expected ${hostname}-sample.json)`);
  }
  return JSON.parse(readFileSync(dataFile, 'utf-8'));
}

/**
 * Scores and selects the top content-gap topics from the dataset.
 * Opportunity score = volume × (1 − citation_share) × (1 − owned_keywords_share).
 * High volume with low existing AI and organic presence signals an untapped gap.
 */
export function selectTopTopics(topics, count = 5) {
  const seen = new Set();
  return topics
    .filter(({ adobe_topic: t }) => {
      if (seen.has(t)) {
        return false;
      }
      seen.add(t);
      return true;
    })
    .map((t) => ({
      ...t,
      opportunityScore: t.volume * (1 - t.citation_share) * (1 - t.owned_keywords_share),
    }))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, count);
}
