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

/* c8 ignore start */

import { v5 as uuidv5 } from 'uuid';
import { llmoConfig } from '@adobe/spacecat-shared-utils';
import { ok, internalServerError } from '@adobe/spacecat-shared-http-utils';

const UPSERT_BATCH_SIZE = 3000;
const FETCH_BATCH_SIZE = 5000;
const PROMPT_ID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';
const TOPIC_ID_NAMESPACE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const CATEGORY_COMPARE_FIELDS = ['name', 'origin', 'status'];
const TOPIC_COMPARE_FIELDS = ['name', 'description', 'status'];
const PROMPT_COMPARE_FIELDS = ['name', 'regions', 'category_id', 'status', 'origin', 'source'];

// Temporary: hardcoded site IDs for which the S3-to-DB config sync is enabled.
const PROD_SITE_ID = '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3';
const ALLOWED_SITE_IDS = [
  '00000000-0000-0000-0000-000000000001', // dev
  '00000000-0000-0000-0000-000000000002', // prod - to be removed
  'c2473d89-e997-458d-a86d-b4096649c12b', // dev URL
  PROD_SITE_ID, // prod URL
];

export function isSyncEnabledForSite(siteId) {
  return ALLOWED_SITE_IDS.includes(siteId);
}

function promptLookupKey(text, topicId) {
  return `${text}\0${topicId || ''}`;
}

function normalizeForCompare(field, value) {
  if (field === 'regions' && Array.isArray(value)) {
    return JSON.stringify(value.map((r) => r.toUpperCase()));
  }
  return JSON.stringify(value);
}

function changedFields(newRow, existingRow, fields) {
  return fields.filter(
    (f) => normalizeForCompare(f, newRow[f]) !== normalizeForCompare(f, existingRow[f]),
  );
}

function diffRows(desiredRows, existingByKey, keyFn, compareFields) {
  const toUpsert = [];
  const dryRunInserts = [];
  const dryRunUpdates = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of desiredRows) {
    const existing = existingByKey.get(keyFn(row));
    if (!existing) {
      toUpsert.push(row);
      dryRunInserts.push(row);
      inserted += 1;
    } else {
      const changed = changedFields(row, existing, compareFields);
      if (changed.length > 0) {
        toUpsert.push(row);
        dryRunUpdates.push({ ...row, _changedFields: changed, _existing: existing });
        updated += 1;
      } else {
        unchanged += 1;
      }
    }
  }

  return {
    toUpsert, dryRunInserts, dryRunUpdates, stats: { inserted, updated, unchanged },
  };
}

function logDryRunSummary(log, label, toInsert, toUpdate) {
  log.info(`[DRY RUN] ${label}: ${toInsert.length} to insert, ${toUpdate.length} to update`);

  toUpdate.slice(0, 100).forEach((row) => {
    const { _changedFields, _existing, ...data } = row;
    const keyFields = Object.entries(data)
      .filter(([k]) => k.endsWith('_id') && !_changedFields.includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

    const diff = _changedFields.map((f) => {
      const oldVal = JSON.stringify(_existing[f]);
      const newVal = JSON.stringify(data[f]);
      return `  ${f}: ${oldVal} → ${newVal}`;
    }).join('\n');

    log.info(`[DRY RUN] ${label} UPDATE [${keyFields}]:\n${diff}`);
  });

  toInsert.slice(0, 5).forEach((row) => {
    log.info(`[DRY RUN] ${label} INSERT: ${JSON.stringify(row)}`);
  });

  if (toUpdate.length > 0) {
    const fieldFreq = {};
    toUpdate.forEach(({ _changedFields }) => {
      _changedFields.forEach((f) => {
        fieldFreq[f] = (fieldFreq[f] || 0) + 1;
      });
    });
    const summary = Object.entries(fieldFreq)
      .map(([f, count]) => `${f}: ${count}`)
      .join(', ');
    log.info(`[DRY RUN] ${label} changed-field distribution: ${summary}`);
  }
}

async function fetchPromptsBatched(postgrestClient, organizationId, log) {
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
      log.error(`Failed to fetch prompts at offset ${offset}: ${error.message}`);
      break;
    }
    const rows = data || [];
    allRows.push(...rows);
    log.info(`Fetched prompts batch: ${rows.length} rows (total: ${allRows.length})`);
    if (rows.length < FETCH_BATCH_SIZE) break;
    offset += FETCH_BATCH_SIZE;
  }
  return allRows;
}

