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
import { formatDuration, resolveDrsPollIntervalSeconds } from '../utils/offsite-audit-utils.js';
import {
  createOffsiteLogger, errorField, AUDIT, PEER,
} from '../utils/offsite-logging.js';
import {
  DRS_TERMINAL_STATUSES,
  DRS_SUCCESS_STATUSES,
  OFFSITE_DOMAINS,
  CITED_ANALYSIS_DRS_CONFIG,
  AUDIT_TRIGGER_COOLDOWN_MS,
} from './constants.js';

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
 * Returns true when a recent audit of the given type already exists for the site,
 * meaning a new trigger should be suppressed. "Recent" is defined by
 * AUDIT_TRIGGER_COOLDOWN_MS. Swallows lookup errors so a transient DB failure
 * never blocks a legitimate trigger.
 *
 * @param {string} siteId
 * @param {string} auditType
 * @param {object} dataAccess
 * @param {object} log
 * @returns {Promise<boolean>}
 */
async function hasRecentAudit(siteId, auditType, dataAccess, log) {
  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE, siteId });
  try {
    const { LatestAudit } = dataAccess;
    const latest = await LatestAudit.findBySiteIdAndAuditType(siteId, auditType);
    if (!latest) {
      return false;
    }
    // A `pending_scrape` run is the analysis itself, waiting for the DRS scrape this poll
    // just completed — it requested the scrape and must NOT suppress its own re-trigger.
    // (Without this, an individual analysis run that self-heals an empty URL store never
    // reaches Mystique: its pending_scrape audit trips the cooldown for the whole hour.)
    // Only a real completed/in-progress analysis within the window dedupes redelivered polls.
    if (latest.getAuditResult?.()?.status === 'pending_scrape') {
      return false;
    }
    const auditedAt = new Date(latest.getAuditedAt()).getTime();
    return (Date.now() - auditedAt) < AUDIT_TRIGGER_COOLDOWN_MS;
  } catch (err) {
    olog.warn('data_acquisition_cooldown_checked', `Failed to check recent ${auditType} audit for site ${siteId}`, {
      peer: PEER.SPACECAT, direction: 'inbound', auditType, ...errorField(err),
    });
    return false;
  }
}

/**
 * Groups the per-job statuses by the analysis audit type that consumes them and returns
 * the audit types that are ready to dispatch on this poll.
 *
 * An audit type is ready when at least one of its jobs reached a DRS_SUCCESS_STATUSES
 * status AND either:
 *   - every job feeding that audit type is terminal (so Mystique analyzes complete data —
 *     e.g. youtube-analysis waits for both youtube_videos and youtube_comments), or
 *   - the polling deadline has passed (best-effort dispatch with whatever finished).
 *
 * Audit types already dispatched on an earlier poll (tracked in `alreadyTriggered`) are
 * excluded so each type is triggered at most once. Different audit types are independent:
 * a fast bucket (reddit) is returned as soon as it is ready without waiting for a slow one
 * (top-cited/cited-analysis).
 *
 * @param {Array<{domain: string, status: string|undefined}>} statuses - Per-job statuses
 * @param {boolean} deadlineReached - Whether the overall polling deadline has passed
 * @param {Set<string>} alreadyTriggered - Audit types dispatched on a previous poll
 * @returns {string[]} Audit types to trigger now
 */
