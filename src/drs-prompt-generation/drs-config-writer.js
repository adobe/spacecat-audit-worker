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

import { randomUUID } from 'crypto';
import { llmoConfig as sharedLlmoConfig } from '@adobe/spacecat-shared-utils';

/**
 * Groups DRS prompts by category and topic, then writes them into
 * the LLMO config as aiTopics so they appear in the UI and are used
 * by the geo-brand-presence audit.
 *
 * @param {object} params
 * @param {Array<object>} params.drsPrompts - Raw prompts from DRS
 * @param {string} params.siteId - Site identifier
 * @param {object} params.s3Client - AWS S3 client
 * @param {string} params.s3Bucket - S3 bucket name
 * @param {object} params.log - Logger
 * @param {object} [params.configClient] - llmoConfig client (for testing)
 * @returns {Promise<{success: boolean, version?: string}>}
 */
/* c8 ignore start -- tested via drs-config-writer.test.js with injected configClient */
export default async function writeDrsPromptsToLlmoConfig({
  drsPrompts,
  siteId,
  s3Client,
  s3Bucket,
  log,
  configClient = sharedLlmoConfig,
}) {
  const { config } = await configClient.readConfig(siteId, s3Client, { s3Bucket });

  if (!config.aiTopics) {
    config.aiTopics = {};
  }
  if (!config.categories) {
    config.categories = {};
  }

  // Build a lookup of existing category names → UUIDs
  const categoryNameToId = {};
  for (const [id, cat] of Object.entries(config.categories)) {
    categoryNameToId[cat.name.toLowerCase()] = id;
  }

  // Group prompts by topic (DRS topic field) within each category
  // DRS prompt shape: { prompt, region, category, topic, base_url }
  const grouped = {};
  for (const p of drsPrompts) {
    const catName = p.category || 'general';
    const topicName = p.topic || 'general';
    const key = `${catName}|||${topicName}`;

    if (!grouped[key]) {
      grouped[key] = { category: catName, topic: topicName, prompts: [] };
    }
    grouped[key].prompts.push(p);
  }

  const now = new Date().toISOString();
  const categoryRegions = new Map();

  for (const { category: catName, topic: topicName, prompts } of Object.values(grouped)) {
    // Find or create category
    let categoryId = categoryNameToId[catName.toLowerCase()];
    if (!categoryId) {
      categoryId = randomUUID();
      config.categories[categoryId] = {
        name: catName,
        origin: 'ai',
        updatedBy: 'drs',
        updatedAt: now,
      };
      categoryNameToId[catName.toLowerCase()] = categoryId;
    }

    // Track regions for this category
    for (const p of prompts) {
      if (p.region) {
        if (!categoryRegions.has(categoryId)) categoryRegions.set(categoryId, new Set());
        categoryRegions.get(categoryId).add(p.region.toLowerCase());
      }
    }

    // Merge prompts: group by prompt text, collect unique regions and type
    const promptMap = {};
    for (const p of prompts) {
      const text = p.prompt || '';
      if (text) {
        if (!promptMap[text]) {
          promptMap[text] = { regions: new Set(), type: p.type || '' };
        }
        if (p.region) {
          promptMap[text].regions.add(p.region.toLowerCase());
        }
      }
    }

    const aiPrompts = Object.entries(promptMap).map(([text, { regions, type }]) => ({
      id: randomUUID(),
      prompt: text,
      regions: [...regions],
      origin: 'ai',
      source: 'drs',
      updatedBy: 'drs',
      updatedAt: now,
      ...(type && { type }),
    }));

    if (aiPrompts.length > 0) {
      const topicId = randomUUID();
      config.aiTopics[topicId] = {
        name: topicName,
        category: categoryId,
        prompts: aiPrompts,
      };
    }
  }

  // Set region on each category from collected prompt regions
  for (const [catId, regions] of categoryRegions) {
    const arr = [...regions];
    config.categories[catId].region = arr.length === 1 ? arr[0] : arr;
  }

  const { version } = await configClient.writeConfig(siteId, config, s3Client, { s3Bucket });
  log.info(`Wrote ${drsPrompts.length} DRS prompts to LLMO config for site ${siteId} (version: ${version})`);

  return { success: true, version };
  /* c8 ignore stop */
}
