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

import { v5 as uuidv5 } from 'uuid';
import { PROMPT_COMPARE_FIELDS, PROMPT_ID_NAMESPACE, UPSERT_BATCH_SIZE } from './constants.js';
import { diffRows, logDiffSummary } from './diff.js';

function promptLookupKey(text, topicId) {
  return `${text}\0${topicId || ''}`;
}

export function resolvePromptId(p, topicId, topicUuid, existingPrompts) {
  const existing = existingPrompts.get(promptLookupKey(p.prompt, topicUuid));
  if (existing) {
    return existing.prompt_id;
  }
  if (!p.prompt) {
    return null;
  }
  return uuidv5(`${topicId}:${p.prompt}`, PROMPT_ID_NAMESPACE);
}

export function collectPrompts(
  config,
  categoryLookup,
  topicLookup,
  topicNameLookup,
  brandId,
  organizationId,
  existingPrompts,
  log,
) {
  const rows = [];

  const addFromTopics = (topicsRecord, status) => {
    if (!topicsRecord) {
      return;
    }
    Object.entries(topicsRecord).forEach(([topicId, topic]) => {
      const topicUuid = topicLookup.get(topicId) || null;
      const categoryUuid = topic.category ? (categoryLookup.get(topic.category) || null) : null;

      (topic.prompts || []).forEach((p, index) => {
        const promptId = resolvePromptId(p, topicId, topicUuid, existingPrompts);
        if (!promptId) {
          log.error(`Skipping prompt without text in topic "${topicId}" at index ${index}`);
          return;
        }
        rows.push({
          organization_id: organizationId,
          brand_id: brandId,
          prompt_id: promptId,
          name: (p.prompt || '').slice(0, 255) || promptId,
          text: p.prompt,
          regions: (p.regions || []).map((r) => r.toUpperCase()),
          category_id: categoryUuid,
          topic_id: topicUuid,
          status,
          origin: p.origin || 'human',
          source: p.source || 'config',
          created_by: p.createdBy || null,
          updated_by: p.updatedBy || null,
        });
      });
    });
  };

  addFromTopics(config.topics, 'active');
  addFromTopics(config.aiTopics, 'active');

  if (config.deleted?.prompts) {
    Object.entries(config.deleted.prompts).forEach(([configPromptId, p]) => {
      if (!p.topic) {
        log.warn(`Skipping deleted prompt "${configPromptId}": no topic field`);
        return;
      }
      const topicUuid = topicNameLookup.get(p.topic) || null;
      if (!topicUuid) {
        log.warn(`Skipping deleted prompt "${configPromptId}": topic "${p.topic}" could not be resolved by name`);
        return;
      }
      const categoryUuid = p.categoryId ? (categoryLookup.get(p.categoryId) || null) : null;
      const existingRow = existingPrompts.get(promptLookupKey(p.prompt, topicUuid));
      const promptId = (existingRow && existingRow.prompt_id) || configPromptId;
      rows.push({
        organization_id: organizationId,
        brand_id: brandId,
        prompt_id: promptId,
        name: (p.prompt || '').slice(0, 255) || promptId,
        text: p.prompt,
        regions: (p.regions || []).map((r) => r.toUpperCase()),
        category_id: categoryUuid,
        topic_id: topicUuid,
        status: 'deleted',
        origin: p.origin || 'human',
        source: p.source || 'config',
        created_by: p.createdBy || null,
        updated_by: p.updatedBy || null,
      });
    });
  }

  if (config.ignored?.prompts) {
    Object.entries(config.ignored.prompts).forEach(([configPromptId, p]) => {
      const existingRow = existingPrompts.get(promptLookupKey(p.prompt, null));
      const promptId = (existingRow?.prompt_id) || configPromptId;
      rows.push({
        organization_id: organizationId,
        brand_id: brandId,
        prompt_id: promptId,
        name: (p.prompt || '').slice(0, 255) || promptId,
        text: p.prompt,
        regions: p.region ? [p.region.toUpperCase()] : [],
        category_id: null,
        topic_id: null,
        status: 'ignored',
        origin: 'human',
        source: p.source || 'config',
        created_by: p.createdBy || null,
        updated_by: p.updatedBy || null,
      });
    });
  }

  return rows;
}

export async function upsertInBatches(postgrestClient, table, rows, onConflict, log) {
  let total = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const { error } = await postgrestClient
      .from(table)
      .upsert(batch, { onConflict });
    if (error) {
      throw new Error(`Failed to upsert ${table} batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}: ${error.message}`);
    }
    total += batch.length;
    log.info(`Upserted ${table} batch: ${batch.length} rows (total: ${total}/${rows.length})`);
  }
  return total;
}

export async function syncPrompts(
  postgrestClient,
  s3Config,
  categoryLookup,
  topicLookup,
  topicNameLookup,
  brandId,
  organizationId,
  existingPrompts,
  log,
  dryRun = false,
) {
  const tag = dryRun ? '[DRY RUN] ' : '';
  const promptRows = collectPrompts(
    s3Config,
    categoryLookup,
    topicLookup,
    topicNameLookup,
    brandId,
    organizationId,
    existingPrompts,
    log,
  );
  const promptDiff = diffRows(
    promptRows,
    existingPrompts,
    (r) => promptLookupKey(r.text, r.topic_id),
    PROMPT_COMPARE_FIELDS,
  );
  logDiffSummary(log, 'prompts', promptDiff.dryRunInserts, promptDiff.dryRunUpdates);

  if (promptDiff.toUpsert.length > 0 && !dryRun) {
    await upsertInBatches(postgrestClient, 'prompts', promptDiff.toUpsert, 'brand_id,prompt_id', log);
  }

  log.info(`${tag}Prompts: ${promptDiff.stats.inserted} inserted, ${promptDiff.stats.updated} updated, ${promptDiff.stats.unchanged} unchanged`);
  return promptDiff.stats;
}
