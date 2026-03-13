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

import { createFinalizeCrawlDetection } from './finalization.js';
import { createLinkCheckerOrchestration } from './linkchecker-orchestration.js';
import { createCrawlBatchOrchestration } from './crawl-batch-orchestration.js';

export function createInternalLinksOrchestration({
  auditType,
  pagesPerBatch,
  createContextLogger,
  createConfigResolver,
  calculatePriority,
  mergeAndDeduplicate,
  detectBrokenLinksFromCrawlBatch,
  saveBatchResults,
  updateCache,
  loadCache,
  markBatchCompleted,
  isBatchCompleted,
  loadFinalResults,
  cleanupBatchState,
  getTimeoutStatus,
  buildLinkCheckerQuery,
  submitSplunkJob,
  pollJobStatus,
  fetchJobResults,
  createSplunkClient,
  updateAuditResult,
  opportunityAndSuggestionsStep,
  filterByStatusIfNeeded,
  filterByItemTypes,
}) {
  const finalizeCrawlDetection = createFinalizeCrawlDetection({
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
  });

  const {
    fetchLinkCheckerLogsStep,
    resumeLinkCheckerPollingStep,
  } = createLinkCheckerOrchestration({
    auditType,
    createContextLogger,
    getTimeoutStatus,
    buildLinkCheckerQuery,
    submitSplunkJob,
    pollJobStatus,
    fetchJobResults,
    createSplunkClient,
    finalizeCrawlDetection,
  });

  const {
    runCrawlDetectionBatch,
  } = createCrawlBatchOrchestration({
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
  });

  return {
    finalizeCrawlDetection,
    fetchLinkCheckerLogsStep,
    resumeLinkCheckerPollingStep,
    runCrawlDetectionBatch,
  };
}
