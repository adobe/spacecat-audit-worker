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

// Region values must match the schema in @adobe/spacecat-shared-utils
// (ISO-3166 alpha-2). Upstream DRS occasionally emits non-conformant values
// like "en-us" or "global" — those would corrupt the LLMO config and break
// every subsequent schema-validated read. See SITES-43238.
const REGION_REGEX = /^[a-z]{2}$/;

function normalizeRegion(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const lc = raw.toLowerCase();
  return REGION_REGEX.test(lc) ? lc : null;
}

/**
 * Groups DRS prompts by category and topic, then writes them into
 * the LLMO config as aiTopics so they appear in the UI and are used
 * by downstream brand-presence analysis flows.
 *
 * Non-alpha-2 region values are dropped (with an aggregated WARN log)
 * before grouping so they cannot reach the schema-validated S3 config.
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
  const droppedRegions = new Map();
  const normalizedPrompts = drsPrompts.map((p) => {
    if (!p.region) {
      return p;
    }
    const valid = normalizeRegion(p.region);
    if (valid) {
      return { ...p, region: valid };
    }
    droppedRegions.set(p.region, (droppedRegions.get(p.region) || 0) + 1);
    const rest = { ...p };
    delete rest.region;
    return rest;
  });
  if (droppedRegions.size > 0) {
    const summary = Object.fromEntries(droppedRegions);
    log.warn(`Dropped non-alpha-2 region values from DRS prompts for site ${siteId}: ${JSON.stringify(summary)}`);
  }

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
  for (const p of normalizedPrompts) {
    const catName = p.category || 'general';
    const topicName = p.topic || 'general';
    const key = `${catName}|||${topicName}`;

    if (!grouped[key]) {
      grouped[key] = { category: catName, topic: topicName, prompts: [] };
    }
    grouped[key].prompts.push(p);
  }

  // Determine which categories have at least one prompt with a valid region
  // across all their topics. New categories without a valid region cannot be
  // safely persisted because the schema requires `region`.
  const categoriesWithValidRegion = new Set();
  for (const p of normalizedPrompts) {
    if (p.region) {
      categoriesWithValidRegion.add((p.category || 'general').toLowerCase());
    }
  }

  // Drop any group whose category is new AND has no valid region to assign,
  // so we never create a category that violates the schema.
  const droppedCategories = new Set();
  const groupsToProcess = Object.values(grouped).filter((group) => {
    const catKey = group.category.toLowerCase();
    const isNew = !categoryNameToId[catKey];
    if (isNew && !categoriesWithValidRegion.has(catKey)) {
      droppedCategories.add(group.category);
      return false;
    }
    return true;
  });

  const now = new Date().toISOString();
  const categoryRegions = new Map();

  for (const { category: catName, topic: topicName, prompts } of groupsToProcess) {
    const catKey = catName.toLowerCase();
    let categoryId = categoryNameToId[catKey];

    if (!categoryId) {
      categoryId = randomUUID();
      config.categories[categoryId] = {
        name: catName,
        origin: 'ai',
        updatedBy: 'drs',
        updatedAt: now,
      };
      categoryNameToId[catKey] = categoryId;
    }

    // Track regions for this category
    for (const p of prompts) {
      if (p.region) {
        if (!categoryRegions.has(categoryId)) {
          categoryRegions.set(categoryId, new Set());
        }
        categoryRegions.get(categoryId).add(p.region);
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
          promptMap[text].regions.add(p.region);
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

  if (droppedCategories.size > 0) {
    log.warn(`Skipped DRS categories with no valid region for site ${siteId}: ${JSON.stringify([...droppedCategories])}`);
  }

  const { version } = await configClient.writeConfig(siteId, config, s3Client, { s3Bucket });
  log.info(`Wrote ${drsPrompts.length} DRS prompts to LLMO config for site ${siteId} (version: ${version})`);

  return { success: true, version };
  /* c8 ignore stop */
}