function computeReadyAuditTypes(statuses, deadlineReached, alreadyTriggered) {
  const groups = new Map();
  for (const s of statuses) {
    const auditType = resolveAnalysisAuditType(s.domain);
    if (!auditType) {
      // eslint-disable-next-line no-continue
      continue;
    }
    if (!groups.has(auditType)) {
      groups.set(auditType, []);
    }
    groups.get(auditType).push(s);
  }

  const ready = [];
  for (const [auditType, groupJobs] of groups) {
    if (alreadyTriggered.has(auditType)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const allGroupTerminal = groupJobs.every((s) => DRS_TERMINAL_STATUSES.has(s.status));
    const anySuccess = groupJobs.some((s) => DRS_SUCCESS_STATUSES.has(s.status));
    if (anySuccess && (allGroupTerminal || deadlineReached)) {
      ready.push(auditType);
    }
  }
  return ready;
}

/**
 * Groups the per-job statuses by analysis audit type and returns the types being dropped
 * on the final poll: those whose bucket never reached a DRS success status. This surfaces
 * the previously-silent "source dropped at the 3h budget" failure mode (P1-6) — without
 * this, a bucket that timed out or wholly failed its scrape was omitted with only a Slack
 * summary line and no structured, alertable log.
 *
 * `reason=scrape_failed` when every feeding job is terminal-without-success (FAILED/CANCELLED);
 * `reason=budget_exceeded` when at least one job was still non-terminal when the deadline hit.
 * Types already dispatched on this or a prior poll are excluded (they succeeded).
 *
 * @param {Array<{domain: string, status: string|undefined}>} statuses - Per-job statuses
 * @param {Set<string>} triggered - Audit types already dispatched (this + prior polls)
 * @returns {Array<{auditType: string, reason: string}>} Dropped audit types with a reason
 */
function computeDroppedAuditTypes(statuses, triggered) {
  const groups = new Map();
  for (const s of statuses) {
    const auditType = resolveAnalysisAuditType(s.domain);
    if (!auditType) {
      // eslint-disable-next-line no-continue
      continue;
    }
    if (!groups.has(auditType)) {
      groups.set(auditType, []);
    }
    groups.get(auditType).push(s);
  }

  const dropped = [];
  for (const [auditType, groupJobs] of groups) {
    if (triggered.has(auditType)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const anySuccess = groupJobs.some((s) => DRS_SUCCESS_STATUSES.has(s.status));
    if (anySuccess) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const allGroupTerminal = groupJobs.every((s) => DRS_TERMINAL_STATUSES.has(s.status));
    dropped.push({ auditType, reason: allGroupTerminal ? 'scrape_failed' : 'budget_exceeded' });
  }
  return dropped;
}

/**
 * Triggers the given downstream analysis audit types, forwarding the originating Slack
 * context so each posts its results to the same thread.
 *
 * An audit type is skipped (but still reported as handled) when a recent audit of the same
 * type already exists for the site (within AUDIT_TRIGGER_COOLDOWN_MS); this dedupes SQS
 * at-least-once redelivery. A per-type send failure is logged and the type is NOT reported
 * as handled, so the next poll retries it.
 *
 * @param {string[]} auditTypes - Analysis audit types to trigger
 * @param {string} siteId - The site ID
 * @param {object} slackContext - { channelId, threadTs } forwarded to the triggered audits
 * @param {object} context - Universal context (sqs, dataAccess, log)
 * @param {number} [drsStartedAt] - Epoch ms when DRS scraping was triggered (phase timing)
 * @param {boolean} [enableBrandProfile] - Forwarded from the originating Slack request (see
 *   offsite-brand-presence/handler.js) so it reaches the Mystique message the re-triggered
 *   analysis audit ultimately sends, instead of being lost across the scrape round-trip.
 * @param {number} [urlLimit] - Forwarded from the originating Slack request (see
 *   offsite-brand-presence/handler.js) so the re-triggered analysis audit resolves the same
 *   urlLimit, instead of losing it across the scrape round-trip.
 * @param {boolean} [enableSemrush] - Forwarded from the originating Slack request (see
 *   offsite-brand-presence/handler.js) so the re-triggered analysis audit's own scoped
 *   re-scrape (if it needs one) honors the same per-run Semrush override, instead of
 *   silently reverting to the env var across the scrape round-trip.
 * @returns {Promise<string[]>} Audit types that were dispatched or intentionally skipped
 */
async function triggerAnalysisAudits(
  auditTypes,
  siteId,
  slackContext,
  context,
  drsStartedAt,
  enableBrandProfile,
  urlLimit,
  enableSemrush,
) {
  const { sqs, dataAccess, log } = context;
  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE, siteId });

  const handled = [];
  if (auditTypes.length === 0) {
    return handled;
  }

  // The bucket's jobs are terminal now, so this is when DRS scraping finished for the
  // analysis types being dispatched. Paired with drsStartedAt it gives the DRS duration.
  const drsCompletedAt = Date.now();
  const configuration = await dataAccess.Configuration.findLatest();
  const queueUrl = configuration.getQueues().audits;
  for (const type of auditTypes) {
    try {
      // eslint-disable-next-line no-await-in-loop
      if (await hasRecentAudit(siteId, type, dataAccess, log)) {
        olog.skip('data_acquisition_analysis_request_handoff', `Skipping ${type} for site ${siteId} — recent audit exists`, {
          peer: PEER.SQS, direction: 'outbound', reason: 'cooldown', auditType: type,
        });
        handled.push(type);
        // eslint-disable-next-line no-continue
        continue;
      }
      const messageData = {
        ...(enableBrandProfile != null && { enableBrandProfile }),
        ...(urlLimit != null && { urlLimit }),
        ...(enableSemrush != null && { enableSemrush }),
      };
      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(queueUrl, {
        type,
        siteId,
        // DRS scraping is already done, so the analysis audit must analyze the available
        // data rather than request another scrape (prevents a scrape→analyze loop).
        // timings carry the DRS phase boundaries so the analysis can report scrape duration.
        auditContext: {
          slackContext,
          drsScrapeRequested: true,
          ...(Number.isFinite(drsStartedAt) && { timings: { drsStartedAt, drsCompletedAt } }),
          ...(Object.keys(messageData).length > 0 && { messageData }),
        },
      });
      olog.success('data_acquisition_analysis_request_handoff', `Triggered ${type} for site ${siteId}`, {
        peer: PEER.SQS, direction: 'outbound', auditType: type,
      });
      handled.push(type);
    } catch (err) {
      olog.warn('data_acquisition_analysis_request_handoff', `Failed to trigger ${type} analysis audit for site ${siteId}`, {
        peer: PEER.SQS, direction: 'outbound', auditType: type, ...errorField(err),
      });
    }
  }
  return handled;
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
function buildSummary(baseURL, statuses, drsStartedAt, triggeredAuditTypes = []) {
  const allTerminal = statuses.every((s) => DRS_TERMINAL_STATUSES.has(s.status));
  const header = allTerminal
    ? `:checkered_flag: *offsite-brand-presence* — *DRS scraping complete* for *${baseURL}*:`
    : `:hourglass_flowing_sand: *offsite-brand-presence* — *DRS scraping status update* for *${baseURL}* (timed out waiting):`;
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
  const elapsed = Number.isFinite(drsStartedAt) ? formatDuration(Date.now() - drsStartedAt) : null;
  if (elapsed) {
    lines.push(`• DRS scraping elapsed: ~${elapsed}`);
  }
  if (triggeredAuditTypes.length > 0) {
    lines.push(`• Analysis dispatched to Mystique for: ${triggeredAuditTypes.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Polls DRS for the offsite-brand-presence scrape jobs and fans out the downstream analysis
 * audits as their data becomes ready — regardless of how the run was triggered. Re-enqueues
 * itself until every job is terminal or the deadline passes; attended (Slack) runs also post a
 * completion summary and poll more often than unattended ones (see resolveDrsPollIntervalSeconds).
 *
 * Each downstream analysis audit is dispatched as soon as its own dataset(s) reach a
 * terminal success status, rather than waiting for every bucket to finish. This keeps a
 * fast bucket (e.g. reddit) from being held back by a slow one (e.g. top-cited, which
 * scrapes arbitrary third-party pages via BrightData and can take far longer). The set of
 * already-dispatched audit types travels with the re-enqueued poll message so each type is
 * triggered at most once across the poll lifecycle.
 *
 * @param {object} message - SQS message with auditContext { baseURL, slackContext?,
 *   jobs: [{domain, datasetId, jobId}], deadline, triggeredAuditTypes?, enableBrandProfile?,
 *   urlLimit?, enableSemrush? }
 * @param {object} context - Universal context (log, sqs, dataAccess, env)
 * @returns {Promise<Response>}
 */
export default async function offsiteBrandPresenceDrsStatusHandler(message, context) {
  const { log, sqs, dataAccess } = context;
  const { Configuration } = dataAccess;
  const { siteId, auditContext = {} } = message;
  const {
    baseURL, slackContext = {}, jobs = [], deadline, triggeredAuditTypes = [], drsStartedAt,
    enableBrandProfile, urlLimit, enableSemrush,
  } = auditContext;
  const { channelId, threadTs } = slackContext;
  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE, siteId });

  if (jobs.length === 0) {
    // ADR convention: "no jobs to poll" is the canonical .skip() case (info level,
    // outcome=skip) — not a warning. See scheduleDrsStatusPoll's analogous skip.
    olog.skip('data_acquisition_scrape_job_status_polled', `No jobs to poll, skipping (site ${siteId})`, {
      peer: PEER.DRS, reason: 'no_jobs',
    });
    return ok();
  }

  const drsClient = DrsClient.createFrom(context);

  const statuses = await Promise.all(jobs.map(async (job) => {
    // Terminal jobs never change — carry forward instead of re-calling getJob (avoids
    // redundant DRS traffic while the poll waits on a slow bucket like top-cited).
    if (DRS_TERMINAL_STATUSES.has(job.status)) {
      return job;
    }
    try {
      const result = await drsClient.getJob(job.jobId);
      return { ...job, status: result?.status, error: result?.error_message };
    } catch (err) {
      olog.warn('data_acquisition_scrape_job_status_polled', `getJob failed for ${job.jobId}`, {
        peer: PEER.DRS, drsJobId: job.jobId, ...errorField(err),
      });
      return { ...job, status: undefined, error: undefined };
    }
  }));

  const terminalCount = statuses.filter((s) => DRS_TERMINAL_STATUSES.has(s.status)).length;
  const allTerminal = terminalCount === statuses.length;
  const now = Date.now();
  const deadlineReached = now >= deadline;

  // P1-7: per-poll visibility. Emit a snapshot of terminal/total after resolving statuses
  // so the wait is observable in Splunk (previously nothing was logged on a normal poll).
  olog.start('data_acquisition_scrape_job_status_polled', `DRS poll for ${baseURL}: ${terminalCount}/${statuses.length} jobs terminal`, {
    peer: PEER.DRS, terminal: terminalCount, total: statuses.length,
  });

  // Dispatch the analysis audits for any buckets that just became ready, so early-finishing
  // datasets go to Mystique immediately instead of waiting for the slowest job. Best-effort:
  // a failure here must not abort the poll loop or cause the message to be redelivered.
  const alreadyTriggered = new Set(triggeredAuditTypes);
  let handled = [];
  try {
    const readyTypes = computeReadyAuditTypes(statuses, deadlineReached, alreadyTriggered);
    handled = await triggerAnalysisAudits(
      readyTypes,
      siteId,
      slackContext,
      context,
      drsStartedAt,
      enableBrandProfile,
      urlLimit,
      enableSemrush,
    );
  } catch (err) {
    olog.warn('data_acquisition_analysis_request_handoff', `Failed to trigger analysis audits for ${baseURL}`, {
      peer: PEER.SQS, direction: 'outbound', ...errorField(err),
    });
  }
  const nextTriggered = [...alreadyTriggered, ...handled];

  // Keep polling until every job is terminal or the deadline passes. Carry the set of
  // already-dispatched audit types forward so they are not re-triggered on later polls.
  if (!allTerminal && !deadlineReached) {
    const delaySeconds = Math.min(
      resolveDrsPollIntervalSeconds(slackContext),
      Math.max(0, Math.ceil((deadline - now) / 1000)),
      SQS_MAX_DELAY_SECONDS,
    );
    const configuration = await Configuration.findLatest();
    const nextMessage = {
      ...message,
      auditContext: {
        ...auditContext,
        // Persist resolved statuses so the next poll skips getJob for already-terminal jobs.
        jobs: statuses,
        triggeredAuditTypes: nextTriggered,
      },
    };
    // P1-5 ("wait dies partway"): the re-poll send was unguarded — a failure here silently
    // ended the poll lifecycle. Log it loudly, then re-throw to preserve the existing
    // SQS-redelivery behavior (the message is redelivered and the poll retried).
    try {
      await sqs.sendMessage(configuration.getQueues().audits, nextMessage, null, delaySeconds);
    } catch (err) {
      olog.failure('data_acquisition_scrape_job_poll_rescheduled', `Failed to re-enqueue DRS status poll for ${baseURL}`, {
        peer: PEER.SQS, direction: 'outbound', ...errorField(err),
      });
      throw err;
    }
    olog.success('data_acquisition_scrape_job_poll_rescheduled', `${terminalCount}/${statuses.length} jobs terminal for ${baseURL}, re-polling in ${delaySeconds}s`, {
      peer: PEER.SQS, direction: 'outbound', terminal: terminalCount, total: statuses.length, delaySeconds,
    });
    return ok();
  }

  // Final poll (all jobs terminal or deadline reached): post the one-time completion
  // summary. Analysis audits for terminal buckets were already dispatched above.
  //
  // Accepted trade-off: SQS at-least-once delivery means a crash after this post but
  // before the message is deleted could redeliver and post the summary twice. There is
  // no idempotency key; a duplicate Slack summary is preferable to the complexity of
  // deduplication for a best-effort notification.
  // P1-6 ("source dropped at the 3h budget"): any audit type whose bucket never produced a
  // DRS success is dropped here with no dispatch. Emit one structured, alertable failure per
  // dropped source (was previously visible only as prose in the Slack summary).
  const dropped = computeDroppedAuditTypes(statuses, new Set(nextTriggered));
  for (const { auditType, reason } of dropped) {
    olog.failure('data_acquisition_scrape_job_status_polled', `Dropping ${auditType} for ${baseURL}: no DRS success (${reason})`, {
      peer: PEER.DRS, reason, auditType,
    });
  }

  const summary = buildSummary(baseURL, statuses, drsStartedAt, nextTriggered);
  await postMessageOptional(context, channelId, summary, { threadTs });
  olog.success('data_acquisition_scrape_job_poll_summary_notified', `Posted completion summary for ${baseURL} (${statuses.length} jobs)`, {
    peer: PEER.SLACK, direction: 'outbound', jobs: statuses.length,
  });

  return ok();
}
