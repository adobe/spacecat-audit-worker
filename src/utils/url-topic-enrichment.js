/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Enriches URL items with topic metadata (categories, timesCited, prompts)
 * by cross-referencing each URL against the urls arrays inside topics.
 *
 * Used by reddit-analysis and youtube-analysis handlers before sending
 * the SQS message to Mystique.
 *
 * @param {Array<Object>} urls - URL items from the URL Store, each with at least { url }
 * @param {Array<Object>} topics - Topics from sentiment config, each with a urls array
 *   containing { url, category, timesCited, subPrompts }
 * @returns {Array<Object>} Enriched URL items with added categories, timesCited, and prompts
 */
function getWantedUrls(urls) {
  const wantedUrls = new Set();

  for (const urlItem of urls) {
    if (urlItem.url) {
      wantedUrls.add(urlItem.url.toLowerCase());
    }
  }

  return wantedUrls;
}

function createAggregatedTopicData() {
  return {
    categories: new Set(),
    prompts: new Set(),
    timesCited: 0,
  };
}

function buildTopicLookup(urls, topics) {
  const wantedUrls = getWantedUrls(urls);
  const topicLookup = new Map();

  for (const topic of topics) {
    for (const topicUrl of (topic.urls || [])) {
      const normalized = topicUrl.url?.toLowerCase();

      if (!normalized || !wantedUrls.has(normalized)) {
        // eslint-disable-next-line no-continue
        continue;
      }

      let aggregated = topicLookup.get(normalized);
      if (!aggregated) {
        aggregated = createAggregatedTopicData();
        topicLookup.set(normalized, aggregated);
      }

      if (topicUrl.category) {
        aggregated.categories.add(topicUrl.category);
      }

      aggregated.timesCited = Math.max(
        aggregated.timesCited,
        Number(topicUrl.timesCited) || 0,
      );

      for (const prompt of (topicUrl.subPrompts || [])) {
        if (prompt) {
          aggregated.prompts.add(prompt);
        }
      }
    }
  }

  return topicLookup;
}

export function enrichUrlsWithTopicData(urls, topics) {
  if (!urls?.length || !topics?.length) return urls || [];

  const topicLookup = buildTopicLookup(urls, topics);

  return urls.map((urlItem) => {
    const normalized = urlItem.url?.toLowerCase();
    const match = normalized ? topicLookup.get(normalized) : null;
    if (!match) return urlItem;

    return {
      ...urlItem,
      ...(match.categories.size > 0 && { categories: [...match.categories] }),
      ...(match.timesCited > 0 && { timesCited: match.timesCited }),
      ...(match.prompts.size > 0 && { prompts: [...match.prompts] }),
    };
  });
}
