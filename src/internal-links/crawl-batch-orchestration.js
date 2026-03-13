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

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export function createCrawlBatchOrchestration({
  auditType,
  pagesPerBatch,
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
    batchSize = pagesPerBatch,
    site,
    audit,
    scrapeJobId,
    sqs,
    env,
    log,
  }) {
    const maxRetries = 3;
    const continuationPayload = createAuditContinuationPayload({
      auditType,
      site,
      audit,
      auditContext: {
        next: 'runCrawlDetectionBatch',
        scrapeJobId,
        batchStartIndex: nextBatchIndex,
      },
    });
    const sendAttempt = async (attempt) => {
      try {
        await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
        log.info(`Continuation message sent successfully for batch ${Math.floor(nextBatchIndex / batchSize)} (attempt ${attempt})`);
      } catch (error) {
        if (attempt === maxRetries) {
          log.error(`Failed to send continuation after ${maxRetries} attempts: ${error.message}`);
          log.error(`MANUAL ACTION REQUIRED: Resume audit ${auditId} from batchIndex ${nextBatchIndex}`);
          log.error(`Batch ${Math.floor(nextBatchIndex / batchSize) - 1} is saved. Audit can be resumed.`);
          throw new Error(`Continuation message failed after retries: ${error.message}`);
        }
        /* c8 ignore start - retry path behavior is validated by orchestration tests */
        log.warn(`Continuation message send failed (attempt ${attempt}), retrying...`);
        await sleep(1000 * attempt);
        await sendAttempt(attempt + 1);
        /* c8 ignore stop */
        /* c8 ignore next */
      }
    };

    await sendAttempt(1);
  }

  async function runCrawlDetectionBatch(context) {
    const startTime = Date.now();
    const {
      log: baseLog, site, audit, auditContext, sqs, env,
    } = context;
    const config = createInternalLinksConfigResolver(site, env);

    const scrapeResultPaths = context.scrapeResultPaths ?? new Map();
    const scrapeJobId = context.scrapeJobId || 'N/A';
    const auditId = audit.getId();
    const batchStartIndex = auditContext?.batchStartIndex || 0;
    const totalPages = scrapeResultPaths.size;
    const batchSize = config.getBatchSize();
    const minTimeNeeded = config.getLinkCheckerMinTimeNeededMs();
    const estimatedTotalBatches = Math.ceil(totalPages / batchSize);
    const currentBatchNum = Math.floor(batchStartIndex / batchSize);

    const log = createContextLogger(baseLog, {
      auditType,
      siteId: site.getId(),
      auditId,
      step: 'run-crawl-detection-batch',
      batchNum: currentBatchNum,
    });

    log.info(`====== Crawl Detection Batch ${currentBatchNum + 1}/${estimatedTotalBatches || 1} ======`);
    log.info(`scrapeJobId: ${scrapeJobId}, auditId: ${auditId}`);
    log.info(`Total pages: ${totalPages}, Batch size: ${batchSize}, Start index: ${batchStartIndex}`);

    const timeoutStatus = getTimeoutStatus(startTime);
    log.debug(`Timeout status: ${timeoutStatus.percentUsed.toFixed(1)}% used, ${(timeoutStatus.safeTimeRemaining / 1000).toFixed(0)}s safe time remaining`);

    if (auditContext?.startLinkChecker) {
      log.info('Starting LinkChecker detection (triggered via SQS for fresh Lambda)');
      return fetchLinkCheckerLogsStep(context);
    }

    if (auditContext?.resumePolling) {
      log.info('Resuming LinkChecker polling (continuation from previous Lambda)');
      return resumeLinkCheckerPollingStep(context);
    }

    if (scrapeResultPaths.size === 0) {
      log.info('No scraped content available, proceeding to LinkChecker detection');
      return fetchLinkCheckerLogsStep({ ...context, skipCrawlDetection: true });
    }

    if (batchStartIndex >= totalPages) {
      log.info(`Batch start index (${batchStartIndex}) >= total pages (${totalPages}), all batches complete`);
      const currentTimeoutStatus = getTimeoutStatus(startTime);
      if (currentTimeoutStatus.safeTimeRemaining < minTimeNeeded) {
        log.warn(`Only ${Math.floor(currentTimeoutStatus.safeTimeRemaining / 1000)}s remaining, deferring LinkChecker to fresh Lambda`);
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
        return { status: 'linkchecker-deferred' };
      }

      log.info(`${Math.floor(currentTimeoutStatus.safeTimeRemaining / 1000)}s remaining, proceeding to LinkChecker in current Lambda`);
      return fetchLinkCheckerLogsStep(context);
    }

    if (await isBatchCompleted(auditId, currentBatchNum, context)) {
      log.info(`Batch ${currentBatchNum} already completed (duplicate message), checking for continuation...`);

      const hasMorePages = batchStartIndex + batchSize < totalPages;

      if (hasMorePages) {
        log.info('More batches remain, re-sending continuation message (safe duplicate)');
        await sendContinuationWithRetry({
          auditId,
          nextBatchIndex: batchStartIndex + batchSize,
          batchSize,
          site,
          audit,
          scrapeJobId,
          sqs,
          env,
          log,
        });
        return { status: 'already-completed-continuation-sent' };
      }

      log.info('All batches complete (duplicate message), checking time for LinkChecker');
      const duplicateTimeoutStatus = getTimeoutStatus(startTime);
      if (duplicateTimeoutStatus.safeTimeRemaining < minTimeNeeded) {
        log.warn(`Only ${Math.floor(duplicateTimeoutStatus.safeTimeRemaining / 1000)}s remaining, deferring LinkChecker to fresh Lambda`);
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
        return { status: 'linkchecker-deferred' };
      }

      log.info('All batches complete, proceeding to finalization');
      return fetchLinkCheckerLogsStep(context);
    }

    const preProcessTimeoutStatus = getTimeoutStatus(startTime);
    log.info(`Starting batch ${currentBatchNum} - time used: ${preProcessTimeoutStatus.percentUsed.toFixed(1)}%`);

    if (preProcessTimeoutStatus.isApproachingTimeout) {
      log.warn(`Starting batch ${currentBatchNum} with limited time remaining (${Math.floor(preProcessTimeoutStatus.safeTimeRemaining / 1000)}s)`);
      log.warn('If timeout occurs, SQS will retry this batch (idempotent processing)');
    }

    const { brokenUrlsCache, workingUrlsCache } = await loadCache(auditId, {
      ...context,
      log,
    });
    log.info(`Loaded cache: ${brokenUrlsCache.length} broken, ${workingUrlsCache.length} working URLs`);

    log.info(`Processing batch ${currentBatchNum}...`);
    const batchResult = await detectBrokenLinksFromCrawlBatch({
      scrapeResultPaths,
      batchStartIndex,
      batchSize,
      initialBrokenUrls: brokenUrlsCache,
      initialWorkingUrls: workingUrlsCache,
    }, {
      ...context,
      log,
    });

    const postProcessTimeoutStatus = getTimeoutStatus(startTime);
    log.info(`Batch ${currentBatchNum} processing complete: ${batchResult.results.length} broken links, ${batchResult.pagesProcessed} pages`);
    log.info(`Time used: ${postProcessTimeoutStatus.percentUsed.toFixed(1)}% - proceeding to save results`);

    if (postProcessTimeoutStatus.isApproachingTimeout) {
      log.warn(`Limited time remaining (${Math.floor(postProcessTimeoutStatus.safeTimeRemaining / 1000)}s), but proceeding with save operations`);
      log.warn('S3 saves are fast and idempotent - if timeout occurs, retry will complete');
    }

    await saveBatchResults(
      auditId,
      currentBatchNum,
      batchResult.results,
      batchResult.pagesProcessed,
      {
        ...context,
        log,
      },
    );

    await updateCache(
      auditId,
      batchResult.brokenUrlsCache,
      batchResult.workingUrlsCache,
      {
        ...context,
        log,
      },
    );

    await markBatchCompleted(auditId, currentBatchNum, {
      ...context,
      log,
    });

    log.info(`Batch ${currentBatchNum} saved successfully`);

    if (batchResult.hasMorePages) {
      const remainingPages = batchResult.totalPages - batchResult.nextBatchStartIndex;
      log.info(`${remainingPages} pages remaining, sending continuation for batch ${currentBatchNum + 1}`);

      await sendContinuationWithRetry({
        auditId,
        nextBatchIndex: batchResult.nextBatchStartIndex,
        batchSize,
        site,
        audit,
        scrapeJobId,
        sqs,
        env,
        log,
      });

      const finalTimeoutStatus = getTimeoutStatus(startTime);
      log.info(`Batch ${currentBatchNum} complete. Time used: ${(finalTimeoutStatus.elapsed / 1000).toFixed(1)}s (${finalTimeoutStatus.percentUsed.toFixed(1)}%)`);
      return { status: 'batch-continuation' };
    }

    log.info(`All ${currentBatchNum + 1} batches complete, checking time for LinkChecker detection`);

    const postBatchTimeoutStatus = getTimeoutStatus(startTime);
    if (postBatchTimeoutStatus.safeTimeRemaining < minTimeNeeded) {
      log.warn(`Only ${Math.floor(postBatchTimeoutStatus.safeTimeRemaining / 1000)}s remaining after batch processing, deferring LinkChecker to fresh Lambda`);
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
      return { status: 'linkchecker-deferred' };
    }

    log.info(`All ${currentBatchNum + 1} batches complete, proceeding to finalization`);
    log.info(`${Math.floor(postBatchTimeoutStatus.safeTimeRemaining / 1000)}s remaining, proceeding to LinkChecker in current Lambda`);
    return fetchLinkCheckerLogsStep(context);
  }

  return {
    runCrawlDetectionBatch,
  };
}
