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

import { llmoConfig } from '@adobe/spacecat-shared-utils';
import { ok, internalServerError } from '@adobe/spacecat-shared-http-utils';

const PROMPT_BATCH_SIZE = 3000;

// Temporary: hardcoded site IDs for which the S3-to-DB config sync is enabled.
// TODO: replace with actual site UUIDs per environment.
const ALLOWED_SITE_IDS = [
  '00000000-0000-0000-0000-000000000001', // dev
  '00000000-0000-0000-0000-000000000002', // prod
];

export function isSyncEnabledForSite(siteId) {
  return ALLOWED_SITE_IDS.includes(siteId);
}

function collectPrompts(config, categoryMap, topicMap, brandId, organizationId) {
  const rows = [];

  const addFromTopics = (topicsRecord, status) => {
    if (!topicsRecord) return;
    Object.entries(topicsRecord).forEach(([topicId, topic]) => {
      const topicUuid = topicMap.get(topicId) || null;
      const categoryUuid = topic.category ? (categoryMap.get(topic.category) || null) : null;

      (topic.prompts || []).forEach((p) => {
        const promptId = p.id || `${topicId}-${rows.length}`;
        rows.push({
          organization_id: organizationId,
          brand_id: brandId,
          prompt_id: promptId,
          name: (p.prompt || '').slice(0, 255) || promptId,
          text: p.prompt,
          regions: p.regions || [],
          category_id: categoryUuid,
          topic_id: topicUuid,
          status,
          origin: p.origin || 'human',
          source: p.source || 'config',
          updated_by: 'config-sync',
        });
      });
    });
  };

  addFromTopics(config.topics, 'active');
  addFromTopics(config.aiTopics, 'active');

  if (config.deleted?.prompts) {
    Object.entries(config.deleted.prompts).forEach(([promptId, p]) => {
      const categoryUuid = p.categoryId
        ? (categoryMap.get(p.categoryId) || null)
        : null;
      rows.push({
        organization_id: organizationId,
        brand_id: brandId,
        prompt_id: promptId,
        name: (p.prompt || '').slice(0, 255) || promptId,
        text: p.prompt,
        regions: p.regions || [],
        category_id: categoryUuid,
        topic_id: null,
        status: 'deleted',
        origin: p.origin || 'human',
        source: p.source || 'config',
        updated_by: 'config-sync',
      });
    });
  }

  if (config.ignored?.prompts) {
    Object.entries(config.ignored.prompts).forEach(([promptId, p]) => {
      rows.push({
        organization_id: organizationId,
        brand_id: brandId,
        prompt_id: promptId,
        name: (p.prompt || '').slice(0, 255) || promptId,
        text: p.prompt,
        regions: p.region ? [p.region] : [],
        category_id: null,
        topic_id: null,
        status: 'ignored',
        origin: 'human',
        source: p.source || 'gsc',
        updated_by: 'config-sync',
      });
    });
  }

  return rows;
}

