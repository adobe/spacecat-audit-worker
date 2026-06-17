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
import DrsClient from '@adobe/spacecat-shared-drs-client';
import { postMessageOptional } from '../utils/slack-utils.js';
import {
  DRS_POLL_INTERVAL_SECONDS,
  DRS_TERMINAL_STATUSES,
  DRS_SUCCESS_STATUSES,
  OFFSITE_DOMAINS,
  CITED_ANALYSIS_DRS_CONFIG,
} from './constants.js';

const LOG_PREFIX = '[offsite-brand-presence][drs-status]';
const SQS_MAX_DELAY_SECONDS = 900;
// The top-cited bucket is keyed by this domain in the scrape jobs (see the runner's
// addUrlsToUrlStore). All other buckets are keyed by their OFFSITE_DOMAINS domain.
const TOP_CITED_DOMAIN = 'top-cited';

/**
 * Maps a scrape job's bucket/domain to the analysis audit type that consumes its data.
 * Returns undefined for an unknown domain.
 *
 * @param {string} domain - Job bucket key ('reddit.com', 'youtube.com', 'top-cited', …)
 * @returns {string|undefined} Analysis audit type (e.g. 'reddit-analysis')
 */
function resolveAnalysisAuditType(domain) {
  if (domain === TOP_CITED_DOMAIN) {
    return CITED_ANALYSIS_DRS_CONFIG.auditType;
  }
  return OFFSITE_DOMAINS[domain]?.auditType;
}

/**
 * Triggers the downstream analysis audits for every domain whose scrape jobs produced
 * usable data (a DRS_SUCCESS_STATUSES terminal status). Each audit type is triggered at
 * most once. The originating Slack context is forwarded so each analysis audit posts its
 * results to the same thread. Domains that failed, were cancelled, or are still running
 * at the deadline are skipped — there is no fresh data to analyze.
 *
 * @param {Array<{domain: string, status: string|undefined}>} statuses - Per-job statuses
 * @param {string} siteId - The site ID
 * @param {object} slackContext - { channelId, threadTs } forwarded to the triggered audits
 * @param {object} context - Universal context (sqs, dataAccess, log)
 */
async function triggerAnalysisAudits(statuses, siteId, slackContext, context) {
  const { sqs, dataAccess, log } = context;

  const auditTypes = new Set();
  for (const s of statuses) {
    if (DRS_SUCCESS_STATUSES.has(s.status)) {
      const auditType = resolveAnalysisAuditType(s.domain);
      if (auditType) {
        auditTypes.add(auditType);
      }
    }
  }

  if (auditTypes.size === 0) {
    return;
  }

  const configuration = await dataAccess.Configuration.findLatest();
  const queueUrl = configuration.getQueues().audits;
  for (const type of auditTypes) {
    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(queueUrl, {
      type,
      siteId,
      auditContext: { slackContext },
    });
    log.info(`${LOG_PREFIX} Triggered ${type} for site ${siteId}`);
  }
}

/**
 * Builds the Slack completion summary. One line per job: terminal jobs show their
 * status (and error for FAILED/CANCELLED); jobs still non-terminal at the deadline
 * are reported as still running.
 *
 * @param {string} baseURL - The site's base URL
 * @param {Array<{domain: string, datasetId: string, status: string|undefined,
 *   error: string|undefined}>} statuses - Resolved per-job statuses
 * @returns {string} Slack message text
 */
function buildSummary(baseURL, statuses) {
  const allTerminal = statuses.every((s) => DRS_TERMINAL_STATUSES.has(s.status));
  const header = allTerminal
    ? `:checkered_flag: *offsite-brand-presence* DRS jobs *complete* for *${baseURL}*:`
    : `:hourglass_flowing_sand: *offsite-brand-presence* DRS jobs *status update* for *${baseURL}* (timed out waiting):`;
  const lines = [header];
  for (const s of statuses) {
    const label = `\`${s.domain}\` / \`${s.datasetId}\``;
    if (!DRS_TERMINAL_STATUSES.has(s.status)) {
      lines.push(`• ${label} → still running (timed out waiting)`);
    } else if (s.status === 'FAILED' || s.status === 'CANCELLED') {
      lines.push(`• ${label} → ${s.status}${s.error ? `: ${s.error}` : ''}`);
    } else {
      lines.push(`• ${label} → ${s.status}`);
    }
  }
  return lines.join('\n');
}

/**
 * Polls DRS for the status of the offsite-brand-presence scrape jobs created for a
 * manual Slack run. Re-enqueues itself with an SQS delay until every job is terminal
 * or the deadline passes, then posts a single completion summary to the Slack thread.
 *
 * @param {object} message - SQS message with auditContext { baseURL, slackContext,
 *   jobs: [{domain, datasetId, jobId}], deadline }
 * @param {object} context - Universal context (log, sqs, dataAccess, env)
 * @returns {Promise<Response>}
 */
export default async function offsiteBrandPresenceDrsStatusHandler(message, context) {
  const { log, sqs, dataAccess } = context;
  const { Configuration } = dataAccess;
  const { siteId, auditContext = {} } = message;
  const {
    baseURL, slackContext = {}, jobs = [], deadline,
  } = auditContext;
  const { channelId, threadTs } = slackContext;

  if (!channelId || !threadTs || jobs.length === 0) {
    log.warn(`${LOG_PREFIX} Missing Slack context or jobs, skipping (site ${siteId})`);
    return ok();
  }

  const drsClient = DrsClient.createFrom(context);

  const statuses = await Promise.all(jobs.map(async (job) => {
    try {
      const result = await drsClient.getJob(job.jobId);
      return { ...job, status: result?.status, error: result?.error_message };
    } catch (err) {
      log.warn(`${LOG_PREFIX} getJob failed for ${job.jobId}: ${err.message}`);
      return { ...job, status: undefined, error: undefined };
    }
  }));

  const terminalCount = statuses.filter((s) => DRS_TERMINAL_STATUSES.has(s.status)).length;
  const allTerminal = terminalCount === statuses.length;

  const now = Date.now();
  if (!allTerminal && now < deadline) {
    const delaySeconds = Math.min(
      DRS_POLL_INTERVAL_SECONDS,
      Math.max(0, Math.ceil((deadline - now) / 1000)),
      SQS_MAX_DELAY_SECONDS,
    );
    const configuration = await Configuration.findLatest();
    await sqs.sendMessage(configuration.getQueues().audits, message, null, delaySeconds);
    log.info(`${LOG_PREFIX} ${terminalCount}/${statuses.length} jobs terminal for ${baseURL}, re-polling in ${delaySeconds}s`);
    return ok();
  }

  // Accepted trade-off: SQS at-least-once delivery means a crash after this post but
  // before the message is deleted could redeliver and post the summary twice. There is
  // no idempotency key; a duplicate Slack summary is preferable to the complexity of
  // deduplication for a best-effort notification.
  await postMessageOptional(context, channelId, buildSummary(baseURL, statuses), { threadTs });
  log.info(`${LOG_PREFIX} Posted completion summary for ${baseURL} (${statuses.length} jobs)`);

  // Auto-trigger the analysis audits for domains whose scrapes succeeded, so the
  // offsite-brand-presence run no longer needs reddit/youtube/cited/wikipedia to be
  // triggered manually. Best-effort: a failure here must not cause the message to be
  // redelivered (which would re-post the summary and re-trigger the audits).
  try {
    await triggerAnalysisAudits(statuses, siteId, slackContext, context);
  } catch (err) {
    log.warn(`${LOG_PREFIX} Failed to trigger analysis audits for ${baseURL}: ${err.message}`);
  }

  return ok();
}
