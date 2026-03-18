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
import {
  clearWorkflowDispatchReservation,
  loadScrapeResultPaths,
  markWorkflowDispatchSentWithRetry,
  releaseBatchProcessingClaim,
  reserveWorkflowDispatch,
  saveScrapeResultPaths,
  tryStartBatchProcessing,
} from './batch-state.js';
import { sleep } from '../support/utils.js';

const MAX_CONTINUATIONS = 50;

/* c8 ignore next 4 - Lambda runtime-only property */
function disableEventLoopWait(context) {
  if (context && 'callbackWaitsForEmptyEventLoop' in context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }
}

function getWorkflowCompletedAt(audit) {
  return audit?.getAuditResult?.()?.internalLinksWorkflowCompletedAt || null;
}

export function createCrawlBatchOrchestration({
  auditType,
  createContextLogger,
  detectBrokenLinksFromCrawlBatch,
  saveBatchResults,
  updateCache,
  loadCache,
  markBatchCompleted,
  isBatchCompleted,
  getTimeoutStatus,
  fetchLinkCheckerLogsStep,
  resumeLinkCheckerPollingStep,
}) {
  async function sendContinuationWithRetry({
    auditId,
    nextBatchIndex,
    continuationCount,
    site,
    audit,
    scrapeJobId,
    sqs,
    env,
    log,
    context,
  }) {
    const dispatchKey = `continue-${nextBatchIndex}`;
    const reservation = await reserveWorkflowDispatch(auditId, dispatchKey, context, {
      nextBatchIndex,
      continuationCount,
    });
    const maxRetries = 3;
    const continuationPayload = createAuditContinuationPayload({
      auditType,
      site,
      audit,
      auditContext: {
        next: 'runCrawlDetectionBatch',
        scrapeJobId,
        batchStartIndex: nextBatchIndex,
        continuationCount,
      },
    });
    if (reservation.state === 'sent') {
      log.info(`Continuation for batch starting at index ${nextBatchIndex} already dispatched or reserved`);
      return false;
    }
    /* c8 ignore next 3 - Requires concurrent worker holding the same reservation */
    if (!reservation.acquired) {
      throw new Error(`Continuation dispatch for batch ${nextBatchIndex} is still pending in another worker`);
    }

    let messageSent = false;
    try {
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
          messageSent = true;
          log.info(`Continuation message sent for batch starting at index ${nextBatchIndex} (attempt ${attempt}, continuation #${continuationCount})`);
          break;
        } catch (error) {
          if (attempt === maxRetries) {
            log.error(`Failed to send continuation after ${maxRetries} attempts: ${error.message}`);
            log.error(`MANUAL ACTION REQUIRED: Resume audit ${auditId} from batchIndex ${nextBatchIndex}`);
            throw new Error(`Continuation message failed after retries: ${error.message}`);
          }
          /* c8 ignore start - retry path behavior is validated by orchestration tests */
          log.warn(`Continuation message send failed (attempt ${attempt}), retrying...`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(1000 * attempt);
          /* c8 ignore stop */
        }
      }
      await markWorkflowDispatchSentWithRetry(auditId, dispatchKey, {
        ...context, log,
      }, {
        nextBatchIndex,
        continuationCount,
      });
      return true;
    } catch (error) {
      if (!messageSent) {
        await clearWorkflowDispatchReservation(auditId, dispatchKey, context);
        throw error;
      }
      /* c8 ignore next 4 */
      const batchErr = 'Continuation marker update failed '
        + `after send for batch ${nextBatchIndex}: ${error.message}`;
      throw new Error(batchErr);
    }
  }

  async function deferLinkCheckerToFreshLambda({
    auditId,
    sqs, env, site, audit, auditContext, scrapeJobId, log,
    context,
  }) {
    const dispatchKey = 'start-linkchecker-fresh-lambda';
    const reservation = await reserveWorkflowDispatch(auditId, dispatchKey, context, {
      scrapeJobId,
    });
    /* c8 ignore next 4 - Duplicate dispatch guard; requires SQS at-least-once redelivery */
    if (reservation.state === 'sent') {
      log.info('LinkChecker fresh-lambda start already dispatched or reserved');
      return false;
    }
    /* c8 ignore next 3 - Requires another worker to hold the same reservation */
    if (!reservation.acquired) {
      throw new Error('LinkChecker fresh-lambda dispatch is still pending in another worker');
    }

    log.warn('Deferring LinkChecker to fresh Lambda');
    let messageSent = false;
    try {
      await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, createAuditContinuationPayload({
        auditType,
        site,
        audit,
        auditContext: {
          ...auditContext,
          next: 'runCrawlDetectionBatch',
          startLinkChecker: true,
          scrapeJobId,
        },
      }));
      messageSent = true;
      await markWorkflowDispatchSentWithRetry(auditId, dispatchKey, {
        ...context, log,
      }, {
        scrapeJobId,
      });
      return true;
    /* c8 ignore start - SQS send-then-mark failure edge cases */
    } catch (error) {
      if (!messageSent) {
        await clearWorkflowDispatchReservation(auditId, dispatchKey, context);
        throw error;
      }
      const lcErr = 'LinkChecker fresh-lambda marker update '
        + `failed after send: ${error.message}`;
      throw new Error(lcErr);
    }
    /* c8 ignore stop */
  }

  async function processOneBatch({
    auditId, batchNum, batchStartIndex, batchSize, scrapeResultPaths, context, log,
  }) {
    const claimEtag = await tryStartBatchProcessing(auditId, batchNum, { ...context, log });
    /* c8 ignore next 4 - Concurrent worker guard; requires multi-Lambda race to trigger */
    if (!claimEtag) {
      log.info(`Batch ${batchNum} already claimed by another worker, skipping`);
      return null;
    }

    try {
      const { brokenUrlsCache, workingUrlsCache } = await loadCache(auditId, {
        ...context, log,
      });

      log.info(`Processing batch ${batchNum} (cache: ${brokenUrlsCache.length} broken, ${workingUrlsCache.length} working)`);
      const batchResult = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex,
        batchSize,
        initialBrokenUrls: brokenUrlsCache,
        initialWorkingUrls: workingUrlsCache,
      }, { ...context, log });

      await saveBatchResults(auditId, batchNum, batchResult.results, batchResult.pagesProcessed, {
        ...context, log,
      });

      await updateCache(auditId, batchResult.brokenUrlsCache, batchResult.workingUrlsCache, {
        ...context, log,
      });

      await markBatchCompleted(auditId, batchNum, { ...context, log });
      await releaseBatchProcessingClaim(auditId, batchNum, claimEtag, { ...context, log });

      log.info(`Batch ${batchNum}: ${batchResult.results.length} broken links from ${batchResult.pagesProcessed} pages`);
      return batchResult;
    /* c8 ignore start - Claim cleanup on unexpected batch failure */
    } catch (error) {
      await releaseBatchProcessingClaim(auditId, batchNum, claimEtag, { ...context, log });
      throw error;
    }
    /* c8 ignore stop */
  }

  async function runCrawlDetectionBatch(context) {
    disableEventLoopWait(context);
    const lambdaStartTime = context.lambdaStartTime ?? Date.now();
    const {
      log: baseLog, site, audit, auditContext, sqs, env,
    } = context;
    const config = createInternalLinksConfigResolver(site, env);

    let scrapeResultPaths = context.scrapeResultPaths ?? new Map();
    const scrapeJobId = context.scrapeJobId || 'N/A';
    const auditId = audit.getId();
    const initialBatchIndex = auditContext?.batchStartIndex || 0;
    const continuationCount = auditContext?.continuationCount || 0;
    const batchSize = config.getBatchSize();
    const minTimeNeeded = config.getLinkCheckerMinTimeNeededMs();

    const log = createContextLogger(baseLog, {
      auditType,
      siteId: site.getId(),
      auditId,
      step: 'run-crawl-detection-batch',
    });

    log.info(`====== Crawl Detection (continuation #${continuationCount}) ======`);
    log.info(`scrapeJobId: ${scrapeJobId}, auditId: ${auditId}`);

    const workflowCompletedAt = getWorkflowCompletedAt(audit);
    if (workflowCompletedAt) {
      log.info(`Audit already finalized at ${workflowCompletedAt}, skipping stale crawl execution`);
      return { status: 'already-finalized' };
    }

    if (initialBatchIndex === 0 && scrapeResultPaths.size > 0) {
      await saveScrapeResultPaths(auditId, scrapeResultPaths, { ...context, log });
    }

    if (initialBatchIndex > 0 && scrapeResultPaths.size === 0) {
      scrapeResultPaths = await loadScrapeResultPaths(auditId, { ...context, log });
      if (scrapeResultPaths.size === 0) {
        const auditResult = audit.getAuditResult?.();
        /* c8 ignore next 4 - Stale continuation after finalization */
        if (auditResult?.internalLinksWorkflowCompletedAt) {
          log.info(`Audit already finalized at ${auditResult.internalLinksWorkflowCompletedAt}, skipping stale continuation`);
          return { status: 'already-finalized' };
        }
        throw new Error(`Failed to reconstruct scrapeResultPaths for audit ${auditId}`);
      }
    }

    const totalPages = scrapeResultPaths.size;
    const estimatedTotalBatches = Math.ceil(totalPages / batchSize);
    log.info(`Total pages: ${totalPages}, Batch size: ${batchSize}, Start index: ${initialBatchIndex}, Total batches: ${estimatedTotalBatches}`);

    if (auditContext?.startLinkChecker) {
      log.info('Starting LinkChecker detection (triggered via SQS for fresh Lambda)');
      return fetchLinkCheckerLogsStep({ ...context, lambdaStartTime });
    }

    if (auditContext?.resumePolling) {
      log.info('Resuming LinkChecker polling (continuation from previous Lambda)');
      return resumeLinkCheckerPollingStep({ ...context, lambdaStartTime });
    }

    if (scrapeResultPaths.size === 0) {
      log.info('No scraped content available, proceeding to LinkChecker detection');
      return fetchLinkCheckerLogsStep({
        ...context,
        skipCrawlDetection: true,
        lambdaStartTime,
      });
    }

    /* c8 ignore next 5 - Runaway loop guard; MAX_CONTINUATIONS is high and not unit-testable */
    if (continuationCount >= MAX_CONTINUATIONS) {
      log.error(`Max continuations (${MAX_CONTINUATIONS}) reached, stopping batch processing to prevent runaway loop`);
      log.warn('Proceeding to LinkChecker/finalization with whatever batches completed so far');
      return fetchLinkCheckerLogsStep({ ...context, lambdaStartTime });
    }

    let currentIndex = initialBatchIndex;
    let batchesProcessedThisLambda = 0;
    let batchesSkipped = 0;

    while (currentIndex < totalPages) {
      const batchNum = Math.floor(currentIndex / batchSize);

      const timeoutStatus = getTimeoutStatus(lambdaStartTime, context);
      if (timeoutStatus.isApproachingTimeout) {
        log.info(`Approaching timeout after ${batchesProcessedThisLambda} batch(es), sending continuation at index ${currentIndex}`);
        // eslint-disable-next-line no-await-in-loop
        await sendContinuationWithRetry({
          auditId,
          nextBatchIndex: currentIndex,
          continuationCount: continuationCount + 1,
          site,
          audit,
          scrapeJobId,
          sqs,
          env,
          log,
          context,
        });
        return {
          status: 'batch-continuation',
          batchesProcessedThisLambda,
          batchesSkipped,
        };
      }

      // eslint-disable-next-line no-await-in-loop
      if (await isBatchCompleted(auditId, batchNum, context)) {
        log.debug(`Batch ${batchNum} already completed, skipping`);
        currentIndex += batchSize;
        batchesSkipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }

      let batchResult;
      try {
        // eslint-disable-next-line no-await-in-loop
        batchResult = await processOneBatch({
          auditId,
          batchNum,
          batchStartIndex: currentIndex,
          batchSize,
          scrapeResultPaths,
          context,
          log,
        });
      } catch (error) {
        log.error(`Batch ${batchNum} processing failed: ${error.message}`);
        throw error;
      }

      /* c8 ignore next 5 - Requires duplicate-delivered message racing an active batch claim */
      if (batchResult === null) {
        throw new Error(
          `Batch ${batchNum} is already being processed by another worker; retrying the same message`,
        );
      }

      batchesProcessedThisLambda += 1;
      currentIndex = batchResult.nextBatchStartIndex;
    }

    log.info(`All ${estimatedTotalBatches} batches complete (${batchesProcessedThisLambda} processed, ${batchesSkipped} skipped in this Lambda)`);

    const postBatchTimeoutStatus = getTimeoutStatus(lambdaStartTime, context);
    if (postBatchTimeoutStatus.safeTimeRemaining < minTimeNeeded) {
      log.warn(`Only ${Math.floor(postBatchTimeoutStatus.safeTimeRemaining / 1000)}s remaining after batch processing`);
      await deferLinkCheckerToFreshLambda({
        auditId,
        sqs,
        env,
        site,
        audit,
        auditContext,
        scrapeJobId,
        log,
        context,
      });
      return { status: 'linkchecker-deferred' };
    }

    log.info(`${Math.floor(postBatchTimeoutStatus.safeTimeRemaining / 1000)}s remaining, proceeding to LinkChecker`);
    return fetchLinkCheckerLogsStep({ ...context, lambdaStartTime });
  }

  return {
    runCrawlDetectionBatch,
  };
}
