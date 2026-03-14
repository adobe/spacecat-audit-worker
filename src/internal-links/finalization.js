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

import { prependSchema, stripWWW } from '@adobe/spacecat-shared-utils';
import { createInternalLinksStepLogger } from './logging.js';
import { classifyStatusBucket, isLinkInaccessible } from './helpers.js';
import { isSharedInternalResource, isWithinAuditScope } from './subpath-filter.js';

function isOnAuditHost(url, baseURL) {
  try {
    const parsedUrl = new URL(prependSchema(url));
    const parsedBaseURL = new URL(prependSchema(baseURL));
    return stripWWW(parsedUrl.hostname) === stripWWW(parsedBaseURL.hostname)
      && parsedUrl.port === parsedBaseURL.port;
  } catch (error) {
    return false;
  }
}

function normalizeLinkCheckerValidity(validity) {
  return String(validity || 'UNKNOWN').trim().toUpperCase();
}

function disableEventLoopWait(context) {
  if (context && 'callbackWaitsForEmptyEventLoop' in context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }
}

export function createFinalizeCrawlDetection({
  auditType,
  createContextLogger,
  createConfigResolver,
  calculatePriority,
  mergeAndDeduplicate,
  loadFinalResults,
  cleanupBatchState,
  getTimeoutStatus,
  tryAcquireFinalizationLock,
  releaseFinalizationLock,
  updateAuditResult,
  opportunityAndSuggestionsStep,
  filterByStatusIfNeeded,
  filterByItemTypes,
}) {
  const REVALIDATION_BATCH_SIZE = 5;
  const MIN_REVALIDATION_TIME_MS = 2 * 60 * 1000;
  const MIN_SAFE_TIME_MID_REVALIDATION_MS = 60 * 1000;

  async function revalidateLinkCheckerResults(links, revalidationOpts) {
    const {
      lambdaStartTime: rvStartTime,
      context: rvContext,
      log: rvLog,
      siteId,
      auditId: rvAuditId,
    } = revalidationOpts;
    const validated = [];

    for (let i = 0; i < links.length; i += REVALIDATION_BATCH_SIZE) {
      const status = getTimeoutStatus(rvStartTime, rvContext);
      /* c8 ignore next 4 - Mid-loop timeout exit; tested via timed mock */
      if (status.safeTimeRemaining <= MIN_SAFE_TIME_MID_REVALIDATION_MS) {
        rvLog.warn(`LinkChecker re-validation stopping at ${i}/${links.length} due to timeout`);
        validated.push(...links.slice(i));
        return validated;
      }

      const batch = links.slice(i, i + REVALIDATION_BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.allSettled(
        batch.map(async (link) => {
          const validation = await isLinkInaccessible(link.urlTo, rvLog, siteId, rvAuditId);
          return { link, validation };
        }),
      );

      for (let j = 0; j < results.length; j += 1) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          if (result.value.validation.isBroken) {
            validated.push({
              ...result.value.link,
              httpStatus: result.value.validation.httpStatus ?? result.value.link.httpStatus,
              statusBucket: result.value.validation.statusBucket ?? result.value.link.statusBucket,
            });
          }
        } else {
          validated.push(batch[j]);
        }
      }
    }

    rvLog.info(`LinkChecker re-validation: ${links.length} -> ${validated.length} still broken`);
    return validated;
  }

  return async function finalizeCrawlDetection(
    context,
    { skipCrawlDetection = false },
    startTime = Date.now(),
  ) {
    disableEventLoopWait(context);
    const {
      log: baseLog, site, audit, dataAccess,
    } = context;
    const lambdaStartTime = context.lambdaStartTime ?? startTime;
    const config = createConfigResolver(site, context.env);
    const auditId = audit.getId();
    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType,
      siteId: site.getId(),
      auditId,
      step: 'finalize-crawl-detection',
    });
    const shouldCleanup = !skipCrawlDetection;
    const baseURL = typeof site.getBaseURL === 'function' ? site.getBaseURL() : '';
    let finalizationLockAcquired = false;
    let finalizationLockEtag = null;

    async function releaseHeldFinalizationLock() {
      if (!finalizationLockAcquired || !releaseFinalizationLock) {
        return;
      }
      await releaseFinalizationLock(auditId, finalizationLockEtag, {
        ...context,
        log,
      });
      finalizationLockAcquired = false;
      finalizationLockEtag = null;
    }

    const timeoutStatus = getTimeoutStatus(lambdaStartTime, context);
    log.info('====== Finalize: Merge and Generate Suggestions ======');
    log.info(`auditId: ${auditId}`);
    log.info(`Timeout status: ${timeoutStatus.percentUsed.toFixed(1)}% used, ${Math.floor(timeoutStatus.safeTimeRemaining / 1000)}s safe time remaining`);

    /* c8 ignore next 4 - Defensive timeout warning path depends on invocation timing */
    if (timeoutStatus.isApproachingTimeout) {
      log.warn('Limited time for finalization, but all batch data is saved - proceeding with merge');
      log.warn('If timeout occurs, SQS retry will complete finalization (all data persisted)');
    }

    const auditResult = audit.getAuditResult();
    if (auditResult?.internalLinksWorkflowCompletedAt) {
      log.info(`Audit already finalized at ${auditResult.internalLinksWorkflowCompletedAt}, skipping duplicate finalization`);
      return { status: 'already-finalized' };
    }

    if (tryAcquireFinalizationLock) {
      finalizationLockEtag = await tryAcquireFinalizationLock(auditId, { ...context, log });
      /* c8 ignore next 4 - Duplicate finalization guard; SQS at-least-once */
      if (!finalizationLockEtag) {
        throw new Error(`Finalization lock is already held for audit ${auditId}; retrying later`);
      }
      finalizationLockAcquired = true;
    }

    const rumLinks = auditResult.brokenInternalLinks ?? [];
    log.info(`RUM detection results: ${rumLinks.length} broken links`);

    const linkCheckerResults = context.linkCheckerResults ?? [];
    const { linkCheckerStatus, linkCheckerError } = context;
    log.info(`LinkChecker detection results: ${linkCheckerResults.length} broken links`);

    let finalLinks = rumLinks;
    let opportunityResult;

    try {
      if (!skipCrawlDetection) {
        const crawlLinks = await loadFinalResults(auditId, {
          ...context,
          log,
        }, lambdaStartTime);
        log.info(`Crawl detected ${crawlLinks.length} broken links`);

        /* c8 ignore start - defensive normalization defaults */
        let skippedLinkCheckerRows = 0;
        const linkCheckerLinks = linkCheckerResults
          .map((lc) => {
            const itemType = lc.itemType || 'link';
            const validity = normalizeLinkCheckerValidity(lc.validity);
            const httpStatus = Number.parseInt(lc.httpStatus, 10);
            const statusBucket = classifyStatusBucket(httpStatus);
            const isExplicitBrokenValidity = validity === 'INVALID';
            const hasBrokenStatus = Boolean(statusBucket);

            if (!lc.urlFrom || !lc.urlTo) {
              skippedLinkCheckerRows += 1;
              return null;
            }

            if (!hasBrokenStatus && !isExplicitBrokenValidity) {
              skippedLinkCheckerRows += 1;
              return null;
            }

            if (baseURL) {
              const targetInScope = isWithinAuditScope(lc.urlTo, baseURL)
                || isSharedInternalResource(lc.urlTo, baseURL, itemType);
              if (!(isOnAuditHost(lc.urlFrom, baseURL)
                && isOnAuditHost(lc.urlTo, baseURL)
                && isWithinAuditScope(lc.urlFrom, baseURL)
                && targetInScope)) {
                skippedLinkCheckerRows += 1;
                return null;
              }
            }

            return {
              urlFrom: lc.urlFrom,
              urlTo: lc.urlTo,
              anchorText: lc.anchorText || '[no text]',
              itemType,
              detectionSource: 'linkchecker',
              trafficDomain: 1,
              httpStatus: Number.isFinite(httpStatus) ? httpStatus : lc.httpStatus,
              statusBucket: statusBucket || 'masked_by_linkchecker',
              validity,
            };
          })
          .filter(Boolean);
        /* c8 ignore stop */

        log.info(`LinkChecker links transformed: ${linkCheckerLinks.length} broken links`);
        if (skippedLinkCheckerRows > 0) {
          log.info(`Skipped ${skippedLinkCheckerRows} LinkChecker rows without a broken signal or outside audit scope`);
        }

        const preValidationStatus = getTimeoutStatus(lambdaStartTime, context);
        let validatedLinkCheckerLinks;
        if (linkCheckerLinks.length > 0
          && preValidationStatus.safeTimeRemaining > MIN_REVALIDATION_TIME_MS) {
          validatedLinkCheckerLinks = await revalidateLinkCheckerResults(
            linkCheckerLinks,
            {
              lambdaStartTime, context, log, siteId: site.getId(), auditId,
            },
          );
        } else {
          validatedLinkCheckerLinks = linkCheckerLinks;
          /* c8 ignore next 3 - Defensive timeout guard for LinkChecker re-validation */
          if (linkCheckerLinks.length > 0) {
            log.warn('Insufficient time for LinkChecker re-validation, using results as-is');
          }
        }

        const validatedLinks = validatedLinkCheckerLinks;
        const crawlAndLinkCheckerMerged = mergeAndDeduplicate(crawlLinks, validatedLinks, log);
        log.info(`After crawl+LinkChecker merge: ${crawlAndLinkCheckerMerged.length} unique broken links`);

        finalLinks = mergeAndDeduplicate(crawlAndLinkCheckerMerged, rumLinks, log);
        log.info(`After 3-way merge (crawl+linkchecker+RUM): ${finalLinks.length} unique broken links`);
      } else {
        log.info('No crawl results to merge, using RUM-only results');
      }

      const beforeStatusFilter = finalLinks.length;
      finalLinks = filterByStatusIfNeeded(finalLinks, config.getIncludedStatusBuckets());
      if (finalLinks.length < beforeStatusFilter) {
        log.info(`Filtered out ${beforeStatusFilter - finalLinks.length} links due to status bucket filtering`);
      }

      const beforeItemTypeFilter = finalLinks.length;
      finalLinks = filterByItemTypes(finalLinks, config.getIncludedItemTypes());
      if (finalLinks.length < beforeItemTypeFilter) {
        log.info(`Filtered out ${beforeItemTypeFilter - finalLinks.length} links due to itemType filtering`);
      }

      const prioritizedLinks = calculatePriority(finalLinks);
      const highPriority = prioritizedLinks.filter((link) => link.priority === 'high').length;
      const mediumPriority = prioritizedLinks.filter((link) => link.priority === 'medium').length;
      const lowPriority = prioritizedLinks.filter((link) => link.priority === 'low').length;
      log.info(`Priority: ${highPriority} high, ${mediumPriority} medium, ${lowPriority} low`);

      const updatedAuditResult = {
        ...auditResult,
        brokenInternalLinks: prioritizedLinks,
      };

      log.info('=====================================================');

      opportunityResult = await opportunityAndSuggestionsStep({
        ...context,
        log: baseLog,
        updatedAuditResult,
      });

      const completedReportedLinks = opportunityResult?.reportedBrokenLinks
        || updatedAuditResult.brokenInternalLinks;
      await updateAuditResult(
        audit,
        updatedAuditResult,
        completedReportedLinks,
        dataAccess,
        log,
        site.getId(),
        {
          internalLinksWorkflowCompletedAt: new Date().toISOString(),
          ...(linkCheckerStatus ? {
            internalLinksLinkCheckerStatus: linkCheckerStatus,
          } : {}),
          ...(linkCheckerError ? {
            internalLinksLinkCheckerError: linkCheckerError,
          } : {}),
        },
      );

      if (shouldCleanup) {
        await cleanupBatchState(auditId, {
          ...context,
          log,
        }).catch((err) => log.warn(`Cleanup failed: ${err.message}`));
      }

      await releaseHeldFinalizationLock();

      return opportunityResult;
    } catch (error) {
      if (shouldCleanup) {
        log.warn('Preserving batch state because finalization failed before successful completion');
      }
      if (finalizationLockAcquired) {
        await releaseHeldFinalizationLock();
      }
      throw error;
    }
  };
}
