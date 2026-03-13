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

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

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
  async function fetchLinkCheckerLogsStep(context) {
    const startTime = Date.now();
    const {
      log: baseLog, site, audit, sqs, env, skipCrawlDetection = false,
    } = context;
    const config = createInternalLinksConfigResolver(site, env);

    const auditId = audit.getId();
    const isLinkcheckerEnabled = config.isLinkCheckerEnabled();
    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType,
      siteId: site.getId(),
      auditId,
      step: 'fetch-linkchecker-logs',
    });

    log.info('====== LinkChecker Detection Step ======');
    log.info(`auditId: ${auditId}, isLinkcheckerEnabled: ${isLinkcheckerEnabled}`);

    if (!isLinkcheckerEnabled) {
      log.info('LinkChecker detection disabled in site config, skipping');
      return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
    }

    const programId = config.getLinkCheckerProgramId();
    const environmentId = config.getLinkCheckerEnvironmentId();

    if (!programId || !environmentId) {
      log.warn('Missing AEM programId or environmentId, skipping LinkChecker detection');
      return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
    }

    /* c8 ignore next - fallback branch when lookback is missing */
    const lookbackMinutes = config.getLinkCheckerLookbackMinutes();

    log.info(`Starting LinkChecker detection: programId=${programId}, environmentId=${environmentId}, lookback=${lookbackMinutes}m`);

    try {
      const searchQuery = buildLinkCheckerQuery({
        programId,
        environmentId,
        lookbackMinutes,
      });

      log.info('Submitting Splunk job for LinkChecker logs');

      const client = await createSplunkClient(context);
      await client.login();

      const sid = await submitSplunkJob(client, searchQuery, log);
      log.info(`Splunk job submitted successfully: sid=${sid}`);

      const auditContextWithJob = {
        next: 'runCrawlDetectionBatch',
        resumePolling: true,
        linkCheckerJobId: sid,
        linkCheckerStartTime: Date.now(),
        skipCrawlDetection,
      };

      const { maxPollAttempts, pollIntervalMs } = config.getLinkCheckerPollingConfig();

      for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
        const timeoutStatus = getTimeoutStatus(startTime);
        if (timeoutStatus.isApproachingTimeout) {
          log.warn(`Approaching Lambda timeout (${timeoutStatus.percentUsed.toFixed(1)}% used), sending continuation for polling`);
          // eslint-disable-next-line no-await-in-loop
          await sqs.sendMessage(
            env.AUDIT_JOBS_QUEUE_URL,
            createAuditContinuationPayload({
              auditType,
              site,
              audit,
              auditContext: auditContextWithJob,
            }),
          );
          log.info('Continuation message sent for LinkChecker polling');
          return { status: 'linkchecker-polling-continuation' };
        }

        // eslint-disable-next-line no-await-in-loop
        const status = await pollJobStatus(client, sid, log);

        if (status.isFailed) {
          log.error(`Splunk job failed: sid=${sid}, dispatchState=${status.dispatchState}`);
          log.warn('Proceeding to finalization without LinkChecker data');
          return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
        }

        if (status.isDone) {
          log.info(`Splunk job completed after ${attempt} poll(s), fetching results`);
          // eslint-disable-next-line no-await-in-loop
          const linkCheckerResults = await fetchJobResults(client, sid, log);
          log.info(`LinkChecker detection found ${linkCheckerResults.length} broken links`);

          return finalizeCrawlDetection({
            ...context,
            linkCheckerResults,
          }, { skipCrawlDetection }, startTime);
        }

        log.info(`Job not ready (attempt ${attempt}/${maxPollAttempts}), waiting ${pollIntervalMs}ms`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollIntervalMs);
      }

      log.warn(`Max poll attempts (${maxPollAttempts}) reached, job still running. Sending continuation.`);
      await sqs.sendMessage(
        env.AUDIT_JOBS_QUEUE_URL,
        createAuditContinuationPayload({
          auditType,
          site,
          audit,
          auditContext: auditContextWithJob,
        }),
      );
      log.info('Continuation message sent for LinkChecker polling (max attempts reached)');
      return { status: 'linkchecker-polling-continuation' };
    } catch (error) {
      log.error(`LinkChecker detection failed: ${error.message}`, error);
      log.warn('Proceeding to finalization without LinkChecker data');
      return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
    }
  }

  async function resumeLinkCheckerPollingStep(context) {
    const startTime = Date.now();
    const {
      log: baseLog, site, audit, auditContext, sqs, env,
    } = context;
    const config = createInternalLinksConfigResolver(site, env);

    const auditId = audit.getId();
    const sid = auditContext?.linkCheckerJobId;
    /* c8 ignore next - fallback for legacy continuations without timestamp */
    const jobStartTime = auditContext?.linkCheckerStartTime || Date.now();
    const skipCrawlDetection = auditContext?.skipCrawlDetection ?? false;

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
    log.info(`auditId: ${auditId}, sid: ${sid}`);

    if (!sid) {
      log.error('Missing linkCheckerJobId in auditContext, cannot resume polling');
      return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
    }

    const totalJobDuration = Date.now() - jobStartTime;
    const maxJobDurationMinutes = config.getLinkCheckerMaxJobDurationMinutes();
    const maxJobDuration = maxJobDurationMinutes * 60 * 1000;

    if (totalJobDuration > maxJobDuration) {
      log.warn(`LinkChecker job has been running for ${Math.floor(totalJobDuration / 1000)}s (max ${Math.floor(maxJobDuration / 1000)}s), aborting`);
      log.warn('Proceeding to finalization without LinkChecker data');
      return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
    }

    try {
      const client = await createSplunkClient(context);
      await client.login();

      const { maxPollAttempts, pollIntervalMs } = config.getLinkCheckerPollingConfig();

      for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
        const timeoutStatus = getTimeoutStatus(startTime);
        if (timeoutStatus.isApproachingTimeout) {
          log.warn('Approaching Lambda timeout, sending another continuation for polling');
          // eslint-disable-next-line no-await-in-loop
          await sqs.sendMessage(
            env.AUDIT_JOBS_QUEUE_URL,
            createAuditContinuationPayload({
              auditType,
              site,
              audit,
              auditContext: {
                next: 'runCrawlDetectionBatch',
                resumePolling: true,
                linkCheckerJobId: sid,
                linkCheckerStartTime: jobStartTime,
                skipCrawlDetection,
              },
            }),
          );
          log.info('Continuation message sent for continued polling');
          return { status: 'linkchecker-polling-continuation' };
        }

        // eslint-disable-next-line no-await-in-loop
        const status = await pollJobStatus(client, sid, log);

        if (status.isFailed) {
          log.error(`Splunk job failed: sid=${sid}, dispatchState=${status.dispatchState}`);
          log.warn('Proceeding to finalization without LinkChecker data');
          return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
        }

        if (status.isDone) {
          log.info(`Splunk job completed after ${attempt} poll(s) in continuation, fetching results`);
          // eslint-disable-next-line no-await-in-loop
          const linkCheckerResults = await fetchJobResults(client, sid, log);
          log.info(`LinkChecker detection found ${linkCheckerResults.length} broken links`);

          return finalizeCrawlDetection({
            ...context,
            linkCheckerResults,
          }, { skipCrawlDetection }, startTime);
        }

        log.info(`Job not ready (attempt ${attempt}/${maxPollAttempts}), waiting ${pollIntervalMs}ms`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(pollIntervalMs);
      }

      log.warn(`Max poll attempts (${maxPollAttempts}) reached in continuation. Sending another continuation.`);
      await sqs.sendMessage(
        env.AUDIT_JOBS_QUEUE_URL,
        createAuditContinuationPayload({
          auditType,
          site,
          audit,
          auditContext: {
            next: 'runCrawlDetectionBatch',
            resumePolling: true,
            linkCheckerJobId: sid,
            linkCheckerStartTime: jobStartTime,
            skipCrawlDetection,
          },
        }),
      );
      log.info('Continuation message sent for continued polling');
      return { status: 'linkchecker-polling-continuation' };
    } catch (error) {
      log.error(`LinkChecker polling continuation failed: ${error.message}`, error);
      log.warn('Proceeding to finalization without LinkChecker data');
      return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
    }
  }

  return {
    fetchLinkCheckerLogsStep,
    resumeLinkCheckerPollingStep,
  };
}
