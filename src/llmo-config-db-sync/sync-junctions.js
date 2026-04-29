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

import { IN_QUERY_CHUNK_SIZE } from './constants.js';

export function buildTopicCategoryRows(config, topicLookup, categoryLookup) {
  const rows = [];
  const seen = new Set();

  const visit = (topicsRecord) => {
    if (!topicsRecord) {
      return;
    }
    Object.entries(topicsRecord).forEach(([topicId, topic]) => {
      const tUuid = topicLookup.get(topicId);
      const cUuid = topic.category ? categoryLookup.get(topic.category) : null;
      if (!tUuid || !cUuid) {
        return;
      }
      const key = `${tUuid}\0${cUuid}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      rows.push({ topic_id: tUuid, category_id: cUuid });
    });
  };

  visit(config.topics);
  visit(config.aiTopics);
  return rows;
}

export async function syncTopicCategories(
  postgrestClient,
  config,
  topicLookup,
  categoryLookup,
  log,
  dryRun = false,
) {
  const tag = dryRun ? '[DRY RUN] ' : '';
  const orgTopicUuids = Array.from(topicLookup.values());

  if (orgTopicUuids.length === 0) {
    log.info(`${tag}topic_categories: no topics found, skipping`);
    return { inserted: 0, deleted: 0 };
  }

  // Chunk topic_id IN-list to stay under the 8KB URL limit (HTTP 414).
  const existingData = [];
  for (let i = 0; i < orgTopicUuids.length; i += IN_QUERY_CHUNK_SIZE) {
    const chunk = orgTopicUuids.slice(i, i + IN_QUERY_CHUNK_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const { data, error: fetchError } = await postgrestClient
      .from('topic_categories')
      .select('topic_id,category_id')
      .in('topic_id', chunk);
    if (fetchError) {
      throw new Error(`Failed to fetch topic_categories: ${fetchError.message}`);
    }
    existingData.push(...(data || []));
  }

  const existingKeys = new Set(existingData.map((r) => `${r.topic_id}\0${r.category_id}`));
  const desiredRows = buildTopicCategoryRows(config, topicLookup, categoryLookup);
  const desiredKeys = new Set(desiredRows.map((r) => `${r.topic_id}\0${r.category_id}`));

  const toInsert = desiredRows.filter((r) => !existingKeys.has(`${r.topic_id}\0${r.category_id}`));
  const orphanRows = existingData.filter((r) => !desiredKeys.has(`${r.topic_id}\0${r.category_id}`));

  log.info(`[DIFF] topic_categories: ${toInsert.length} to insert, ${orphanRows.length} to delete`);

  if (orphanRows.length > 0) {
    log.info(`${tag}[topic_categories] Deleting ${orphanRows.length} orphaned rows`);
    if (!dryRun) {
      const byTopic = new Map();
      orphanRows.forEach(({ topic_id: tId, category_id: cId }) => {
        if (!byTopic.has(tId)) {
          byTopic.set(tId, []);
        }
        byTopic.get(tId).push(cId);
      });

      for (const [topicId, categoryIds] of byTopic) {
        // eslint-disable-next-line no-await-in-loop
        const { error: delError } = await postgrestClient
          .from('topic_categories')
          .delete()
          .eq('topic_id', topicId)
          .in('category_id', categoryIds);
        if (delError) {
          throw new Error(`Failed to delete topic_categories for topic ${topicId}: ${delError.message}`);
        }
      }
    }
  }

  if (toInsert.length > 0 && !dryRun) {
    const { error: upsertError } = await postgrestClient
      .from('topic_categories')
      .upsert(toInsert, { onConflict: 'topic_id,category_id' });
    if (upsertError) {
      throw new Error(`Failed to upsert topic_categories: ${upsertError.message}`);
    }
  }

  log.info(`${tag}topic_categories: ${toInsert.length} inserted, ${orphanRows.length} deleted`);
  return { inserted: toInsert.length, deleted: orphanRows.length };
}
