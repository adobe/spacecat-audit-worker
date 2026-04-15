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

import { PROVIDERS } from '../offsite-brand-presence/constants.js';

const EXECUTION_FETCH_BATCH_SIZE = 5000;
const EXECUTION_ID_CHUNK_SIZE = 50;

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

function toYMD(date) {
  return date.toISOString().slice(0, 10);
}

function getIsoWeekDateRange(year, week) {
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) {
    return null;
  }

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const week1MondayMs = jan4.getTime() + mondayOffset * 24 * 60 * 60 * 1000;
  const targetMondayMs = week1MondayMs + (week - 1) * 7 * 24 * 60 * 60 * 1000;
  const monday = new Date(targetMondayMs);
  const sunday = new Date(targetMondayMs + 6 * 24 * 60 * 60 * 1000);

  return {
    startDate: toYMD(monday),
    endDate: toYMD(sunday),
  };
}

export function getDateWindowForPreviousWeeks(previousWeeks) {
  if (!Array.isArray(previousWeeks) || previousWeeks.length === 0) {
    return null;
  }

  const ranges = previousWeeks
    .map(({ year, week }) => getIsoWeekDateRange(year, week))
    .filter(Boolean);

  if (ranges.length === 0) {
    return null;
  }

  const startDate = ranges
    .map((range) => range.startDate)
    .sort()[0];
  const endDate = ranges
    .map((range) => range.endDate)
    .sort()
    .at(-1);

  return { startDate, endDate };
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function fetchExecutionsBatched(postgrestClient, {
  organizationId,
  siteId,
  startDate,
  endDate,
  models,
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
      .eq('region_code', 'US')
      .in('model', models)
      .gte('execution_date', startDate)
      .lte('execution_date', endDate)
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

async function fetchSourcesForExecutionIds(postgrestClient, {
  organizationId,
  siteId,
  startDate,
  endDate,
  executionIds,
}) {
  const executionIdChunks = chunk(executionIds, EXECUTION_ID_CHUNK_SIZE);
  const sourceRows = [];

  for (const executionIdChunk of executionIdChunks) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await postgrestClient
      .from('brand_presence_sources')
      .select('execution_id, source_urls(url)')
      .eq('organization_id', organizationId)
      .eq('site_id', siteId)
      .gte('execution_date', startDate)
      .lte('execution_date', endDate)
      .in('execution_id', executionIdChunk);

    if (error) {
      throw new Error(`Failed to fetch brand_presence_sources: ${error.message}`);
    }

    sourceRows.push(...(data || []));
  }

  return sourceRows;
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
      log,
    });

    if (executions.length === 0) {
      log?.info(`[BrandPresencePostgrest] No execution rows found for site ${siteId}`);
      return null;
    }

    const executionIds = executions
      .map((execution) => execution.id)
      .filter(Boolean);

    if (executionIds.length === 0) {
      return null;
    }

    const sources = await fetchSourcesForExecutionIds(postgrestClient, {
      organizationId,
      siteId,
      startDate,
      endDate,
      executionIds,
    });

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
