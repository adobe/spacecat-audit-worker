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

export function buildTopicPromptRows(promptsWithIds) {
  return promptsWithIds
    .filter((p) => p.topic_id !== null && p.topic_id !== undefined)
    .map((p) => ({ topic_id: p.topic_id, prompt_id: p.id }));
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

  const { data: existingData, error: fetchError } = await postgrestClient
    .from('topic_categories')
    .select('topic_id,category_id')
    .in('topic_id', orgTopicUuids);
  if (fetchError) {
    throw new Error(`Failed to fetch topic_categories: ${fetchError.message}`);
  }

  const existingKeys = new Set((existingData || []).map((r) => `${r.topic_id}\0${r.category_id}`));
  const desiredRows = buildTopicCategoryRows(config, topicLookup, categoryLookup);
  const desiredKeys = new Set(desiredRows.map((r) => `${r.topic_id}\0${r.category_id}`));

  const toInsert = desiredRows.filter((r) => !existingKeys.has(`${r.topic_id}\0${r.category_id}`));
  const orphanRows = (existingData || []).filter((r) => !desiredKeys.has(`${r.topic_id}\0${r.category_id}`));

  log.info(`[DIFF] topic_categories: ${toInsert.length} to insert, ${orphanRows.length} to delete`);

  if (orphanRows.length > 0) {
    log.info(`${tag}[topic_categories] Deleting ${orphanRows.length} orphaned rows`);
    if (!dryRun) {
      for (const orphan of orphanRows) {
        // eslint-disable-next-line no-await-in-loop
        const { error: delError } = await postgrestClient
          .from('topic_categories')
          .delete()
          .eq('topic_id', orphan.topic_id)
          .eq('category_id', orphan.category_id);
        if (delError) {
          throw new Error(`Failed to delete topic_categories row: ${delError.message}`);
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

export async function syncTopicPrompts(
  postgrestClient,
  organizationId,
  promptsWithIds,
  log,
  dryRun = false,
) {
  const tag = dryRun ? '[DRY RUN] ' : '';

  const { data: existingData, error: fetchError } = await postgrestClient
    .from('topic_prompts')
    .select('topic_id,prompt_id')
    .eq('organization_id', organizationId);
  if (fetchError) {
    throw new Error(`Failed to fetch topic_prompts: ${fetchError.message}`);
  }

  const existingKeys = new Set((existingData || []).map((r) => `${r.topic_id}\0${r.prompt_id}`));
  const desiredRows = buildTopicPromptRows(promptsWithIds);
  const desiredKeys = new Set(desiredRows.map((r) => `${r.topic_id}\0${r.prompt_id}`));

  const toInsert = desiredRows.filter((r) => !existingKeys.has(`${r.topic_id}\0${r.prompt_id}`));
  const orphanRows = (existingData || []).filter((r) => !desiredKeys.has(`${r.topic_id}\0${r.prompt_id}`));

  log.info(`[DIFF] topic_prompts: ${toInsert.length} to insert, ${orphanRows.length} to delete`);

  if (orphanRows.length > 0) {
    log.info(`${tag}[topic_prompts] Deleting ${orphanRows.length} orphaned rows`);
    if (!dryRun) {
      // Group orphans by topic_id for bulk delete
      const byTopic = new Map();
      orphanRows.forEach(({ topic_id: tId, prompt_id: pId }) => {
        if (!byTopic.has(tId)) {
          byTopic.set(tId, []);
        }
        byTopic.get(tId).push(pId);
      });

      for (const [topicId, promptIds] of byTopic) {
        // eslint-disable-next-line no-await-in-loop
        const { error: delError } = await postgrestClient
          .from('topic_prompts')
          .delete()
          .eq('topic_id', topicId)
          .in('prompt_id', promptIds);
        if (delError) {
          throw new Error(`Failed to delete topic_prompts for topic ${topicId}: ${delError.message}`);
        }
      }
    }
  }

  if (toInsert.length > 0 && !dryRun) {
    const { error: upsertError } = await postgrestClient
      .from('topic_prompts')
      .upsert(toInsert, { onConflict: 'topic_id,prompt_id' });
    if (upsertError) {
      throw new Error(`Failed to upsert topic_prompts: ${upsertError.message}`);
    }
  }

  log.info(`${tag}topic_prompts: ${toInsert.length} inserted, ${orphanRows.length} deleted`);
  return { inserted: toInsert.length, deleted: orphanRows.length };
}
