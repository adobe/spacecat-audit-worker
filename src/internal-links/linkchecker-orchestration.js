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

import { createInternalLinksConfigResolver } from './config.js';
import { createAuditContinuationPayload } from './orchestration-payloads.js';
import { createInternalLinksStepLogger } from './logging.js';
import {
  reserveWorkflowDispatch,
  markWorkflowDispatchSentWithRetry,
  clearWorkflowDispatchReservation,
  tryAcquireExecutionLock,
  releaseExecutionLock,
} from './batch-state.js';
import { sleep } from '../support/utils.js';
import { resolveInternalLinksBaseURL } from './base-url.js';

const MAX_POLLING_CONTINUATIONS = 10;

/* c8 ignore next 4 - Lambda runtime-only property */
function disableEventLoopWait(context) {
  if (context && 'callbackWaitsForEmptyEventLoop' in context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }
}

function getWorkflowCompletedAt(audit) {
  return audit?.getAuditResult?.()?.internalLinksWorkflowCompletedAt || null;
}

function buildLinkCheckerFinalizationContext(context, status, error = null, results = null) {
  return {
    ...context,
    linkCheckerStatus: status,
    ...(error ? { linkCheckerError: error } : {}),
    ...(results ? { linkCheckerResults: results } : {}),
  };
}

function isRetryableLinkCheckerError(error) {
  /* c8 ignore next - fallback coercion branch */
  const message = error?.message || '';
  return message.includes('already executing')
    || message.includes('retrying later')
    || message.includes('still pending in another worker')
    || message.includes('continuation failed after retries')
    || message.includes('marker update failed after send');
}