async function fetchExistingState(postgrestClient, organizationId, log) {
  const [catResult, topicResult, promptRows] = await Promise.all([
    postgrestClient.from('categories')
      .select('id,category_id,name,origin,status,created_by,updated_by')
      .eq('organization_id', organizationId),
    postgrestClient.from('topics')
      .select('id,topic_id,name,description,status,created_by,updated_by')
      .eq('organization_id', organizationId),
    fetchPromptsBatched(postgrestClient, organizationId, log),
  ]);

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
    existingPrompts.set(promptLookupKey(p.text, p.topic_id), p);
  });

  log.info(`Loaded existing state: ${existingCats.size} categories, ${existingTopics.size} topics, ${existingPrompts.size} prompts`);

  return {
    categoryLookup, topicLookup, topicNameLookup, existingCats, existingTopics, existingPrompts,
  };
}

function resolvePromptId(p, topicId, topicUuid, existingPrompts) {
  const existing = existingPrompts.get(promptLookupKey(p.prompt, topicUuid));
  if (existing) {
    return existing.prompt_id;
  }
  if (!p.prompt) return null;
  const generated = uuidv5(`${topicId}:${p.prompt}`, PROMPT_ID_NAMESPACE);
  return generated;
}

function collectPrompts(
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
    if (!topicsRecord) return;
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

  return rows;
}

