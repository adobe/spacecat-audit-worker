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

import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { isPaidLLMOCustomer, normalizePathnameWithQuery } from './utils/utils.js';
import { MYSTIQUE_SESSION_TTL_MINUTES } from './utils/constants.js';
import { warnOnInvalidSuggestionData } from '../utils/data-access.js';
import { fetchAnalysisFromPresignedUrl } from '../utils/analysis-fetch.js';
import { postMessageOptional } from '../utils/slack-utils.js';

const LOG_PREFIX = 'Prerender -';

/**
 * Downloads JSON data from a presigned URL using the shared analysis-fetch helper
 * (SSRF guard, size cap, log scrub of query-string credentials).
 *
 * @param {string} presignedUrl - The presigned S3 URL
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} - The parsed JSON data
 * @throws {Error} - If the URL is not allowlisted, fetch fails, response is too
 *   large, or the body is missing the required `suggestions` array.
 */
async function downloadFromPresignedUrl(presignedUrl, log) {
  const data = await fetchAnalysisFromPresignedUrl(presignedUrl, {
    log,
    prefix: LOG_PREFIX,
  });

  if (!data || !data.suggestions) {
    const errorMsg = 'Downloaded data is missing required suggestions array';
    log.error(`${LOG_PREFIX} ${errorMsg}`);
    throw new Error(errorMsg);
  }

  return data;
}

/**
 * Reads the full batch list from S3 for a multi-batch Mystique run.
 *
 * @param {Object} s3Client - AWS S3 client
 * @param {string} bucketName - S3 bucket name
 * @param {string} key - S3 object key for the batch file
 * @param {Object} log - Logger instance
 * @returns {Promise<Array[]>} - Array of batches (each batch is an array of suggestion payloads)
 */
async function readBatchesFromS3(s3Client, bucketName, key, log) {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  const body = await response.Body.transformToString();
  const batches = JSON.parse(body);
  log.info(`${LOG_PREFIX} Read ${batches.length} batches from S3 key=${key}`);
  return batches;
}

/**
 * Deletes the batch list file from S3 after all batches are complete.
 *
 * @param {Object} s3Client - AWS S3 client
 * @param {string} bucketName - S3 bucket name
 * @param {string} key - S3 object key to delete
 * @param {Object} log - Logger instance
 */
async function deleteBatchesFromS3(s3Client, bucketName, key, log) {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    log.info(`${LOG_PREFIX} Deleted S3 batch file key=${key}`);
  } catch (error) {
    log.warn(`${LOG_PREFIX} Failed to delete S3 batch file key=${key}: ${error.message}`);
  }
}

/**
 * Chains the next Mystique batch after the current one completes.
 * Reads session state from the opportunity, sends the next SQS message,
 * updates the session cursor, and posts Slack notifications.
 * Cleans up S3 + session when the last batch finishes.
 *
 * @param {Object} opportunity - The Opportunity model instance
 * @param {string} siteId - Site ID
 * @param {string} auditId - Audit ID
 * @param {string} baseUrl - Site base URL
 * @param {string} deliveryType - Site delivery type
 * @param {Object} context - Lambda context with sqs, env, s3Client, log
 */
