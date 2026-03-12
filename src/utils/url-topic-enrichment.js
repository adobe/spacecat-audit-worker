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
export function enrichUrlsWithTopicData(urls, topics) {
  if (!urls?.length || !topics?.length) return urls || [];

  const topicLookup = new Map();

  for (const topic of topics) {
    for (const topicUrl of (topic.urls || [])) {
      if (topicUrl.url) {
        const normalized = topicUrl.url.toLowerCase();
        if (!topicLookup.has(normalized)) {
          topicLookup.set(normalized, []);
        }
        topicLookup.set(normalized, [...topicLookup.get(normalized), topicUrl]);
      }
    }
  }

  return urls.map((urlItem) => {
    const normalized = urlItem.url?.toLowerCase();
    const matches = topicLookup.get(normalized);
    if (!matches || matches.length === 0) return urlItem;

    const categories = [...new Set(
      matches.map((m) => m.category).filter(Boolean),
    )];

    const timesCited = matches.reduce(
      (max, m) => Math.max(max, Number(m.timesCited) || 0),
      0,
    );

    const prompts = [...new Set(
      matches.flatMap((m) => m.subPrompts || []).filter(Boolean),
    )];

    return {
      ...urlItem,
      ...(categories.length > 0 && { categories }),
      ...(timesCited > 0 && { timesCited }),
      ...(prompts.length > 0 && { prompts }),
    };
  });
}