async function upsertInBatches(postgrestClient, table, rows, onConflict, log) {
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

export default async function llmoConfigDbSync(message, context) {
  const { log, env } = context;
  const PROD_SITE_IDS = [PROD_SITE_ID];
  const { siteId, dryRun: dryRunParam = true } = message;
  const dryRun = PROD_SITE_IDS.includes(siteId) ? true : dryRunParam;
  const tag = dryRun ? '[llmo-config-db-sync] [DRY RUN] ' : '[llmo-config-db-sync]';

  if (!isSyncEnabledForSite(siteId)) {
    log.info(`Config DB sync skipped: site ${siteId} is not in ALLOWED_SITE_IDS`);
    return ok({ skipped: true, reason: 'site not in allowed list' });
  }

  try {
    log.info(`[llmo-config-db-sync] Starting config DB sync for siteId: ${siteId}, dryRun: ${dryRun}`);
    const { s3Client } = context;
    const bucket = env.S3_IMPORTER_BUCKET_NAME;
    const config = await llmoConfig
      .readConfig(siteId, s3Client, { s3Bucket: bucket });

    if (!config?.config) {
      log.info(`No S3 config found for site ${siteId}`);
      return ok({ skipped: true, reason: 'no config found' });
    }
    log.info(`[llmo-config-db-sync] S3 config found for site ${siteId}`);
    const s3Config = config.config;

    const { Site } = context.dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.error(`Site not found: ${siteId}`);
      return ok({ skipped: true, reason: 'site not found' });
    }

    const organizationId = site.getOrganizationId();
    const postgrestClient = context.dataAccess.services?.postgrestClient;
    if (!postgrestClient?.from) {
      log.error('PostgREST client not available');
      return internalServerError('PostgREST client not available');
    }

    // TODO: replace with dynamic brand resolution once brands exist in the S3 config
    const PROD_BRAND_ID = '3e3556f0-6494-4e8f-858f-01f2c358861a';
    const DEV_BRAND_ID = '019cb903-1184-742b-9a16-bc7a8696962f';
    const brandId = siteId === PROD_SITE_ID
      ? PROD_BRAND_ID
      : DEV_BRAND_ID;
    log.info(`${tag}Using fixed brand ID: ${brandId}`);

    // Step 2: Fetch all existing state in parallel
    const {
      categoryLookup, topicLookup, topicNameLookup,
      existingCats, existingTopics, existingPrompts,
    } = await fetchExistingState(postgrestClient, organizationId, log);

    // Step 3: Build & diff categories
    const categoryRows = Object.entries(s3Config.categories || {}).map(([catId, cat]) => ({
      organization_id: organizationId,
      category_id: catId,
      name: cat.name,
      origin: cat.origin || 'human',
      status: 'active',
      created_by: cat.createdBy || null,
      updated_by: cat.updatedBy || null,
    }));
    const catDiff = diffRows(
      categoryRows,
      existingCats,
      (r) => r.category_id,
      CATEGORY_COMPARE_FIELDS,
    );
    if (catDiff.toUpsert.length > 0) {
      if (dryRun) {
        logDryRunSummary(log, 'categories', catDiff.dryRunInserts, catDiff.dryRunUpdates);
      } else {
        const { data: catData, error: catError } = await postgrestClient
          .from('categories')
          .upsert(catDiff.toUpsert, { onConflict: 'organization_id,category_id' })
          .select('id,category_id');
        if (catError) throw new Error(`Failed to upsert categories: ${catError.message}`);
        (catData || []).forEach((c) => categoryLookup.set(c.category_id, c.id));
      }
    }
    log.info(`${tag}Categories: ${catDiff.stats.inserted} inserted, ${catDiff.stats.updated} updated, ${catDiff.stats.unchanged} unchanged`);

    // Step 4: Build & diff topics
    const topicRows = [];
    const addTopics = (topicsRecord) => {
      if (!topicsRecord) return;
      Object.entries(topicsRecord).forEach(([topicId, topic]) => {
        topicRows.push({
          organization_id: organizationId,
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

    const topicDiff = diffRows(
      topicRows,
      existingTopics,
      (r) => r.topic_id,
      TOPIC_COMPARE_FIELDS,
    );
    if (topicDiff.toUpsert.length > 0) {
      if (dryRun) {
        logDryRunSummary(log, 'topics', topicDiff.dryRunInserts, topicDiff.dryRunUpdates);
      } else {
        const { data: topicData, error: topicError } = await postgrestClient
          .from('topics')
          .upsert(topicDiff.toUpsert, { onConflict: 'organization_id,topic_id' })
          .select('id,topic_id,name');
        if (topicError) throw new Error(`Failed to upsert topics: ${topicError.message}`);
        (topicData || []).forEach((t) => {
          topicLookup.set(t.topic_id, t.id);
          topicNameLookup.set(t.name, t.id);
        });
      }
    }
    log.info(`${tag}Topics: ${topicDiff.stats.inserted} inserted, ${topicDiff.stats.updated} updated, ${topicDiff.stats.unchanged} unchanged`);

    // Step 4b: Ensure topics & categories referenced only by deleted prompts exist
    if (s3Config.deleted?.prompts) {
      const seenTopicNames = new Set();
      const seenCatIds = new Set();
      const missingTopicRows = [];
      const missingCatRows = [];

      Object.values(s3Config.deleted.prompts).forEach((p) => {
        if (p.topic && !topicNameLookup.has(p.topic) && !seenTopicNames.has(p.topic)) {
          seenTopicNames.add(p.topic);
          missingTopicRows.push({
            organization_id: organizationId,
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
        if (dryRun) {
          logDryRunSummary(log, 'deleted-ref categories', missingCatRows, []);
        } else {
          const { data: catData, error: catError } = await postgrestClient
            .from('categories')
            .upsert(missingCatRows, { onConflict: 'organization_id,category_id' })
            .select('id,category_id');
          if (catError) throw new Error(`Failed to upsert deleted-ref categories: ${catError.message}`);
          (catData || []).forEach((c) => categoryLookup.set(c.category_id, c.id));
        }
        log.info(`${tag}Deleted-ref categories: ${missingCatRows.length} ensured`);
      }

      if (missingTopicRows.length > 0) {
        if (dryRun) {
          logDryRunSummary(log, 'deleted-ref topics', missingTopicRows, []);
        } else {
          const { data: topicData, error: topicError } = await postgrestClient
            .from('topics')
            .upsert(missingTopicRows, { onConflict: 'organization_id,topic_id' })
            .select('id,topic_id,name');
          if (topicError) throw new Error(`Failed to upsert deleted-ref topics: ${topicError.message}`);
          (topicData || []).forEach((t) => {
            topicLookup.set(t.topic_id, t.id);
            topicNameLookup.set(t.name, t.id);
          });
        }
        log.info(`${tag}Deleted-ref topics: ${missingTopicRows.length} ensured`);
      }
    }

    // Step 5: Build & diff prompts
    // eslint-disable-next-line max-len
    const promptRows = collectPrompts(s3Config, categoryLookup, topicLookup, topicNameLookup, brandId, organizationId, existingPrompts, log);
    const promptDiff = diffRows(
      promptRows,
      existingPrompts,
      (r) => promptLookupKey(r.text, r.topic_id),
      PROMPT_COMPARE_FIELDS,
    );
    if (promptDiff.toUpsert.length > 0) {
      if (dryRun) {
        logDryRunSummary(log, 'prompts', promptDiff.dryRunInserts, promptDiff.dryRunUpdates);
      } else {
        await upsertInBatches(postgrestClient, 'prompts', promptDiff.toUpsert, 'brand_id,prompt_id', log);
      }
    }
    log.info(`${tag}Prompts: ${promptDiff.stats.inserted} inserted, ${promptDiff.stats.updated} updated, ${promptDiff.stats.unchanged} unchanged`);

    const stats = {
      categories: catDiff.stats,
      topics: topicDiff.stats,
      prompts: promptDiff.stats,
      ...(dryRun && { dryRun: true }),
    };
    log.info(`${tag}Config DB sync ${dryRun ? 'dry run' : ''} completed for site ${siteId}`, stats);
    return ok(stats);
  } catch (error) {
    log.error(`Config DB sync failed for site ${siteId}: ${error.message}`, error);
    return internalServerError(`Config DB sync failed: ${error.message}`);
  }
}
