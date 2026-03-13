/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit, Opportunity as Oppty, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/base-audit.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createAuditLogger, createContextLogger } from '../common/context-logger.js';
import { isUnscrapeable, filterBrokenSuggestedUrls } from '../utils/url-utils.js';
import { syncBrokenInternalLinksSuggestions } from './suggestions-generator.js';
import {
  isLinkInaccessible,
  calculatePriority,
  calculateKpiDeltasForAudit,
} from './helpers.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { filterByAuditScope, isWithinAuditScope, extractPathPrefix } from './subpath-filter.js';
import {
  detectBrokenLinksFromCrawlBatch,
  mergeAndDeduplicate,
  PAGES_PER_BATCH,
} from './crawl-detection.js';
import {
  saveBatchResults,
  updateCache,
  loadCache,
  markBatchCompleted,
  isBatchCompleted,
  loadFinalResults,
  cleanupBatchState,
  getTimeoutStatus,
} from './batch-state.js';
import {
  buildLinkCheckerQuery,
  submitSplunkJob,
  pollJobStatus,
  fetchJobResults,
} from './linkchecker-splunk.js';
import BrightDataClient, {
  buildLocaleSearchUrl,
  extractLocaleFromUrl,
  localesMatch,
} from '../support/bright-data-client.js';
import { sleep } from '../support/utils.js';
import { createSplunkClient } from '../support/splunk-client-loader.js';
import {
  MAX_BROKEN_LINKS_REPORTED,
  filterByStatusIfNeeded,
  filterByItemTypes,
  isCanonicalOrHreflangLink,
  createUpdateAuditResult,
} from './result-utils.js';
import { createInternalLinksRumSteps } from './rum-detection.js';
import { createSubmitForScraping } from './scrape-submission.js';
import { createOpportunityAndSuggestionsStep } from './opportunity-suggestions.js';
import { createInternalLinksOrchestration } from './orchestration.js';
import { createInternalLinksConfigResolver } from './config.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const INTERVAL = 30;
const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

export { MAX_BROKEN_LINKS_REPORTED };

export const updateAuditResult = createUpdateAuditResult({
  auditType: AUDIT_TYPE,
  createAuditLogger,
});

export const {
  internalLinksAuditRunner,
  runAuditAndImportTopPagesStep,
} = createInternalLinksRumSteps({
  auditType: AUDIT_TYPE,
  interval: INTERVAL,
  createContextLogger,
  createRUMAPIClient: (context) => RUMAPIClient.createFrom(context),
  resolveFinalUrl: wwwUrlResolver,
  isLinkInaccessible,
  calculatePriority,
  isWithinAuditScope,
});

export const submitForScraping = createSubmitForScraping({
  auditType: AUDIT_TYPE,
  createContextLogger,
  isWithinAuditScope,
  isUnscrapeable,
});

export const opportunityAndSuggestionsStep = createOpportunityAndSuggestionsStep({
  auditType: AUDIT_TYPE,
  opptyStatuses: Oppty.STATUSES,
  suggestionStatuses: SuggestionDataAccess.STATUSES,
  isNonEmptyArray,
  createContextLogger,
  calculateKpiDeltasForAudit,
  convertToOpportunity,
  createOpportunityData,
  syncBrokenInternalLinksSuggestions,
  filterByAuditScope,
  extractPathPrefix,
  isUnscrapeable,
  filterBrokenSuggestedUrls,
  BrightDataClient,
  buildLocaleSearchUrl,
  extractLocaleFromUrl,
  localesMatch,
  sleep,
  updateAuditResult,
  isCanonicalOrHreflangLink,
});

export const {
  finalizeCrawlDetection,
  fetchLinkCheckerLogsStep,
  resumeLinkCheckerPollingStep,
  runCrawlDetectionBatch,
} = createInternalLinksOrchestration({
  auditType: AUDIT_TYPE,
  pagesPerBatch: PAGES_PER_BATCH,
  createContextLogger,
  createConfigResolver: createInternalLinksConfigResolver,
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
});

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'runAuditAndImportTopPagesStep',
    runAuditAndImportTopPagesStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'submitForScraping',
    submitForScraping,
    AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT,
  )
  .addStep('runCrawlDetectionBatch', runCrawlDetectionBatch)
  .build();
