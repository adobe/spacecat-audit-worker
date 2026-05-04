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
import { TOPIC_COMPARE_FIELDS, TOPIC_ID_NAMESPACE } from './constants.js';
import { diffRows, logDiffSummary } from './diff.js';

export function buildTopicRows(s3Config, organizationId, brandId) {
  const rows = [];
  const addTopics = (topicsRecord) => {
    if (!topicsRecord) {
      return;
    }
    Object.entries(topicsRecord).forEach(([topicId, topic]) => {
      rows.push({
        organization_id: organizationId,
        brand_id: brandId,
        topic_id: topicId,
        name: topic.name,
        description: topic.description || null,
        status: 'active',
        created_by: topic.createdBy || null,
        updated_by: topic.updatedBy || null,
      });
    });
  };
  addTopics(s3Config.topics);
  addTopics(s3Config.aiTopics);
  return rows;
}

export async function ensureDeletedRefEntities(
  postgrestClient,
  s3Config,
  organizationId,
  brandId,
  categoryLookup,
  topicLookup,
  topicNameLookup,
  log,
  dryRun = false,
) {
  const tag = dryRun ? '[DRY RUN] ' : '';
  if (!s3Config.deleted?.prompts) {
    return;
  }

  const seenTopicNames = new Set();
  const seenCatIds = new Set();
  const missingTopicRows = [];
  const missingCatRows = [];

  Object.values(s3Config.deleted.prompts).forEach((p) => {
    if (p.topic && !topicNameLookup.has(p.topic) && !seenTopicNames.has(p.topic)) {
      seenTopicNames.add(p.topic);
      missingTopicRows.push({
        organization_id: organizationId,
        brand_id: brandId,
        topic_id: uuidv5(p.topic, TOPIC_ID_NAMESPACE),
        name: p.topic,
        description: null,
        status: 'deleted',
        created_by: null,
        updated_by: null,
      });
    }
    if (p.categoryId && !categoryLookup.has(p.categoryId) && !seenCatIds.has(p.categoryId)) {
      seenCatIds.add(p.categoryId);
      missingCatRows.push({
        organization_id: organizationId,
        category_id: p.categoryId,
        name: p.category || p.categoryId,
        origin: 'human',
        status: 'deleted',
        created_by: null,
        updated_by: null,
      });
    }
  });

  if (missingCatRows.length > 0) {
    logDiffSummary(log, 'deleted-ref categories', missingCatRows, []);
    if (!dryRun) {
      const { data: catData, error: catError } = await postgrestClient
        .from('categories')
        .upsert(missingCatRows, { onConflict: 'organization_id,category_id' })
        .select('id,category_id');
      if (catError) {
        throw new Error(`Failed to upsert deleted-ref categories: ${catError.message}`);
      }
      (catData || []).forEach((c) => categoryLookup.set(c.category_id, c.id));
    }
    log.info(`${tag}Deleted-ref categories: ${missingCatRows.length} ensured`);
  }

  if (missingTopicRows.length > 0) {
    logDiffSummary(log, 'deleted-ref topics', missingTopicRows, []);
    if (!dryRun) {
      const { data: topicData, error: topicError } = await postgrestClient
        .from('topics')
        .upsert(missingTopicRows, { onConflict: 'organization_id,topic_id' })
        .select('id,topic_id,name');
      if (topicError) {
        throw new Error(`Failed to upsert deleted-ref topics: ${topicError.message}`);
      }
      (topicData || []).forEach((t) => {
        topicLookup.set(t.topic_id, t.id);
        topicNameLookup.set(t.name, t.id);
      });
    }
    log.info(`${tag}Deleted-ref topics: ${missingTopicRows.length} ensured`);
  }
}

export async function syncTopics(
  postgrestClient,
  s3Config,
  organizationId,
  brandId,
  existingTopics,
  topicLookup,
  topicNameLookup,
  log,
  dryRun = false,
) {
  const tag = dryRun ? '[DRY RUN] ' : '';
  const topicRows = buildTopicRows(s3Config, organizationId, brandId);
  const topicDiff = diffRows(topicRows, existingTopics, (r) => r.topic_id, TOPIC_COMPARE_FIELDS);
  logDiffSummary(log, 'topics', topicDiff.dryRunInserts, topicDiff.dryRunUpdates);

  if (topicDiff.toUpsert.length > 0 && !dryRun) {
    const { data: topicData, error: topicError } = await postgrestClient
      .from('topics')
      .upsert(topicDiff.toUpsert, { onConflict: 'organization_id,topic_id' })
      .select('id,topic_id,name');
    if (topicError) {
      throw new Error(`Failed to upsert topics: ${topicError.message}`);
    }
    (topicData || []).forEach((t) => {
      topicLookup.set(t.topic_id, t.id);
      topicNameLookup.set(t.name, t.id);
    });
  }

  log.info(`${tag}Topics: ${topicDiff.stats.inserted} inserted, ${topicDiff.stats.updated} updated, ${topicDiff.stats.unchanged} unchanged`);
  return topicDiff.stats;
}