export function createLinkCheckerOrchestration({
  auditType,
  createContextLogger,
  getTimeoutStatus,
  buildLinkCheckerQuery,
  submitSplunkJob,
  pollJobStatus,
  fetchJobResults,
  createSplunkClient,
  finalizeCrawlDetection,
}) {
  async function sendPollingContinuationWithRetry({
    auditId,
    sqs,
    env,
    site,
    audit,
    auditContext,
    log,
    attemptLabel,
    context,
  }) {
    /* c8 ignore next - Defensive fallback for missing pollingContinuationCount */
    const dispatchKey = `linkchecker-poll-${auditContext.linkCheckerJobId || 'unknown'}-${auditContext.pollingContinuationCount || 0}`;
    const reservation = await reserveWorkflowDispatch(auditId, dispatchKey, context, {
      pollingContinuationCount: auditContext.pollingContinuationCount,
      linkCheckerJobId: auditContext.linkCheckerJobId,
    });
    /* c8 ignore next 7 - Duplicate dispatch guard; requires SQS at-least-once redelivery */
    if (reservation.state === 'sent') {
      log.info(`${attemptLabel} continuation already dispatched or reserved`);
      return false;
    }
    if (!reservation.acquired) {
      throw new Error(`${attemptLabel} continuation is still pending in another worker`);
    }

    const maxRetries = 3;
    const payload = createAuditContinuationPayload({
      auditType,
      site,
      audit,
      auditContext,
    });

    let messageSent = false;
    try {
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, payload);
          messageSent = true;
          log.info(`Continuation message sent for ${attemptLabel} (attempt ${attempt})`);
          break;
        /* c8 ignore start - SQS retry/cleanup paths tested via integration */
        } catch (error) {
          if (attempt === maxRetries) {
            log.error(`Failed to send ${attemptLabel} continuation after ${maxRetries} attempts: ${error.message}`);
            throw new Error(`${attemptLabel} continuation failed after retries: ${error.message}`);
          }
          log.warn(`Continuation send failed for ${attemptLabel} (attempt ${attempt}), retrying...`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(1000 * attempt);
        }
        /* c8 ignore stop */
      }
      await markWorkflowDispatchSentWithRetry(auditId, dispatchKey, {
        ...context, log,
      }, {
        pollingContinuationCount: auditContext.pollingContinuationCount,
      });
      return true;
    /* c8 ignore start - SQS send failure cleanup; tested via integration */
    } catch (error) {
      if (!messageSent) {
        await clearWorkflowDispatchReservation(auditId, dispatchKey, context);
        throw error;
      }
      throw new Error(`${attemptLabel} continuation marker update failed after send: ${error.message}`);
    }
    /* c8 ignore stop */
  }

  function buildPollingContext({
    sid, jobStartTime, skipCrawlDetection, pollingContinuationCount,
  }) {
    return {
      next: 'runCrawlDetectionBatch',
      resumePolling: true,
      linkCheckerJobId: sid,
      linkCheckerStartTime: jobStartTime,
      skipCrawlDetection,
      pollingContinuationCount,
    };
  }

  async function fetchLinkCheckerLogsStep(context) {
    disableEventLoopWait(context);
    const startTime = context.lambdaStartTime ?? Date.now();
    const {
      log: baseLog, site, audit, sqs, env, skipCrawlDetection = false,
    } = context;
    const config = createInternalLinksConfigResolver(site, env);

    const auditId = audit.getId();
    const executionLockKey = 'linkchecker-start';
    const linkCheckerFlagDebug = config.getLinkCheckerFlagDebugInfo();
    const isLinkcheckerEnabled = linkCheckerFlagDebug.enabled;
    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType,
      siteId: site.getId(),
      auditId,
      step: 'fetch-linkchecker-logs',
    });

    log.info('====== LinkChecker Detection Step ======');
    log.info(
      `auditId: ${auditId}, isLinkcheckerEnabled: ${isLinkcheckerEnabled}, `
      + `flagSource=${linkCheckerFlagDebug.source}, `
      + `camelCaseRaw=${String(linkCheckerFlagDebug.camelCaseRaw)}, `
      + `legacyRaw=${String(linkCheckerFlagDebug.legacyRaw)}, `
      + 'resolverVersion=v2',
    );

    const workflowCompletedAt = getWorkflowCompletedAt(audit);
    if (workflowCompletedAt) {
      log.info(`Audit already finalized at ${workflowCompletedAt}, skipping stale LinkChecker start`);
      return { status: 'already-finalized' };
    }

    const executionLockEtag = await tryAcquireExecutionLock(auditId, executionLockKey, {
      ...context,
      log,
    });
    /* c8 ignore next 3 - Requires a concurrent worker to already hold the start lock */
    if (!executionLockEtag) {
      throw new Error(`LinkChecker start is already executing for audit ${auditId}; retrying later`);
    }

    try {
      if (!isLinkcheckerEnabled) {
        log.info('LinkChecker detection disabled in site config, skipping');
        return finalizeCrawlDetection(
          buildLinkCheckerFinalizationContext(context, 'skipped'),
          { skipCrawlDetection },
          startTime,
        );
      }

      const programId = config.getLinkCheckerProgramId();
      const environmentId = config.getLinkCheckerEnvironmentId();

      if (!programId || !environmentId) {
        log.warn('Missing AEM programId or environmentId, skipping LinkChecker detection');
        return finalizeCrawlDetection(
          buildLinkCheckerFinalizationContext(context, 'skipped'),
          { skipCrawlDetection },
          startTime,
        );
      }

      /* c8 ignore next - fallback branch when lookback is missing */
      const lookbackMinutes = config.getLinkCheckerLookbackMinutes();

      log.info(`Starting LinkChecker detection: programId=${programId}, environmentId=${environmentId}, lookback=${lookbackMinutes}m`);

      const searchQuery = buildLinkCheckerQuery({
        programId,
        environmentId,
        lookbackMinutes,
        scopeBaseURL: resolveInternalLinksBaseURL(site),
      });

      log.info('Submitting Splunk job for LinkChecker logs');

      const client = await createSplunkClient(context);
      await client.login();

      const sid = await submitSplunkJob(client, searchQuery, log);
      log.info(`Splunk job submitted successfully: sid=${sid}`);

      const jobStartTime = Date.now();
      const { maxPollAttempts, pollIntervalMs } = config.getLinkCheckerPollingConfig();

      for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
        const timeoutStatus = getTimeoutStatus(startTime, context);
        if (timeoutStatus.isApproachingTimeout) {
          log.warn(`Approaching Lambda timeout (${timeoutStatus.percentUsed.toFixed(1)}% used), sending continuation for polling`);
          // eslint-disable-next-line no-await-in-loop
          await sendPollingContinuationWithRetry({
            auditId,
            sqs,
            env,
            site,
            audit,
            auditContext: buildPollingContext({
              sid, jobStartTime, skipCrawlDetection, pollingContinuationCount: 1,
            }),
            log,
            attemptLabel: 'LinkChecker polling',
            context,
          });
          return { status: 'linkchecker-polling-continuation' };
        }

        // eslint-disable-next-line no-await-in-loop
        const status = await pollJobStatus(client, sid, log);

        if (status.isFailed) {
          const failureMessage = `LinkChecker Splunk job failed: sid=${sid}, dispatchState=${status.dispatchState}`;
          log.error(failureMessage);
          log.warn('Finalizing audit without LinkChecker results because the Splunk job reached a terminal failure state');
          return finalizeCrawlDetection(
            buildLinkCheckerFinalizationContext(context, 'failed', failureMessage),
            { skipCrawlDetection },
            startTime,
          );
        }

        if (status.isDone) {
          log.info(`Splunk job completed after ${attempt} poll(s), fetching results`);
          // eslint-disable-next-line no-await-in-loop
          const linkCheckerResults = await fetchJobResults(client, sid, log);
          log.info(`LinkChecker detection found ${linkCheckerResults.length} broken links`);

          return finalizeCrawlDetection({
            ...buildLinkCheckerFinalizationContext(context, 'completed', null, linkCheckerResults),
          }, { skipCrawlDetection }, startTime);
        }

        log.info(`Job not ready (attempt ${attempt}/${maxPollAttempts}), waiting ${pollIntervalMs}ms`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollIntervalMs);
      }

      log.warn(`Max poll attempts (${maxPollAttempts}) reached, job still running. Sending continuation.`);
      await sendPollingContinuationWithRetry({
        auditId,
        sqs,
        env,
        site,
        audit,
        auditContext: buildPollingContext({
          sid, jobStartTime, skipCrawlDetection, pollingContinuationCount: 1,
        }),
        log,
        attemptLabel: 'LinkChecker polling',
        context,
      });
      return { status: 'linkchecker-polling-continuation' };
    } catch (error) {
      log.error(`LinkChecker detection failed: ${error.message}`, error);
      /* c8 ignore next 3 - Retryable error re-throw; requires concurrent-worker collision */
      if (isRetryableLinkCheckerError(error)) {
        throw error;
      }
      log.warn('Finalizing audit without LinkChecker results because LinkChecker detection could not complete');
      return finalizeCrawlDetection(
        buildLinkCheckerFinalizationContext(context, 'failed', error.message),
        { skipCrawlDetection },
        startTime,
      );
    /* c8 ignore next */
    } finally {
      await releaseExecutionLock(auditId, executionLockKey, executionLockEtag, {
        ...context,
        log,
      });
    }
  }

  async function resumeLinkCheckerPollingStep(context) {
    disableEventLoopWait(context);
    const startTime = context.lambdaStartTime ?? Date.now();
    const {
      log: baseLog, site, audit, auditContext, sqs, env,
    } = context;
    const config = createInternalLinksConfigResolver(site, env);

    const auditId = audit.getId();
    const sid = auditContext?.linkCheckerJobId;
    /* c8 ignore next - fallback for legacy continuations without timestamp */
    const jobStartTime = auditContext?.linkCheckerStartTime ?? Date.now();
    const skipCrawlDetection = auditContext?.skipCrawlDetection ?? false;
    const pollingContinuationCount = auditContext?.pollingContinuationCount || 0;

    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType,
      siteId: site.getId(),
      auditId,
      step: 'resume-linkchecker-polling',
      extraContext: { linkCheckerJobId: sid },
    });

    log.info('====== LinkChecker Polling Continuation ======');
    log.info(`auditId: ${auditId}, sid: ${sid}, pollingContinuation: #${pollingContinuationCount}`);

    const workflowCompletedAt = getWorkflowCompletedAt(audit);
    if (workflowCompletedAt) {
      log.info(`Audit already finalized at ${workflowCompletedAt}, skipping stale LinkChecker polling`);
      return { status: 'already-finalized' };
    }

    if (!sid) {
      const failureMessage = 'Missing linkCheckerJobId in auditContext, cannot resume polling';
      log.error(failureMessage);
      throw new Error(failureMessage);
    }

    const executionLockKey = `linkchecker-poll-${sid}`;
    const executionLockEtag = await tryAcquireExecutionLock(auditId, executionLockKey, {
      ...context,
      log,
    });
    /* c8 ignore next 3 - Requires a concurrent worker to already hold the polling lock */
    if (!executionLockEtag) {
      throw new Error(`LinkChecker polling is already executing for sid=${sid}; retrying later`);
    }

    try {
      /* c8 ignore next 5 - Runaway polling guard; MAX_POLLING_CONTINUATIONS is high */
      if (pollingContinuationCount >= MAX_POLLING_CONTINUATIONS) {
        const failureMessage = `Max polling continuations (${MAX_POLLING_CONTINUATIONS}) reached for sid=${sid}`;
        log.error(failureMessage);
        throw new Error(failureMessage);
      }

      const totalJobDuration = Date.now() - jobStartTime;
      const maxJobDurationMinutes = config.getLinkCheckerMaxJobDurationMinutes();
      const maxJobDuration = maxJobDurationMinutes * 60 * 1000;

      if (totalJobDuration > maxJobDuration) {
        const failureMessage = `LinkChecker job exceeded max duration for sid=${sid}`;
        log.warn(failureMessage);
        throw new Error(failureMessage);
      }

      const client = await createSplunkClient(context);
      await client.login();

      const { maxPollAttempts, pollIntervalMs } = config.getLinkCheckerPollingConfig();
      const nextContinuationCount = pollingContinuationCount + 1;

      for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
        const timeoutStatus = getTimeoutStatus(startTime, context);
        if (timeoutStatus.isApproachingTimeout) {
          log.warn('Approaching Lambda timeout, sending another continuation for polling');
          // eslint-disable-next-line no-await-in-loop
          await sendPollingContinuationWithRetry({
            auditId,
            sqs,
            env,
            site,
            audit,
            auditContext: buildPollingContext({
              sid,
              jobStartTime,
              skipCrawlDetection,
              pollingContinuationCount: nextContinuationCount,
            }),
            log,
            attemptLabel: 'continued LinkChecker polling',
            context,
          });
          return { status: 'linkchecker-polling-continuation' };
        }

        // eslint-disable-next-line no-await-in-loop
        const status = await pollJobStatus(client, sid, log);

        if (status.isFailed) {
          const failureMessage = `LinkChecker Splunk job failed: sid=${sid}, dispatchState=${status.dispatchState}`;
          log.error(failureMessage);
          throw new Error(failureMessage);
        }

        if (status.isDone) {
          log.info(`Splunk job completed after ${attempt} poll(s) in continuation, fetching results`);
          // eslint-disable-next-line no-await-in-loop
          const linkCheckerResults = await fetchJobResults(client, sid, log);
          log.info(`LinkChecker detection found ${linkCheckerResults.length} broken links`);

          return finalizeCrawlDetection({
            ...buildLinkCheckerFinalizationContext(context, 'completed', null, linkCheckerResults),
          }, { skipCrawlDetection }, startTime);
        }

        log.info(`Job not ready (attempt ${attempt}/${maxPollAttempts}), waiting ${pollIntervalMs}ms`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollIntervalMs);
      }

      log.warn(`Max poll attempts (${maxPollAttempts}) reached in continuation. Sending another continuation.`);
      await sendPollingContinuationWithRetry({
        auditId,
        sqs,
        env,
        site,
        audit,
        auditContext: buildPollingContext({
          sid,
          jobStartTime,
          skipCrawlDetection,
          pollingContinuationCount: nextContinuationCount,
        }),
        log,
        attemptLabel: 'continued LinkChecker polling',
        context,
      });
      return { status: 'linkchecker-polling-continuation' };
    } catch (error) {
      log.error(`LinkChecker polling continuation failed: ${error.message}`, error);
      throw error;
    /* c8 ignore next */
    } finally {
      await releaseExecutionLock(auditId, executionLockKey, executionLockEtag, {
        ...context,
        log,
      });
    }
  }

  return {
    fetchLinkCheckerLogsStep,
    resumeLinkCheckerPollingStep,
  };
}
