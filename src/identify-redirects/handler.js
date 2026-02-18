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
    'sourcetype=cdn',
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
      search: `${buildBaseSearch(params)} ${pathField}="/conf/*" `
        + `(${pathField}="*redirect*" OR ${pathField}="*acs-commons*redirect*") `
        + `NOT ${pathField}="*/settings/wcm/templates/*" `
        + `${statsTail}`,
    },
    {
      id: 'acsredirectmapmanager',
      confidence: CONFIDENCE.acsredirectmapmanager,
      search: `${buildBaseSearch(params)} ${pathField}="/etc/acs-commons/redirect-maps/*" ${statsTail}`,
    },
    {
      id: 'redirectmapTxt',
      confidence: CONFIDENCE.redirectmapTxt,
      search: `${buildBaseSearch(params)} ${pathField}="*.redirectmap.txt" ${statsTail}`,
    },
    {
      id: 'damredirectmgr',
      confidence: CONFIDENCE.damredirectmgr,
      // IMPORTANT: DAM is noisy unless constrained to redirect context.
      search: `${buildBaseSearch(params)} ${pathField}="/content/dam/*" ${pathField}="*redirect*" ${statsTail}`,
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

function formatSlackMessage({
  baseURL,
  programId,
  environmentId,
  minutes,
  winner,
  results,
}) {
  const header = `*Redirect pattern detection* for *${baseURL}*\n`
    + `AEM CS: programId=\`${programId}\`, environmentId=\`${environmentId}\`, window=\`last ${minutes}m\`\n`;

  const lines = results.map((r) => {
    const status = r.error ? `failed: ${r.error}` : `count=${r.totalCount}, score=${r.score.toFixed(2)}`;
    return `- \`${r.id}\` (conf=${r.confidence}): ${status}`;
  }).join('\n');

  if (!winner) {
    return `${header}\n*Results*\n${lines}\n\n*Winner*: none`;
  }

  const examples = (winner.examples || []).slice(0, 8).join('\n');
  const examplesBlock = hasText(examples)
    ? `\n\n*Top paths for winner (\`${winner.id}\`)*\n\`\`\`\n${examples}\n\`\`\``
    : '';

  return `${header}\n*Winner*: \`${winner.id}\`\n\n*Results*\n${lines}${examplesBlock}`;
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
    settled = await Promise.allSettled(queries.map((q) => client.oneshotSearch(q.search)));
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
        totalCount: 0,
        score: 0,
        examples: [],
        error: item.reason?.message || String(item.reason),
      };
    }

    const response = item.value || {};
    const splunkResults = Array.isArray(response.results) ? response.results : [];
    const totalCount = splunkResults.reduce((sum, r) => sum + asNumber(r.count), 0);
    const examplesList = splunkResults
      .map((r) => r[pathField])
      .filter((v) => typeof v === 'string' && v.length > 0)
      .slice(0, 8);
    const examples = examplesList.length > 0 ? examplesList : null;

    const score = scorePattern({ totalCount, confidence: q.confidence });
    return {
      id: q.id,
      confidence: q.confidence,
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
    : formatSlackMessage({
      baseURL,
      programId,
      environmentId,
      minutes,
      winner,
      results,
    });

  await postMessageSafe(context, channelId, finalText, {
    threadTs,
    ...(slackTarget && { target: slackTarget }),
  });

  return ok({ status: 'ok' });
}
