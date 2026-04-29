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

import { COMPETITOR_COMPARE_FIELDS } from './constants.js';
import { diffRows, logDiffSummary } from './diff.js';

export function buildCompetitorRows(config, brandId, log) {
  return (config.competitors?.competitors || []).map((c) => {
    if ((c.urls || []).length > 1) {
      log.warn(`Competitor "${c.name}" has ${c.urls.length} URLs; only the first will be persisted (DB schema has a single url column)`);
    }
    const regions = (Array.isArray(c.region) ? c.region : [c.region])
      .filter(Boolean)
      .map((r) => r.toUpperCase());
    return {
      brand_id: brandId,
      name: c.name,
      aliases: c.aliases || [],
      regions,
      url: (c.urls || [])[0] || null,
      created_by: c.updatedBy || null,
      updated_by: c.updatedBy || null,
    };
  });
}

export async function syncCompetitors(
  postgrestClient,
  config,
  brandId,
  log,
  dryRun = false,
) {
  const tag = dryRun ? '[DRY RUN] ' : '';

  const { data: existingData, error: fetchError } = await postgrestClient
    .from('competitors')
    .select('name,aliases,regions,url')
    .eq('brand_id', brandId);
  if (fetchError) {
    throw new Error(`Failed to fetch competitors: ${fetchError.message}`);
  }

  const existingByKey = new Map((existingData || []).map((r) => [r.name, r]));
  const desiredRows = buildCompetitorRows(config, brandId, log);
  const diff = diffRows(desiredRows, existingByKey, (r) => r.name, COMPETITOR_COMPARE_FIELDS);
  logDiffSummary(log, 'competitors', diff.dryRunInserts, diff.dryRunUpdates);

  const desiredNameSet = new Set(desiredRows.map((r) => r.name));
  const toDelete = (existingData || []).map((r) => r.name).filter((n) => !desiredNameSet.has(n));

  if (toDelete.length > 0) {
    log.info(`${tag}[competitors] Deleting ${toDelete.length} removed competitors`);
    if (!dryRun) {
      const { error: delError } = await postgrestClient
        .from('competitors')
        .delete()
        .eq('brand_id', brandId)
        .in('name', toDelete);
      if (delError) {
        throw new Error(`Failed to delete competitors: ${delError.message}`);
      }
    }
  }

  if (diff.toUpsert.length > 0 && !dryRun) {
    const { error: upsertError } = await postgrestClient
      .from('competitors')
      .upsert(diff.toUpsert, { onConflict: 'brand_id,name' });
    if (upsertError) {
      throw new Error(`Failed to upsert competitors: ${upsertError.message}`);
    }
  }

  log.info(`${tag}competitors: ${diff.stats.inserted} inserted, ${diff.stats.updated} updated, ${diff.stats.unchanged} unchanged, ${toDelete.length} deleted`);
  return { ...diff.stats, deleted: toDelete.length };
}
