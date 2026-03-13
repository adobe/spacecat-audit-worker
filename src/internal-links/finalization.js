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

import { createInternalLinksStepLogger } from './logging.js';

export function createFinalizeCrawlDetection({
  auditType,
  createContextLogger,
  createConfigResolver,
  calculatePriority,
  mergeAndDeduplicate,
  loadFinalResults,
  cleanupBatchState,
  getTimeoutStatus,
  updateAuditResult,
  opportunityAndSuggestionsStep,
  filterByStatusIfNeeded,
  filterByItemTypes,
}) {
  return async function finalizeCrawlDetection(
    context,
    { skipCrawlDetection = false },
    startTime = Date.now(),
  ) {
    const {
      log: baseLog, site, audit, dataAccess,
    } = context;
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

    const timeoutStatus = getTimeoutStatus(startTime);
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
    const rumLinks = auditResult.brokenInternalLinks ?? [];
    log.info(`RUM detection results: ${rumLinks.length} broken links`);

    const linkCheckerResults = context.linkCheckerResults ?? [];
    log.info(`LinkChecker detection results: ${linkCheckerResults.length} broken links`);

    let finalLinks = rumLinks;

    try {
      if (!skipCrawlDetection) {
        const crawlLinks = await loadFinalResults(auditId, {
          ...context,
          log,
        }, startTime);
        log.info(`Crawl detected ${crawlLinks.length} broken links`);

        /* c8 ignore start - defensive normalization defaults */
        const linkCheckerLinks = linkCheckerResults.map((lc) => ({
          urlFrom: lc.urlFrom,
          urlTo: lc.urlTo,
          anchorText: lc.anchorText || '[no text]',
          itemType: lc.itemType || 'link',
          detectionSource: 'linkchecker',
          trafficDomain: 0,
          httpStatus: lc.httpStatus,
          statusBucket: 'masked_by_linkchecker',
        })).filter((link) => link.urlFrom && link.urlTo);
        /* c8 ignore stop */

        log.info(`LinkChecker links transformed: ${linkCheckerLinks.length} broken links`);

        const crawlAndLinkCheckerMerged = mergeAndDeduplicate(crawlLinks, linkCheckerLinks, log);
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

      const updatedAuditResult = await updateAuditResult(
        audit,
        auditResult,
        prioritizedLinks,
        dataAccess,
        log,
        site.getId(),
      );

      log.info('=====================================================');

      const opportunityResult = await opportunityAndSuggestionsStep({
        ...context,
        log: baseLog,
        updatedAuditResult,
      });

      const completionBaseResult = audit.getAuditResult?.() || updatedAuditResult;
      const completedReportedLinks = completionBaseResult.brokenInternalLinks
        || updatedAuditResult.brokenInternalLinks;
      await updateAuditResult(
        audit,
        {
          ...completionBaseResult,
          internalLinksWorkflowCompletedAt: new Date().toISOString(),
        },
        completedReportedLinks,
        dataAccess,
        log,
        site.getId(),
      );

      return opportunityResult;
    } finally {
      if (shouldCleanup) {
        await cleanupBatchState(auditId, {
          ...context,
          log,
        }).catch((err) => log.warn(`Cleanup failed: ${err.message}`));
      }
    }
  };
}
