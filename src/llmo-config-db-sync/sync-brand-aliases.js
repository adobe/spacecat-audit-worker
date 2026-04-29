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

import { BRAND_ALIAS_COMPARE_FIELDS } from './constants.js';
import { diffRows, logDiffSummary } from './diff.js';

export function buildBrandAliasRows(config, brandId) {
  const rows = [];
  (config.brands?.aliases || []).forEach((entry) => {
    const regions = entry.region
      ? (Array.isArray(entry.region) ? entry.region : [entry.region]).map((r) => r.toUpperCase())
      : [];
    (entry.aliases || []).forEach((alias) => {
      rows.push({
        brand_id: brandId,
        alias,
        regions,
        created_by: entry.createdBy || null,
        updated_by: entry.updatedBy || null,
      });
    });
  });
  return rows;
}

export async function syncBrandAliases(
  postgrestClient,
  config,
  brandId,
  log,
  dryRun = false,
) {
  const tag = dryRun ? '[DRY RUN] ' : '';

  const { data: existingData, error: fetchError } = await postgrestClient
    .from('brand_aliases')
    .select('alias,regions')
    .eq('brand_id', brandId);
  if (fetchError) {
    throw new Error(`Failed to fetch brand_aliases: ${fetchError.message}`);
  }

  const existingByKey = new Map((existingData || []).map((r) => [r.alias, r]));
  const desiredRows = buildBrandAliasRows(config, brandId);
  const diff = diffRows(desiredRows, existingByKey, (r) => r.alias, BRAND_ALIAS_COMPARE_FIELDS);
  logDiffSummary(log, 'brand_aliases', diff.dryRunInserts, diff.dryRunUpdates);

  const desiredAliasSet = new Set(desiredRows.map((r) => r.alias));
  const toDelete = (existingData || []).map((r) => r.alias).filter((a) => !desiredAliasSet.has(a));

  if (toDelete.length > 0) {
    log.info(`${tag}[brand_aliases] Deleting ${toDelete.length} removed aliases`);
    if (!dryRun) {
      const { error: delError } = await postgrestClient
        .from('brand_aliases')
        .delete()
        .eq('brand_id', brandId)
        .in('alias', toDelete);
      if (delError) {
        throw new Error(`Failed to delete brand_aliases: ${delError.message}`);
      }
    }
  }

  if (diff.toUpsert.length > 0 && !dryRun) {
    const { error: upsertError } = await postgrestClient
      .from('brand_aliases')
      .upsert(diff.toUpsert, { onConflict: 'brand_id,alias' });
    if (upsertError) {
      throw new Error(`Failed to upsert brand_aliases: ${upsertError.message}`);
    }
  }

  log.info(`${tag}brand_aliases: ${diff.stats.inserted} inserted, ${diff.stats.updated} updated, ${diff.stats.unchanged} unchanged, ${toDelete.length} deleted`);
  return { ...diff.stats, deleted: toDelete.length };
}
