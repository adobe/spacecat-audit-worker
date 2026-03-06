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

function buildDispatcherQueries(serviceId, minutes) {
  return [
    {
      id: 'dispatcher-logs',
      search: `( index=dx_aem_engineering OR index=dx_aem_engineering_prod OR index=dx_aem_engineering_restricted )
        sourcetype=httpderror
        namespace!=ns-team-buds*
        level=managed_rewrite_maps*
        earliest=-${minutes}m@m
        latest=@m
        aem_service="${serviceId}"
        message="*mapping '*' from path '*'"
        | rex field=message "^mapping '(?<orig>[^']*)' from path '(?<fileName>[^']*)' with params.*$"
        | rename aem_program_id AS program_id
        | lookup skyline_program_id_to_program_name program_id OUTPUT program_name
        | eval redirectMethodUsed = case(
            match(fileName,"^/conf/"), "acsredirectmanager",
            match(fileName,"^(/etc/acs-commons|/content/.*\\.redirectmap\\.txt$)"), "acsredirectmapmanager",
            match(fileName,"^/content/dam/"), "damredirectmgr",
            1=1, "Custom"
          )
        | stats count AS totalLogHits,
                latest(_time) AS mostRecentEpoch,
                first(fileName) AS "fileName",
                values(program_name) AS Customers,
                values(aem_service) AS Services
          BY redirectMethodUsed
        | eval mostRecentISO = strftime(mostRecentEpoch, "%Y-%m-%d %H:%M:%S %Z")
        | sort redirectMethodUsed
      `,
    },
  ];
}

function pickWinner(patternResults) {
  const successful = patternResults.filter((r) => !r.error);
  if (successful.length === 0) return { id: 'vanityurlmgr', fileName: 'none' };

  // Sort by most recent, then by totalLogHits; ties leave order unchanged
  successful.sort((a, b) => {
    if (b.mostRecentEpoch !== a.mostRecentEpoch) return b.mostRecentEpoch - a.mostRecentEpoch;
    if (b.totalLogHits !== a.totalLogHits) return b.totalLogHits - a.totalLogHits;
    return 0;
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
      : `${(r.rows || []).slice(0, maxRowsPerPattern).map((row) => JSON.stringify(row)).join('\n') || '(no rows)'}\n`;

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
      : `rows=${r.rowsCount}, count=${r.totalCount}`;
    return `- \`${r.id}\`: ${status}`;
  }).join('\n');

  if (!winner) {
    return `${header}\n*Results*\n${lines}\n\n*Winner*: none${formatQueriesForSlack(queries)}${formatResponsesPreviewForSlack(results)}`;
  }

  const examplesBlock = hasText(winner.fileName)
    ? `\n\n*Top matched strings for winner (\`${winner.redirectMethodUsed}\`)*\n\`\`\`\n${winner.fileName}\n\`\`\``
    : '';

  return `${header}\n*Winner*: \`${winner.id}\`\n\n*Results*\n${lines}${examplesBlock}${formatQueriesForSlack(queries)}${formatResponsesPreviewForSlack(results)}`;
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
  const queries = buildDispatcherQueries(serviceId, minutes);

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
        rowsCount: 0,
        rows: [],
        totalCount: 0,
        error: item.reason?.message || String(item.reason),
      };
    }

    const response = item.value || {};
    // response.results holds the results of the search as an array of json objects
    // results.redirectMethodUsed is redirectsMode
    // results.fileName is redirectsSource
    // totalPerMethod is the numberf
    const splunkResults = Array.isArray(response.results) ? response.results : [];
    return splunkResults;
  });

  const winner = pickWinner(results);
  const allZero = results.every((r) => !r.error && r.totalLogHits === 0);

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
      let redirectsSource = 'none';
      const redirectsMode = winner.id;

      if (redirectsMode !== 'vanityurlmgr') {
        [redirectsSource] = winner.examples || ['none'];
      }

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
