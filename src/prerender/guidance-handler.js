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

import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { Suggestion } from '@adobe/spacecat-shared-data-access';
import { isPaidLLMOCustomer } from './utils/utils.js';
import { warnOnInvalidSuggestionData } from '../utils/data-access.js';
import { getS3Path } from './utils/scrape-utils.js';
import { MYSTIQUE_BATCH_SIZE } from './utils/constants.js';

const LOG_PREFIX = 'Prerender -';

/**
 * Downloads JSON data from a presigned URL
 * @param {string} presignedUrl - The presigned S3 URL
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} - The parsed JSON data
 * @throws {Error} - If download fails or response is not OK
 */
async function downloadFromPresignedUrl(presignedUrl, log) {
  const response = await fetch(presignedUrl);

  if (!response.ok) {
    const errorMsg = `Failed to download from presigned URL: ${response.status} ${response.statusText}`;
    log.error(`${LOG_PREFIX} ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const data = await response.json();

  if (!data || !data.suggestions) {
    const errorMsg = 'Downloaded data is missing required suggestions array';
    log.error(`${LOG_PREFIX} ${errorMsg}`);
    throw new Error(errorMsg);
  }

  return data;
}

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

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Opportunity, Suggestion: SuggestionDA,
  } = dataAccess;
  const { siteId, data } = message;

  log.info(`${LOG_PREFIX} Received Mystique guidance for prerender (presigned URL): ${JSON.stringify(
    message,
    null,
    2,
  )}`);

  // Validate message structure early - fail fast
  if (!data) {
    const msg = `${LOG_PREFIX} Missing data in Mystique response for siteId=${siteId}`;
    log.error(msg);
    return badRequest(msg);
  }

  // Extract from SQS message data
  const { presignedUrl, opportunityId } = data;

  // Validate required fields
  if (!presignedUrl) {
    const msg = `${LOG_PREFIX} Missing presignedUrl in Mystique response for siteId=${siteId}`;
    log.error(msg);
    return badRequest(msg);
  }

  if (!opportunityId) {
    const msg = `${LOG_PREFIX} Missing opportunityId in Mystique response for siteId=${siteId}`;
    log.error(msg);
    return badRequest(msg);
  }

  log.info(`${LOG_PREFIX} Downloading AI summaries from presigned URL for siteId=${siteId}, opportunityId=${opportunityId}`);

  try {
    // Download AI summaries from presigned URL (throws on error)
    const aiSummariesData = await downloadFromPresignedUrl(presignedUrl, log);

    const { suggestions } = aiSummariesData;
    log.info(`${LOG_PREFIX} Successfully loaded ${suggestions.length} suggestions from presigned URL for opportunityId=${opportunityId}`);

    // Validate site exists
    const site = await Site.findById(siteId);
    if (!site) {
      log.error(`${LOG_PREFIX} Site not found for siteId: ${siteId}`);
      return notFound('Site not found');
    }

    // Look up the existing prerender opportunity by ID
    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      const msg = `${LOG_PREFIX} Opportunity not found for opportunityId=${opportunityId}, siteId=${siteId}`;
      log.error(msg);
      return notFound('Opportunity not found');
    }

    // Load existing suggestions for this opportunity
    const existingSuggestions = await opportunity.getSuggestions();
    if (!existingSuggestions || existingSuggestions.length === 0) {
      log.debug(`${LOG_PREFIX} No existing suggestions found for opportunityId=${opportunityId}, siteId=${siteId}`);
      return ok();
    }

    // Filter out OUTDATED suggestions (stale data from previous audit runs)
    const updateableSuggestions = existingSuggestions.filter((s) => {
      const status = s.getStatus?.();
      return status !== 'OUTDATED';
    });

    if (updateableSuggestions.length === 0) {
      log.info(`${LOG_PREFIX} No updateable suggestions found (all are OUTDATED) for opportunityId=${opportunityId}, siteId=${siteId}`);
      return ok();
    }

    log.info(`${LOG_PREFIX} Found ${updateableSuggestions.length}/${existingSuggestions.length} updateable suggestions (excluding OUTDATED) for opportunityId=${opportunityId}`);

    // Index updateable suggestions by URL for quick lookup
    const suggestionsByUrl = new Map();
    updateableSuggestions.forEach((s) => {
      const dataObj = s.getData();
      if (dataObj?.url) {
        suggestionsByUrl.set(dataObj.url, s);
      }
    });

    // Prepare updates for all suggestions
    const suggestionsToSave = [];

    // Track valuable suggestion metrics for quality logging
    let valuableCount = 0;
    let validAiSummaryCount = 0;

    suggestions.forEach((incoming) => {
      // Handle potential null/undefined elements in suggestions array
      const {
        url, aiSummary, valuable,
      } = incoming || {};

      if (!url) {
        log.warn(`${LOG_PREFIX} Skipping Mystique suggestion without URL: ${JSON.stringify(
          incoming,
        )}`);
        return;
      }

      const existing = suggestionsByUrl.get(url);
      if (!existing) {
        log.warn(`${LOG_PREFIX} No existing suggestion found for URL=${url} on opportunityId=${opportunityId}`);
        return;
      }

      const currentData = existing.getData() || {};

      // Track if AI summary is meaningful
      const hasValidAiSummary = aiSummary && aiSummary.toLowerCase() !== 'not available';
      const isValuable = typeof valuable === 'boolean' ? valuable : true;

      if (hasValidAiSummary) {
        validAiSummaryCount += 1;
        if (isValuable) {
          valuableCount += 1;
        }
      }

      const updatedData = {
        ...currentData,
        // Use new summary if valid; otherwise preserve existing (don't overwrite with empty)
        aiSummary: hasValidAiSummary ? aiSummary : (currentData.aiSummary ?? ''),
        // Keep valuable in sync with aiSummary — only update when new AI response is valid
        valuable: hasValidAiSummary ? isValuable : (currentData.valuable ?? true),
      };

      warnOnInvalidSuggestionData(updatedData, opportunity.getType(), log);
      existing.setData(updatedData);
      suggestionsToSave.push(existing);
    });

    // 9. Batch save all suggestions using DynamoDB batch write
    if (suggestionsToSave.length > 0) {
      try {
        await SuggestionDA.saveMany(suggestionsToSave);

        // Check if this is a paid LLMO customer for quality tracking
        const isPaid = await isPaidLLMOCustomer(context);

        // Log comprehensive quality metrics with paid customer flag
        log.info(`${LOG_PREFIX} prerender_ai_summary_metrics:
          siteId=${siteId},
          baseUrl=${site.getBaseURL()},
          opportunityId=${opportunityId},
          isPaidLLMOCustomer=${isPaid},
          totalSuggestions=${suggestionsToSave.length},
          valuableSuggestions=${valuableCount},
          validAiSummaryCount=${validAiSummaryCount},`);
      } catch (error) {
        log.error(`${LOG_PREFIX} Error batch saving suggestions: ${error.message}`);
        throw error;
      }
    } else {
      log.warn(`${LOG_PREFIX} No valid suggestions to update for opportunityId=${opportunityId}, siteId=${siteId}`);
    }

    return ok();
  } catch (error) {
    log.error(`${LOG_PREFIX} Error processing guidance for opportunityId=${opportunityId}, siteId=${siteId}: ${error.message}`, error);
    return badRequest(`Failed to process guidance: ${error.message}`);
  }
}
