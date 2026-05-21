/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { Suggestion } from '@adobe/spacecat-shared-data-access';
import { getS3Path } from './utils/utils.js';
import { MYSTIQUE_BATCH_SIZE } from './utils/constants.js';

const LOG_PREFIX = 'Prerender -';

/**
 * Sends a guidance:prerender message to Mystique with AI summary generation request
 * @param {string} auditUrl - Audited URL (site base URL)
 * @param {Object} auditData - Audit data used to build the message
 * @param {Object} opportunity - The prerender opportunity entity
 * @param {Object} context - Processing context
 * @param {Array|null} [preBuiltCandidates] - Pre-built candidate objects for normal audit runs.
 *   Each entry is { suggestionId, url, originalHtmlMarkdownKey, markdownDiffKey }.
 *   When null/omitted, candidates are derived from all DB suggestions (ai-only mode).
 * @returns {Promise<number>} - Number of suggestions sent to Mystique
 */
// eslint-disable-next-line max-len
export async function sendPrerenderGuidanceRequestToMystique(auditUrl, auditData, opportunity, context, preBuiltCandidates) {
  const {
    log, sqs, env, site,
  } = context;
  /* c8 ignore start - Defensive checks and destructuring, tested in ai-only mode tests */
  const {
    siteId,
    auditId,
  } = auditData || {};

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`${LOG_PREFIX} SQS or Mystique queue not configured, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }

  if (!opportunity || !opportunity.getId) {
    log.warn(`${LOG_PREFIX} Opportunity entity not available, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }
  /* c8 ignore stop */

  const opportunityId = opportunity.getId();

  try {
    const baseUrl = auditUrl;

    let suggestionsPayload;

    /* c8 ignore next 4 - Normal run path exercised via processContentAndGenerateOpportunities */
    if (preBuiltCandidates) {
      suggestionsPayload = preBuiltCandidates;
    } else {
      // ai-only mode: no URL list available, derive candidates from all DB suggestions.
      const existingSuggestions = await opportunity.getSuggestions();

      if (!existingSuggestions || existingSuggestions.length === 0) {
        log.debug(`${LOG_PREFIX} No existing suggestions found for opportunityId=${opportunityId}, skipping Mystique message. baseUrl=${baseUrl}, siteId=${siteId}`);
        return 0;
      }

      const candidates = [];

      existingSuggestions.forEach((s) => {
        const data = s.getData();

        // Skip domain-wide aggregate suggestion and anything without URL
        if (!data?.url || data?.isDomainWide) {
          return;
        }

        // Skip OUTDATED and SKIPPED suggestions (stale or user-dismissed)
        const status = s.getStatus();
        const isDeployedOrFixed = status === Suggestion.STATUSES.FIXED || !!data?.edgeDeployed;
        if (
          status === Suggestion.STATUSES.OUTDATED
          || status === Suggestion.STATUSES.SKIPPED
          || isDeployedOrFixed
        ) {
          return;
        }

        const suggestionId = s.getId();

        // Resolve the scrapeJobId in priority order:
        //   1. data.scrapeJobId — stamped at suggestion-creation time (most reliable)
        //   2. data.originalHtmlKey — extract the job segment from the stored S3 path
        //      (format: prerender/scrapes/{scrapeJobId}/...)
        //   3. Neither available → skip; we cannot build valid S3 keys without a job id
        let effectiveScrapeJobId = data.scrapeJobId;
        if (!effectiveScrapeJobId && data.originalHtmlKey) {
          // prerender/scrapes/{scrapeJobId}/...
          const parts = data.originalHtmlKey.split('/');
          effectiveScrapeJobId = parts[2] || null;
          if (effectiveScrapeJobId) {
            log.debug(`${LOG_PREFIX} Suggestion ${suggestionId} missing scrapeJobId; `
              + `derived from originalHtmlKey: ${effectiveScrapeJobId}. `
              + `baseUrl=${baseUrl}, siteId=${siteId}`);
          }
        }
        if (!effectiveScrapeJobId) {
          log.warn(`${LOG_PREFIX} Suggestion ${suggestionId} skipped: no scrapeJobId and no `
            + `originalHtmlKey to derive one from. baseUrl=${baseUrl}, siteId=${siteId}`);
          return;
        }

        candidates.push({
          suggestionId,
          url: data.url,
          originalHtmlMarkdownKey: getS3Path(data.url, effectiveScrapeJobId, 'server-side-html.md'),
          markdownDiffKey: getS3Path(data.url, effectiveScrapeJobId, 'markdown-diff.md'),
        });
      });

      suggestionsPayload = candidates;
    }

    if (suggestionsPayload.length === 0) {
      log.info(`${LOG_PREFIX} No eligible suggestions to send to Mystique for opportunityId=${opportunityId}. baseUrl=${baseUrl}, siteId=${siteId}`);
      return 0;
    }

    const deliveryType = site?.getDeliveryType?.() || 'unknown';

    // SQS has a 256 KB message size limit. Chunk suggestions into batches to stay safely under it.
    // TODO: send all batches once Mystique multi-batch handling is fully deployed.
    const firstBatch = suggestionsPayload.slice(0, MYSTIQUE_BATCH_SIZE);

    const time = new Date().toISOString();
    const queue = env.QUEUE_SPACECAT_TO_MYSTIQUE;
    await sqs.sendMessage(queue, {
      type: 'guidance:prerender',
      url: baseUrl,
      siteId,
      auditId,
      deliveryType,
      time,
      data: {
        opportunityId,
        suggestions: firstBatch,
        batchIndex: 0,
        totalBatches: 1,
      },
    });

    log.info(`${LOG_PREFIX} Queued guidance:prerender message to Mystique for baseUrl=${baseUrl}, `
      + `siteId=${siteId}, opportunityId=${opportunityId}, suggestions=${firstBatch.length} (capped to 1 batch of ${MYSTIQUE_BATCH_SIZE})`);
    return firstBatch.length;
  /* c8 ignore next 8 - Error handling for SQS failures when sending to Mystique,
   * difficult to test reliably */
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send guidance:prerender message to Mystique for opportunityId=${opportunityId}, `
      + `baseUrl=${auditUrl}, siteId=${siteId}: ${error.message}`, error);
    return 0;
  }
}
