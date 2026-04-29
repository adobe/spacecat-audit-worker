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

import { FETCH_BATCH_SIZE } from './constants.js';

export async function fetchPromptsBatched(postgrestClient, organizationId, log) {
  const allRows = [];
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await postgrestClient
      .from('prompts')
      .select('prompt_id,brand_id,text,topic_id,name,regions,category_id,status,origin,source,created_by,updated_by')
      .eq('organization_id', organizationId)
      .range(offset, offset + FETCH_BATCH_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch prompts at offset ${offset}: ${error.message}`);
    }
    const rows = data || [];
    allRows.push(...rows);
    log.info(`Fetched prompts batch: ${rows.length} rows (total: ${allRows.length})`);
    if (rows.length < FETCH_BATCH_SIZE) {
      break;
    }
    offset += FETCH_BATCH_SIZE;
  }
  return allRows;
}

export async function fetchExistingState(postgrestClient, organizationId, brandId, log) {
  const [catResult, topicResult, promptRows] = await Promise.all([
    postgrestClient.from('categories')
      .select('id,category_id,name,origin,status,created_by,updated_by')
      .eq('organization_id', organizationId),
    postgrestClient.from('topics')
      .select('id,topic_id,name,description,status,created_by,updated_by')
      .eq('organization_id', organizationId)
      .eq('brand_id', brandId),
    fetchPromptsBatched(postgrestClient, organizationId, log),
  ]);

  if (catResult.error) {
    throw new Error(`Failed to fetch categories: ${catResult.error.message}`);
  }
  if (topicResult.error) {
    throw new Error(`Failed to fetch topics: ${topicResult.error.message}`);
  }

  const categoryLookup = new Map();
  const existingCats = new Map();
  (catResult.data || []).forEach((c) => {
    categoryLookup.set(c.category_id, c.id);
    existingCats.set(c.category_id, c);
  });

  const topicLookup = new Map();
  const topicNameLookup = new Map();
  const existingTopics = new Map();
  (topicResult.data || []).forEach((t) => {
    topicLookup.set(t.topic_id, t.id);
    topicNameLookup.set(t.name, t.id);
    existingTopics.set(t.topic_id, t);
  });

  const existingPrompts = new Map();
  promptRows.forEach((p) => {
    existingPrompts.set(`${p.text}\0${p.topic_id || ''}`, p);
  });

  log.info(`Loaded existing state: ${existingCats.size} categories, ${existingTopics.size} topics, ${existingPrompts.size} prompts`);

  return {
    categoryLookup, topicLookup, topicNameLookup, existingCats, existingTopics, existingPrompts,
  };
}