async function chainNextMystiqueBatch(
  opportunity,
  siteId,
  auditId,
  baseUrl,
  deliveryType,
  context,
) {
  const {
    sqs, env, s3Client, log,
  } = context;

  const oppData = opportunity.getData() ?? {};
  const session = oppData.mystiqueSession;

  if (!session) {
    return; // Single-batch run — nothing to chain
  }

  const {
    totalBatches,
    currentBatchIndex,
    batchesS3Key,
    slackChannelId,
    slackThreadTs,
    startedAt,
  } = session;

  // TTL guard: abandon the chain if the session is older than the configured limit.
  if (startedAt) {
    const ageMinutes = (Date.now() - new Date(startedAt).getTime()) / 60_000;
    if (ageMinutes > MYSTIQUE_SESSION_TTL_MINUTES) {
      log.warn(`${LOG_PREFIX} Mystique batch session expired after ${Math.round(ageMinutes)}m `
        + `(TTL=${MYSTIQUE_SESSION_TTL_MINUTES}m). Cleaning up. opportunityId=${opportunity.getId()}, siteId=${siteId}`);

      await deleteBatchesFromS3(s3Client, env.S3_SCRAPER_BUCKET_NAME, batchesS3Key, log);
      opportunity.setData({ ...oppData, mystiqueSession: undefined });
      await opportunity.save();

      await postMessageOptional(
        context,
        slackChannelId,
        `:warning: Mystique batch session expired after ${Math.round(ageMinutes)}m — abandoned at batch ${currentBatchIndex + 1}/${totalBatches}`,
        { threadTs: slackThreadTs },
      );
      return;
    }
  }

  const completedBatch = currentBatchIndex + 1;

  await postMessageOptional(
    context,
    slackChannelId,
    `:white_check_mark: Batch ${completedBatch}/${totalBatches} complete`,
    { threadTs: slackThreadTs },
  );

  if (currentBatchIndex < totalBatches - 1) {
    const nextIndex = currentBatchIndex + 1;
    const allBatches = await readBatchesFromS3(
      s3Client,
      env.S3_SCRAPER_BUCKET_NAME,
      batchesS3Key,
      log,
    );
    const nextBatch = allBatches[nextIndex];

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, {
      type: 'guidance:prerender',
      url: baseUrl,
      siteId,
      auditId,
      deliveryType,
      time: new Date().toISOString(),
      data: {
        opportunityId: opportunity.getId(),
        suggestions: nextBatch,
        batchIndex: nextIndex,
        totalBatches,
      },
    });

    opportunity.setData({
      ...oppData,
      mystiqueSession: {
        ...session,
        currentBatchIndex: nextIndex,
        startedAt: new Date().toISOString(),
      },
    });
    await opportunity.save();

    await postMessageOptional(
      context,
      slackChannelId,
      `:adobe-run: Sending batch ${nextIndex + 1}/${totalBatches} to Mystique (${nextBatch.length} URLs)`,
      { threadTs: slackThreadTs },
    );

    log.info(`${LOG_PREFIX} Chained batch ${nextIndex + 1}/${totalBatches} to Mystique for `
      + `opportunityId=${opportunity.getId()}, siteId=${siteId}, suggestions=${nextBatch.length}`);
  } else {
    // All batches done — clean up
    await deleteBatchesFromS3(s3Client, env.S3_SCRAPER_BUCKET_NAME, batchesS3Key, log);

    opportunity.setData({ ...oppData, mystiqueSession: undefined });
    await opportunity.save();

    await postMessageOptional(
      context,
      slackChannelId,
      `:white_check_mark: All ${totalBatches} batches complete for *${baseUrl}*`,
      { threadTs: slackThreadTs },
    );

    log.info(`${LOG_PREFIX} All ${totalBatches} Mystique batches complete for `
      + `opportunityId=${opportunity.getId()}, siteId=${siteId}`);
  }
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Opportunity, Suggestion,
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

    // Index updateable suggestions by pathname for domain-shift-safe lookup.
    // When the preferred base URL changes (e.g. www.example.com → example.com),
    // Mystique responses may use the new domain while stored suggestions still
    // carry the old domain — keying by pathname ensures they still match.
    const suggestionsByPathname = new Map();
    updateableSuggestions.forEach((s) => {
      const dataObj = s.getData();
      if (dataObj?.url) {
        suggestionsByPathname.set(normalizePathnameWithQuery(dataObj.url), s);
      }
    });

    // Prepare updates for all suggestions
    const suggestionsToSave = [];

    // Track valuable suggestion metrics for quality logging
    let valuableCount = 0;
    let validAiSummaryCount = 0;
    let suggestionsWithPrompts = 0;
    let totalPromptCount = 0;

    suggestions.forEach((incoming) => {
      // Handle potential null/undefined elements in suggestions array
      const {
        url, aiSummary, valuable, prompts,
      } = incoming || {};

      if (!url) {
        log.warn(`${LOG_PREFIX} Skipping Mystique suggestion without URL: ${JSON.stringify(
          incoming,
        )}`);
        return;
      }

      const existing = suggestionsByPathname.get(normalizePathnameWithQuery(url));
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

      const hasNewPrompts = Array.isArray(prompts) && prompts.length > 0;
      if (hasNewPrompts) {
        suggestionsWithPrompts += 1;
        totalPromptCount += prompts.length;
      }

      const updatedData = {
        ...currentData,
        // Use new summary if valid; otherwise preserve existing (don't overwrite with empty)
        aiSummary: hasValidAiSummary ? aiSummary : (currentData.aiSummary ?? ''),
        // Use new prompts if provided; otherwise preserve existing
        prompts: hasNewPrompts ? prompts : (currentData.prompts ?? []),
        // Keep valuable in sync with aiSummary — only update when new AI response is valid
        valuable: hasValidAiSummary ? isValuable : (currentData.valuable ?? true),
      };

      warnOnInvalidSuggestionData(updatedData, opportunity.getType(), log);
      existing.setData(updatedData);
      suggestionsToSave.push(existing);
    });

    // Deduplicate by suggestion ID to prevent ON CONFLICT errors when the same
    // suggestion object was matched more than once (e.g. incoming URLs that
    // normalise to the same key).
    const seenIds = new Set();
    const uniqueSuggestionsToSave = suggestionsToSave.filter((s) => {
      const id = s.getId();
      if (seenIds.has(id)) {
        return false;
      }
      seenIds.add(id);
      return true;
    });

    if (uniqueSuggestionsToSave.length > 0) {
      try {
        await Suggestion.saveMany(uniqueSuggestionsToSave);

        // Check if this is a paid LLMO customer for quality tracking
        const isPaid = await isPaidLLMOCustomer(context);

        // Log comprehensive quality metrics with paid customer flag
        log.info(`${LOG_PREFIX} prerender_ai_summary_metrics:
          siteId=${siteId},
          baseUrl=${site.getBaseURL()},
          opportunityId=${opportunityId},
          isPaidLLMOCustomer=${isPaid},
          totalSuggestions=${uniqueSuggestionsToSave.length},
          valuableSuggestions=${valuableCount},
          validAiSummaryCount=${validAiSummaryCount},
          suggestionsWithPrompts=${suggestionsWithPrompts},
          totalPromptCount=${totalPromptCount},`);
      } catch (error) {
        log.error(`${LOG_PREFIX} Error batch saving suggestions: ${error.message}`);
        throw error;
      }
    } else {
      log.warn(`${LOG_PREFIX} No valid suggestions to update for opportunityId=${opportunityId}, siteId=${siteId}`);
    }

    // Chain the next Mystique batch if this is a multi-batch run.
    // Reads session state from the opportunity and sends the next SQS message.
    const auditId = message.auditId ?? null;
    const deliveryType = site.getDeliveryType?.() ?? 'unknown';
    await chainNextMystiqueBatch(
      opportunity,
      siteId,
      auditId,
      site.getBaseURL(),
      deliveryType,
      context,
    );

    return ok();
  } catch (error) {
    log.error(`${LOG_PREFIX} Error processing guidance for opportunityId=${opportunityId}, siteId=${siteId}: ${error.message}`, error);
    return badRequest(`Failed to process guidance: ${error.message}`);
  }
}
