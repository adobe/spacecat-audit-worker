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

import { CATEGORY_COMPARE_FIELDS } from './constants.js';
import { diffRows, logDiffSummary } from './diff.js';

export function buildCategoryRows(s3Config, organizationId) {
  return Object.entries(s3Config.categories || {}).map(([catId, cat]) => ({
    organization_id: organizationId,
    category_id: catId,
    name: cat.name,
    origin: cat.origin || 'human',
    status: 'active',
    created_by: cat.createdBy || null,
    updated_by: cat.updatedBy || null,
  }));
}

export async function syncCategories(
  postgrestClient,
  s3Config,
  organizationId,
  existingCats,
  categoryLookup,
  log,
  dryRun = false,
) {
  const tag = dryRun ? '[DRY RUN] ' : '';
  const categoryRows = buildCategoryRows(s3Config, organizationId);
  const catDiff = diffRows(
    categoryRows,
    existingCats,
    (r) => r.category_id,
    CATEGORY_COMPARE_FIELDS,
  );
  logDiffSummary(log, 'categories', catDiff.dryRunInserts, catDiff.dryRunUpdates);

  if (catDiff.toUpsert.length > 0 && !dryRun) {
    const { data: catData, error: catError } = await postgrestClient
      .from('categories')
      .upsert(catDiff.toUpsert, { onConflict: 'organization_id,category_id' })
      .select('id,category_id');
    if (catError) {
      throw new Error(`Failed to upsert categories: ${catError.message}`);
    }
    (catData || []).forEach((c) => categoryLookup.set(c.category_id, c.id));
  }

  log.info(`${tag}Categories: ${catDiff.stats.inserted} inserted, ${catDiff.stats.updated} updated, ${catDiff.stats.unchanged} unchanged`);
  return catDiff.stats;
}