async function upsertInBatches(postgrestClient, table, rows, onConflict, log) {
  let total = 0;
  for (let i = 0; i < rows.length; i += PROMPT_BATCH_SIZE) {
    const batch = rows.slice(i, i + PROMPT_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const { error } = await postgrestClient
      .from(table)
      .upsert(batch, { onConflict });
    if (error) {
      throw new Error(`Failed to upsert ${table} batch ${Math.floor(i / PROMPT_BATCH_SIZE) + 1}: ${error.message}`);
    }
    total += batch.length;
    log.info(`Upserted ${table} batch: ${batch.length} rows (total: ${total}/${rows.length})`);
  }
  return total;
}

async function buildLookupMaps(organizationId, postgrestClient) {
  const [catResult, topicResult] = await Promise.all([
    postgrestClient.from('categories').select('id,category_id').eq('organization_id', organizationId),
    postgrestClient.from('topics').select('id,topic_id').eq('organization_id', organizationId),
  ]);

  const categoryMap = new Map();
  (catResult.data || []).forEach((c) => categoryMap.set(c.category_id, c.id));

  const topicMap = new Map();
  (topicResult.data || []).forEach((t) => topicMap.set(t.topic_id, t.id));

  return { categoryMap, topicMap };
}

export default async function llmoConfigDbSync(message, context) {
  const { log, env } = context;
  const { siteId } = message;

  if (!isSyncEnabledForSite(siteId)) {
    log.info(`Config DB sync skipped: site ${siteId} is not in ALLOWED_SITE_IDS`);
    return ok({ skipped: true, reason: 'site not in allowed list' });
  }

  try {
    const { s3Client, s3Bucket } = context.s3 || {};
    const bucket = s3Bucket || env.S3_IMPORTER_BUCKET_NAME;
    const config = await llmoConfig
      .readConfig(siteId, s3Client, { s3Bucket: bucket });

    if (!config?.config) {
      log.info(`No S3 config found for site ${siteId}`);
      return ok({ skipped: true, reason: 'no config found' });
    }

    const s3Config = config.config;

    const { Site } = context.dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.error(`Site not found: ${siteId}`);
      return ok({ skipped: true, reason: 'site not found' });
    }

    const organizationId = site.getOrganizationId();
    const siteConfig = site.getConfig();
    const brandName = typeof siteConfig?.getLlmoBrand === 'function'
      ? siteConfig.getLlmoBrand()
      : null;

    const postgrestClient = context.dataAccess.services?.postgrestClient;
    if (!postgrestClient?.from) {
      log.error('PostgREST client not available');
      return internalServerError('PostgREST client not available');
    }

    // Step 1: Upsert brand
    const brandRow = {
      organization_id: organizationId,
      name: brandName || 'default',
      status: 'active',
      origin: 'human',
      updated_by: 'config-sync',
    };
    const { data: brandData, error: brandError } = await postgrestClient
      .from('brands')
      .upsert(brandRow, { onConflict: 'organization_id,name' })
      .select('id')
      .single();
    if (brandError) throw new Error(`Failed to upsert brand: ${brandError.message}`);
    const brandId = brandData.id;
    log.info(`Brand upserted: ${brandName || 'default'} (${brandId})`);

    // Step 2: Upsert categories
    const categoryRows = Object.entries(s3Config.categories || {}).map(([catId, cat]) => ({
      organization_id: organizationId,
      category_id: catId,
      name: cat.name,
      origin: cat.origin || 'human',
      status: 'active',
      updated_by: 'config-sync',
    }));
    let categoriesCount = 0;
    if (categoryRows.length > 0) {
      const { error: catError } = await postgrestClient
        .from('categories')
        .upsert(categoryRows, { onConflict: 'organization_id,category_id' });
      if (catError) throw new Error(`Failed to upsert categories: ${catError.message}`);
      categoriesCount = categoryRows.length;
    }
    log.info(`Categories upserted: ${categoriesCount}`);

    // Step 3: Upsert topics
    const topicRows = [];
    const addTopics = (topicsRecord) => {
      if (!topicsRecord) return;
      Object.entries(topicsRecord).forEach(([topicId, topic]) => {
        topicRows.push({
          organization_id: organizationId,
          topic_id: topicId,
          name: topic.name,
          status: 'active',
          updated_by: 'config-sync',
        });
      });
    };
    addTopics(s3Config.topics);
    addTopics(s3Config.aiTopics);

    let topicsCount = 0;
    if (topicRows.length > 0) {
      const { error: topicError } = await postgrestClient
        .from('topics')
        .upsert(topicRows, { onConflict: 'organization_id,topic_id' });
      if (topicError) throw new Error(`Failed to upsert topics: ${topicError.message}`);
      topicsCount = topicRows.length;
    }
    log.info(`Topics upserted: ${topicsCount}`);

    // Step 4: Build lookup maps
    const { categoryMap, topicMap } = await buildLookupMaps(organizationId, postgrestClient);

    // Step 5: Upsert prompts in batches
    const promptRows = collectPrompts(s3Config, categoryMap, topicMap, brandId, organizationId);
    let promptsCount = 0;
    if (promptRows.length > 0) {
      promptsCount = await upsertInBatches(
        postgrestClient,
        'prompts',
        promptRows,
        'brand_id,prompt_id',
        log,
      );
    }
    log.info(`Prompts upserted: ${promptsCount}`);

    const stats = {
      categories: categoriesCount,
      topics: topicsCount,
      prompts: promptsCount,
    };
    log.info(`Config DB sync completed for site ${siteId}`, stats);
    return ok(stats);
  } catch (error) {
    log.error(`Config DB sync failed for site ${siteId}: ${error.message}`, error);
    return internalServerError(`Config DB sync failed: ${error.message}`);
  }
}
