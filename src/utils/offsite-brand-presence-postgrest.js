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
import {
  createOffsiteLogger, errorField, AUDIT, OUTCOME, PEER,
} from './offsite-logging.js';
import { PROVIDERS } from '../offsite-brand-presence/constants.js';

export const EXECUTION_FETCH_BATCH_SIZE = 5000;
export const MAX_EXECUTION_FETCH_PAGES = 50;

export const BRAND_PRESENCE_DB_MODEL_BY_PROVIDER = Object.freeze({
  'ai-mode': 'google-ai-mode',
  // Legacy "all" provider rows are stored as paid ChatGPT executions in Brand Presence DB.
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

async function fetchExecutionsWithSources(postgrestClient, {
  organizationId,
  siteId,
  startDate,
  endDate,
  models,
  olog,
}) {
  const rows = [];
  let lastDate = null;
  let lastId = null;
  let pageCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (pageCount >= MAX_EXECUTION_FETCH_PAGES) {
      // Deliberately kept at `.warn()` with `outcome` forced to `SUCCESS`: a full set of
      // pages was still processed, this is a caveat on a successful fetch, not a failure.
      olog.warn('data_acquisition_bp_data_postgres_read', 'Exceeded maximum brand_presence_executions pages; processing rows fetched so far', {
        peer: PEER.POSTGRES, direction: 'inbound', reason: 'max_pages', reasonCategory: 'infra', pages: MAX_EXECUTION_FETCH_PAGES, rows: rows.length, outcome: OUTCOME.SUCCESS,
      });
      break;
    }

    let query = postgrestClient
      .from('brand_presence_executions')
      .select('id, execution_date, topics, prompt, category_name, region_code, model, brand_presence_sources(source_urls(url))')
      .eq('organization_id', organizationId)
      .eq('site_id', siteId)
      .in('model', models)
      .gte('execution_date', startDate)
      .lte('execution_date', endDate)
      .order('execution_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(EXECUTION_FETCH_BATCH_SIZE);

    if (lastDate !== null) {
      // Keyset pagination: lastDate/lastId come from DB ISO date/UUID values.
      // Revisit if schema types change.
      query = query.or(
        `execution_date.lt.${lastDate},and(execution_date.eq.${lastDate},id.lt.${lastId})`,
      );
    }

    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch brand_presence_executions: ${error.message}`);
    }
    pageCount += 1;

    const batch = data || [];
    rows.push(...batch);
    olog.start('data_acquisition_bp_data_postgres_read', 'Fetched batch', {
      peer: PEER.POSTGRES, direction: 'inbound', rows: batch.length, total: rows.length,
    });

    if (batch.length < EXECUTION_FETCH_BATCH_SIZE) {
      break;
    }

    const last = batch[batch.length - 1];
    lastDate = last.execution_date;
    lastId = last.id;
  }

  return rows;
}

export function mapExecutionsToLegacyBrandPresenceRows(executions) {
  return executions
    .map((execution) => {
      const urls = (execution.brand_presence_sources || [])
        .map((s) => s?.source_urls?.url)
        .filter(Boolean);
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

  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE, siteId });

  const models = getBrandPresenceDbModels();
  const dateWindow = getDateWindowForPreviousWeeks(previousWeeks);
  if (models.length === 0 || !dateWindow) {
    return null;
  }

  const { startDate, endDate } = dateWindow;

  try {
    const executions = await fetchExecutionsWithSources(postgrestClient, {
      organizationId,
      siteId,
      startDate,
      endDate,
      models,
      olog,
    });

    if (executions.length === 0) {
      olog.skip('data_acquisition_bp_data_postgres_read', 'No execution rows found', {
        peer: PEER.POSTGRES, direction: 'inbound', count: 0, reason: 'no_executions', reasonCategory: 'config', siteId,
      });
      return null;
    }

    const rows = mapExecutionsToLegacyBrandPresenceRows(executions);
    if (rows.length === 0) {
      olog.skip('data_acquisition_bp_data_postgres_read', 'No usable rows found', {
        peer: PEER.POSTGRES, direction: 'inbound', count: 0, reason: 'no_usable_rows', reasonCategory: 'config', siteId,
      });
      return null;
    }

    olog.success('data_acquisition_bp_data_postgres_read', 'Loaded legacy-shaped rows from PostgREST', {
      peer: PEER.POSTGRES, direction: 'inbound', siteId, rows: rows.length,
    });
    return { data: rows };
  } catch (error) {
    // A genuine hard failure (the read failed) — logged via `.failure()` at `error` level,
    // not `.warn()`, matching every other real failure in this codebase.
    olog.failure('data_acquisition_bp_data_postgres_read', 'PostgREST query failed', {
      peer: PEER.POSTGRES, direction: 'inbound', reason: 'query', reasonCategory: 'infra', siteId, ...errorField(error),
    }, error);
    return null;
  }
}
