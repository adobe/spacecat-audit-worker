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

import { llmoConfig } from '@adobe/spacecat-shared-utils';
import { ok, internalServerError } from '@adobe/spacecat-shared-http-utils';
import {
  ALLOWED_SITE_IDS, DEV_BRAND_ID, PROD_BRAND_ID, PROD_SITE_ID,
} from './constants.js';
import { fetchExistingState } from './fetch.js';
import { syncCategories } from './sync-categories.js';
import { syncTopics, ensureDeletedRefEntities } from './sync-topics.js';
import { syncPrompts } from './sync-prompts.js';
import { syncBrandAliases } from './sync-brand-aliases.js';
import { syncCompetitors } from './sync-competitors.js';
import { syncTopicCategories, syncTopicPrompts } from './sync-junctions.js';

export function isSyncEnabledForSite(siteId) {
  return ALLOWED_SITE_IDS.includes(siteId);
}

export default async function llmoConfigDbSync(message, context) {
  const { log, env } = context;
  const { siteId, dryRun = false } = message;
  const tag = dryRun ? '[llmo-config-db-sync] [DRY RUN] ' : '[llmo-config-db-sync]';

  if (!isSyncEnabledForSite(siteId)) {
    log.info(`Config DB sync skipped: site ${siteId} is not in ALLOWED_SITE_IDS`);
    return ok({ skipped: true, reason: 'site not in allowed list' });
  }

  try {
    log.info(`[llmo-config-db-sync] Starting config DB sync for siteId: ${siteId}, dryRun: ${dryRun}`);
    const { s3Client } = context;
    const bucket = env.S3_IMPORTER_BUCKET_NAME;
    const config = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });

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
    const brandId = siteId === PROD_SITE_ID ? PROD_BRAND_ID : DEV_BRAND_ID;
    log.info(`${tag}Using fixed brand ID: ${brandId}`);

    const {
      categoryLookup, topicLookup, topicNameLookup,
      existingCats, existingTopics, existingPrompts,
    } = await fetchExistingState(postgrestClient, organizationId, log);

    const categoryStats = await syncCategories(
      postgrestClient,
      s3Config,
      organizationId,
      existingCats,
      categoryLookup,
      log,
      dryRun,
    );

    const topicStats = await syncTopics(
      postgrestClient,
      s3Config,
      organizationId,
      existingTopics,
      topicLookup,
      topicNameLookup,
      log,
      dryRun,
    );

    await ensureDeletedRefEntities(
      postgrestClient,
      s3Config,
      organizationId,
      categoryLookup,
      topicLookup,
      topicNameLookup,
      log,
      dryRun,
    );

    const promptStats = await syncPrompts(
      postgrestClient,
      s3Config,
      categoryLookup,
      topicLookup,
      topicNameLookup,
      brandId,
      organizationId,
      existingPrompts,
      log,
      dryRun,
    );

    const brandAliasStats = await syncBrandAliases(postgrestClient, s3Config, brandId, log, dryRun);
    const competitorStats = await syncCompetitors(postgrestClient, s3Config, brandId, log, dryRun);

    const topicCategoryStats = await syncTopicCategories(
      postgrestClient,
      s3Config,
      topicLookup,
      categoryLookup,
      log,
      dryRun,
    );

    // Fetch prompts with internal IDs for junction sync
    const { data: promptsWithIds = [] } = !dryRun
      ? await postgrestClient
        .from('prompts')
        .select('id,topic_id')
        .eq('organization_id', organizationId)
        .not('topic_id', 'is', null)
      : { data: [] };

    const topicPromptStats = await syncTopicPrompts(
      postgrestClient,
      organizationId,
      promptsWithIds,
      log,
      dryRun,
    );

    const stats = {
      categories: categoryStats,
      topics: topicStats,
      prompts: promptStats,
      brandAliases: brandAliasStats,
      competitors: competitorStats,
      topicCategories: topicCategoryStats,
      topicPrompts: topicPromptStats,
      ...(dryRun && { dryRun: true }),
    };
    log.info(`${tag}Config DB sync ${dryRun ? 'dry run' : ''} completed for site ${siteId}`, stats);
    return ok(stats);
  } catch (error) {
    log.error(`Config DB sync failed for site ${siteId}: ${error.message}`, error);
    return internalServerError(`Config DB sync failed: ${error.message}`);
  }
}
