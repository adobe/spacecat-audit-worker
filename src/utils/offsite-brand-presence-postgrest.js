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

import { getDateRanges } from '@adobe/spacecat-shared-utils';
import { PROVIDERS } from '../offsite-brand-presence/constants.js';

export const EXECUTION_FETCH_BATCH_SIZE = 5000;
export const SOURCE_FETCH_BATCH_SIZE = 5000;
const DEFAULT_REGION_CODE = 'US';

export const BRAND_PRESENCE_DB_MODEL_BY_PROVIDER = Object.freeze({
  'ai-mode': 'google-ai-mode',
  all: 'chatgpt-paid',
  chatgpt: 'chatgpt-free',
  copilot: 'copilot',
  gemini: 'gemini',
  'google-ai-overviews': 'google-ai-overview',
  perplexity: 'perplexity',
});

export function getBrandPresenceDbModels(providers = PROVIDERS) {
  return [...new Set(
    providers
      .map((provider) => BRAND_PRESENCE_DB_MODEL_BY_PROVIDER[provider])
      .filter(Boolean),
  )];
}

function isValidIsoWeek(week, year) {
  return Number.isInteger(year) && Number.isInteger(week) && week >= 1 && week <= 53;
}

export function getDateWindowForPreviousWeeks(previousWeeks) {
  if (!Array.isArray(previousWeeks) || previousWeeks.length === 0) {
    return null;
  }

  const ranges = previousWeeks
    .filter(({ year, week }) => isValidIsoWeek(week, year))
    .map(({ year, week }) => getDateRanges(week, year))
    .filter((r) => r?.length > 0);

  if (ranges.length === 0) {
    return null;
  }

  const startDate = ranges
    .map((r) => r[0].startTime.slice(0, 10))
    .sort()[0];
  const endDate = ranges
    .map((r) => r.at(-1).endTime.slice(0, 10))
    .sort()
    .at(-1);

  return { startDate, endDate };
}

async function fetchExecutionsBatched(postgrestClient, {
  organizationId,
  siteId,
  startDate,
  endDate,
  models,
  regionCode = DEFAULT_REGION_CODE,
  log,
}) {
  const rows = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await postgrestClient
      .from('brand_presence_executions')
      .select('id, execution_date, topics, prompt, category_name, region_code, model')
      .eq('organization_id', organizationId)
      .eq('site_id', siteId)
      .eq('region_code', regionCode)
      .in('model', models)
      .gte('execution_date', startDate)
      .lte('execution_date', endDate)
      .order('execution_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + EXECUTION_FETCH_BATCH_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch brand_presence_executions: ${error.message}`);
    }

    const batch = data || [];
    rows.push(...batch);
    log?.info(`[BrandPresencePostgrest] Fetched executions batch: ${batch.length} rows (total: ${rows.length})`);

    if (batch.length < EXECUTION_FETCH_BATCH_SIZE) {
      break;
    }

    offset += EXECUTION_FETCH_BATCH_SIZE;
  }

  return rows;
}

async function fetchSourcesByDateRange(postgrestClient, {
  organizationId,
  siteId,
  startDate,
  endDate,
  log,
}) {
  const rows = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await postgrestClient
      .from('brand_presence_sources')
      .select('execution_id, source_urls(url)')
      .eq('organization_id', organizationId)
      .eq('site_id', siteId)
      .gte('execution_date', startDate)
      .lte('execution_date', endDate)
      .range(offset, offset + SOURCE_FETCH_BATCH_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch brand_presence_sources: ${error.message}`);
    }

    const batch = data || [];
    rows.push(...batch);
    log?.info(`[BrandPresencePostgrest] Fetched sources batch: ${batch.length} rows (total: ${rows.length})`);

    if (batch.length < SOURCE_FETCH_BATCH_SIZE) {
      break;
    }

    offset += SOURCE_FETCH_BATCH_SIZE;
  }

  return rows;
}

export function mapExecutionsToLegacyBrandPresenceRows(executions, sources) {
  const sourceUrlsByExecutionId = new Map();

  sources.forEach((sourceRow) => {
    const url = sourceRow?.source_urls?.url;
    const executionId = sourceRow?.execution_id;
    if (!url || !executionId) {
      return;
    }

    const existing = sourceUrlsByExecutionId.get(executionId) || [];
    existing.push(url);
    sourceUrlsByExecutionId.set(executionId, existing);
  });

  return executions
    .map((execution) => {
      const urls = sourceUrlsByExecutionId.get(execution.id) || [];
      return {
        Sources: urls.join(';\n'),
        Region: execution.region_code || '',
        Topics: execution.topics || '',
        Prompt: execution.prompt || '',
        Category: execution.category_name || '',
      };
    })
    .filter((row) => row.Sources);
}

export async function loadBrandPresenceDataFromPostgrest({
  siteId,
  organizationId,
  previousWeeks,
  postgrestClient,
  regionCode = DEFAULT_REGION_CODE,
  log,
}) {
  if (!siteId || !organizationId || !postgrestClient?.from) {
    return null;
  }

  const models = getBrandPresenceDbModels();
  const dateWindow = getDateWindowForPreviousWeeks(previousWeeks);
  if (models.length === 0 || !dateWindow) {
    return null;
  }

  const { startDate, endDate } = dateWindow;

  try {
    const executions = await fetchExecutionsBatched(postgrestClient, {
      organizationId,
      siteId,
      startDate,
      endDate,
      models,
      regionCode,
      log,
    });

    if (executions.length === 0) {
      log?.info(`[BrandPresencePostgrest] No execution rows found for site ${siteId}`);
      return null;
    }

    const executionIds = new Set(
      executions.map((e) => e.id).filter(Boolean),
    );

    if (executionIds.size === 0) {
      return null;
    }

    const allSources = await fetchSourcesByDateRange(postgrestClient, {
      organizationId,
      siteId,
      startDate,
      endDate,
      log,
    });

    const sources = allSources.filter((s) => executionIds.has(s.execution_id));

    if (sources.length === 0) {
      log?.info(`[BrandPresencePostgrest] No source rows found for site ${siteId}`);
      return null;
    }

    const rows = mapExecutionsToLegacyBrandPresenceRows(executions, sources);
    if (rows.length === 0) {
      log?.info(`[BrandPresencePostgrest] No usable source rows found for site ${siteId}`);
      return null;
    }

    log?.info(`[BrandPresencePostgrest] Loaded ${rows.length} legacy-shaped rows from PostgREST for site ${siteId}`);
    return { data: rows };
  } catch (error) {
    log?.warn(`[BrandPresencePostgrest] Falling back to file-backed brand presence for site ${siteId}: ${error.message}`);
    return null;
  }
}
