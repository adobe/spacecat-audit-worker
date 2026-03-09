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

const DEFAULT_MINUTES = 3000; // 50 hours

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

function buildDispatcherQuery(serviceId, minutes) {
  return {
    id: 'dispatcher-logs',
    search: `search ( index=dx_aem_engineering OR index=dx_aem_engineering_prod OR index=dx_aem_engineering_restricted )
      sourcetype=httpderror
      namespace!=ns-team-buds*
      level=managed_rewrite_maps*
      earliest=-${minutes}m@m
      latest=@m
      aem_service="${serviceId}"
      message="*mapping '*' from path '*'"
      | rex field=message "^mapping '(?<orig>[^']*)' from path '(?<fileName>[^']*)' with params.*$"
      | eval redirectMethodUsed = case(
          match(fileName,"^/conf/"), "acsredirectmanager",
          match(fileName,"^(/etc/acs-commons|/content/.*\\.redirectmap\\.txt$)"), "acsredirectmapmanager",
          match(fileName,"^/content/dam/"), "damredirectmgr",
          1=1, "Custom"
        )
      | stats count AS totalLogHits,
              latest(_time) AS mostRecentEpoch,
              first(fileName) AS "fileName",
              values(aem_service) AS Services
        BY redirectMethodUsed
      | sort redirectMethodUsed
    `,
  };
}

export function pickWinner(patternResults) {
  if (patternResults.error) return { redirectMethodUsed: 'none', fileName: 'none' };
  if (patternResults.length === 0) return { redirectMethodUsed: 'vanityurlmgr', fileName: 'none' };
  if (patternResults.every((r) => r.error)) return null;

  // Sort by most recent, then by totalLogHits; ties leave order unchanged
  patternResults.sort((a, b) => {
    if (b.mostRecentEpoch !== a.mostRecentEpoch) return b.mostRecentEpoch - a.mostRecentEpoch;
    if (b.totalLogHits !== a.totalLogHits) return b.totalLogHits - a.totalLogHits;
    return 0;
  });

  return patternResults[0];
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
    const header = `# ${r.redirectMethodUsed}\n`;
    const body = hasText(r.error)
      ? `error: ${String(r.error)}\n`
      : `${r.fileName}\n`;

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
    const methodUsed = r.redirectMethodUsed;
    const status = r.error
      ? `failed: ${r.error}`
      : `rows=${r.rowsCount ?? (r.rows?.length ?? 1)}, count=${r.totalCount ?? r.totalLogHits ?? 0}`;
    return `- \`${methodUsed}\`: ${status}`;
  }).join('\n');

  if (!winner) {
    return `${header}\n*Results*\n${lines}\n\n*Winner*: none${formatQueriesForSlack(queries)}${formatResponsesPreviewForSlack(results)}`;
  }

  const examplesBlock = hasText(winner.fileName)
    ? `\n\n*Top matched strings for winner (\`${winner.redirectMethodUsed}\`)*\n\`\`\`\n${winner.fileName}\n\`\`\``
    : '';

  const methodUsed = winner.redirectMethodUsed;
  return `${header}\n*Winner*: \`${methodUsed}\`\n\n*Results*\n${lines}${examplesBlock}${formatQueriesForSlack(queries)}${formatResponsesPreviewForSlack(results)}`;
}

export default async function identifyRedirects(message, context) {
  const { log } = context;
  const { Site } = context.dataAccess;
  const siteId = message?.siteId;
  const site = hasText(siteId) ? await Site.findById(siteId) : null;
  const {
    baseURL,
    programId,
    environmentId,
    minutes = DEFAULT_MINUTES,
    slackContext,
    updateRedirects = false,
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

  const serviceId = `cm-p${programId}-e${environmentId}`;
  const query = buildDispatcherQuery(serviceId, minutes);
  const queries = [query];

  let response;
  try {
    // Ensure a single login, then run the query.
    await client.login();
    response = await oneshotSearchCompat(client, query.search);
  } catch (e) {
    response = { rejected: true, error: e };
  }

  let results;
  if (response.rejected) {
    const err = response.error;
    results = [{
      redirectMethodUsed: query.id,
      error: err?.message ?? String(err),
    }];
  } else if (response.error) {
    results = [{
      redirectMethodUsed: query.id,
      rowsCount: 0,
      rows: [],
      totalCount: 0,
      error: response.reason?.message || String(response.reason),
    }];
  } else {
    results = response.results || [];
  }

  const winner = pickWinner(results);
  const allZero = results.every((r) => !r.error && r.totalLogHits === 0);

  const finalText = allZero
    ? `*Redirect pattern detection* for *${baseURL}*\n`
      + `AEM CS: programId=\`${programId}\`, environmentId=\`${environmentId}\`, window=\`last ${minutes}m\`\n\n`
      + `No redirect patterns detected in the last ${minutes} minutes.\n\n*Winner*: \`${winner?.redirectMethodUsed ?? 'none'}\` (no patterns)`
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

  if (updateRedirects && winner !== null) {
    if (!site) {
      const reason = !hasText(siteId) ? 'missing siteId' : 'site not found';
      log.warn(`[identify-redirects] Skipping config update: ${reason}`);
      await postMessageSafe(
        context,
        channelId,
        `:warning: Could not update delivery config for *${baseURL}* (${reason}).`,
        { threadTs, ...(slackTarget && { target: slackTarget }) },
      );
    } else {
      const redirectsMode = winner.redirectMethodUsed;
      const redirectsSource = redirectsMode === 'vanityurlmgr' ? 'none' : (winner.fileName || 'none');

      site.setDeliveryConfig({
        ...site.getDeliveryConfig(),
        redirectsSource,
        redirectsMode,
      });
      await site.save();
    }
  }

  return ok({ status: 'ok' });
}
