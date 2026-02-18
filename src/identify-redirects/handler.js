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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { hasText } from '@adobe/spacecat-shared-utils';
import SplunkAPIClient from '@adobe/spacecat-shared-splunk-client';

import { postMessageSafe } from '../utils/slack-utils.js';

const DEFAULT_MINUTES = 60;

const DEFAULT_SPLUNK_FIELDS = {
  envField: 'aem_envId',
  programField: 'aem_program_id',
  pathField: 'url',
};

const CONFIDENCE = {
  acsredirectmanager: 0.95,
  acsredirectmapmanager: 0.95,
  redirectmapTxt: 0.90,
  damredirectmgr: 0.85,
};

async function oneshotSearchCompat(client, searchString) {
  if (typeof client?.oneshotSearch === 'function') {
    return client.oneshotSearch(searchString);
  }

  /* c8 ignore next 3 */
  if (typeof searchString !== 'string' || searchString.trim().length === 0) {
    throw new Error('Missing searchString');
  }

  // Compatibility path for @adobe/spacecat-shared-splunk-client@<=1.0.30
  // which does not expose oneshotSearch().
  const loginObj = client.loginObj || await client.login();
  if (loginObj?.error) {
    const err = loginObj.error;
    throw (err instanceof Error ? err : new Error(String(err)));
  }

  const queryBody = new URLSearchParams({
    search: searchString,
    adhoc_search_level: 'fast',
    exec_mode: 'oneshot',
    output_mode: 'json',
  });

  const url = `${client.apiBaseUrl}/servicesNS/admin/search/search/jobs`;
  const response = await client.fetchAPI(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Splunk ${loginObj.sessionId}`,
      Cookie: loginObj.cookie,
    },
    body: queryBody,
  });

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`Splunk oneshot search failed. Status: ${response.status}. Body: ${body}`);
  }

  return response.json();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildBaseSearch({
  minutes,
  envField,
  programField,
  environmentId,
  programId,
}) {
  // Keep the top-level search stable and narrow.
  // Note: field names must be verified in Splunk for your index schema.
  return [
    'search',
    'index=dx_aem_engineering',
    `earliest=-${minutes}m@m`,
    'latest=@m',
    `${envField}="${environmentId}"`,
    `${programField}="${programId}"`,
  ].join(' ');
}

function buildStatsTail(pathField) {
  return `| stats count by ${pathField} | sort -count | head 20`;
}

function buildQueries(params) {
  const {
    pathField,
  } = params;

  const statsTail = buildStatsTail(pathField);

  return [
    {
      id: 'acsredirectmanager',
      confidence: CONFIDENCE.acsredirectmanager,
      // IMPORTANT: naive /conf/ matching causes false positives. We require redirect context.
      search: `${buildBaseSearch(params)} "/conf/" `
        + '(redirect OR "acs-commons") '
        + 'NOT "/settings/wcm/templates/" '
        + `${statsTail}`,
    },
    {
      id: 'acsredirectmapmanager',
      confidence: CONFIDENCE.acsredirectmapmanager,
      search: `${buildBaseSearch(params)} "/etc/acs-commons/redirect-maps" ${statsTail}`,
    },
    {
      id: 'redirectmapTxt',
      confidence: CONFIDENCE.redirectmapTxt,
      search: `${buildBaseSearch(params)} "redirectmap.txt" ${statsTail}`,
    },
    {
      id: 'damredirectmgr',
      confidence: CONFIDENCE.damredirectmgr,
      // IMPORTANT: DAM is noisy unless constrained to redirect context.
      search: `${buildBaseSearch(params)} "/content/dam/" redirect ${statsTail}`,
    },
  ];
}

function scorePattern({ totalCount, confidence }) {
  return totalCount * confidence;
}

function pickWinner(patternResults) {
  const successful = patternResults.filter((r) => !r.error);
  if (successful.length === 0) return null;

  // Sort by score desc, then by totalCount desc, then by confidence desc
  successful.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return b.confidence - a.confidence;
  });

  return successful[0];
}

function formatQueriesForSlack(queries) {
  // Queries are built in-process and expected to be non-empty.
  const lines = queries.map((q) => `${q.id}: ${q.search.slice(0, 500)}`).join('\n');
  return `\n\n*Queries run*\n\`\`\`\n${lines}\n\`\`\``;
}

function formatResponsesPreviewForSlack(results, {
  maxRowsPerPattern = 3,
  totalLimit = 2500,
} = {}) {
  let acc = '';

  for (const r of results) {
    const header = `# ${r.id}\n`;
    const body = hasText(r.error)
      ? `error: ${String(r.error)}\n`
      : `${r.rows.slice(0, maxRowsPerPattern).map((row) => JSON.stringify(row)).join('\n') || '(no rows)'}\n`;

    const block = `${header}${body}\n`;
    if (acc.length + block.length > totalLimit) {
      break;
    }
    acc += block;
  }

  return hasText(acc)
    ? `\n\n*Response preview (first ${maxRowsPerPattern} rows per query)*\n\`\`\`\n${acc.trimEnd()}\n\`\`\``
    : '';
}

function formatSlackMessage({
  baseURL,
  programId,
  environmentId,
  minutes,
  winner,
  results,
  queries,
}) {
  const header = `*Redirect pattern detection* for *${baseURL}*\n`
    + `AEM CS: programId=\`${programId}\`, environmentId=\`${environmentId}\`, window=\`last ${minutes}m\`\n`;

  const lines = results.map((r) => {
    const status = r.error
      ? `failed: ${r.error}`
      : `rows=${r.rowsCount}, count=${r.totalCount}, score=${r.score.toFixed(2)}`;
    return `- \`${r.id}\` (conf=${r.confidence}): ${status}`;
  }).join('\n');

  if (!winner) {
    return `${header}\n*Results*\n${lines}\n\n*Winner*: none${formatQueriesForSlack(queries)}${formatResponsesPreviewForSlack(results)}`;
  }

  const examples = (winner.examples || []).slice(0, 8).join('\n');
  const examplesBlock = hasText(examples)
    ? `\n\n*Top paths for winner (\`${winner.id}\`)*\n\`\`\`\n${examples}\n\`\`\``
    : '';

  return `${header}\n*Winner*: \`${winner.id}\`\n\n*Results*\n${lines}${examplesBlock}${formatQueriesForSlack(queries)}${formatResponsesPreviewForSlack(results)}`;
}

export default async function identifyRedirects(message, context) {
  const { log } = context;
  const {
    baseURL,
    programId,
    environmentId,
    minutes = DEFAULT_MINUTES,
    slackContext,
    splunkFields = {},
  } = message || {};

  const channelId = slackContext?.channelId;
  const threadTs = slackContext?.threadTs;
  const slackTarget = slackContext?.target; // optional override

  if (!hasText(channelId) || !hasText(threadTs)) {
    log.warn('[identify-redirects] Missing slackContext.channelId or slackContext.threadTs');
    return ok({ status: 'ignored', reason: 'missing-slack-context' });
  }

  if (!hasText(baseURL) || !hasText(programId) || !hasText(environmentId)) {
    const text = ':warning: identify-redirects job missing required inputs. '
      + `baseURL=${baseURL || 'n/a'}, `
      + `programId=${programId || 'n/a'}, `
      + `environmentId=${environmentId || 'n/a'}`;
    await postMessageSafe(context, channelId, text, {
      threadTs,
      ...(slackTarget && { target: slackTarget }),
    });
    return ok({ status: 'error', reason: 'missing-inputs' });
  }

  const { envField, programField, pathField } = { ...DEFAULT_SPLUNK_FIELDS, ...splunkFields };

  const client = SplunkAPIClient.createFrom(context);

  await postMessageSafe(
    context,
    channelId,
    `:hourglass: Started Splunk searches for *${baseURL}* (last ${minutes}m)…`,
    {
      threadTs,
      ...(slackTarget && { target: slackTarget }),
    },
  );

  const queryParams = {
    minutes,
    envField,
    programField,
    pathField,
    environmentId,
    programId,
  };

  const queries = buildQueries(queryParams);

  let settled;
  try {
    // Ensure a single login, then run queries in parallel.
    await client.login();
    settled = await Promise.allSettled(queries.map((q) => oneshotSearchCompat(client, q.search)));
  } catch (e) {
    const text = `:x: Failed to query Splunk for redirect patterns for *${baseURL}*: ${e.message}`;
    await postMessageSafe(context, channelId, text, {
      threadTs,
      ...(slackTarget && { target: slackTarget }),
    });
    return ok({ status: 'error', reason: 'splunk-query-failed' });
  }

  const results = queries.map((q, idx) => {
    const item = settled[idx];
    if (item.status === 'rejected') {
      return {
        id: q.id,
        confidence: q.confidence,
        rowsCount: 0,
        rows: [],
        totalCount: 0,
        score: 0,
        examples: [],
        error: item.reason?.message || String(item.reason),
      };
    }

    const response = item.value || {};
    const splunkResults = Array.isArray(response.results) ? response.results : [];
    const totalCount = splunkResults.reduce((sum, r) => sum + asNumber(r.count), 0);
    const rows = splunkResults.slice(0, 3);
    const examplesList = splunkResults
      .map((r) => r[pathField])
      .filter((v) => typeof v === 'string' && v.length > 0)
      .slice(0, 8);
    const examples = examplesList.length > 0 ? examplesList : null;

    const score = scorePattern({ totalCount, confidence: q.confidence });
    return {
      id: q.id,
      confidence: q.confidence,
      rowsCount: splunkResults.length,
      rows,
      totalCount,
      score,
      examples,
      error: null,
    };
  });

  const winner = pickWinner(results);
  const allZero = results.every((r) => !r.error && r.totalCount === 0);

  const finalText = allZero
    ? `*Redirect pattern detection* for *${baseURL}*\n`
      + `AEM CS: programId=\`${programId}\`, environmentId=\`${environmentId}\`, window=\`last ${minutes}m\`\n\n`
      + `No redirect patterns detected in the last ${minutes} minutes.`
      + `${formatQueriesForSlack(queries)}${formatResponsesPreviewForSlack(results)}`
    : formatSlackMessage({
      baseURL,
      programId,
      environmentId,
      minutes,
      winner,
      results,
      queries,
    });

  await postMessageSafe(context, channelId, finalText, {
    threadTs,
    ...(slackTarget && { target: slackTarget }),
  });

  return ok({ status: 'ok' });
}
