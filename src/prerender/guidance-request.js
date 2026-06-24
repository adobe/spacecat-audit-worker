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

/**
 * Outbound Mystique guidance request (the request half of the prerender↔Mystique
 * "guidance" protocol; `guidance-handler.js` handles the inbound response).
 *
 * `sendPrerenderGuidanceRequestToMystique` is dispatch-only: given a ready list of suggestion
 * candidates it uploads them to S3 and enqueues a `guidance:prerender` SQS message carrying the
 * S3 key. Callers build the candidate list (normal flow in handler.js, ai-only in
 * ai-only-handler.js); this module does not derive or filter candidates.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { MYSTIQUE_SUGGESTIONS_S3_PREFIX } from './utils/constants.js';

const LOG_PREFIX = 'Prerender -';

/**
 * Uploads the candidate suggestions to S3 and enqueues a guidance:prerender message to Mystique.
 * @param {string} auditUrl - Audited URL (site base URL)
 * @param {Object} auditData - Audit data used to build the message (siteId, auditId)
 * @param {Object} opportunity - The prerender opportunity entity (used for the S3 key + guards)
 * @param {Object} context - Processing context (log, sqs, env, site, s3Client)
 * @param {Array} candidates - Pre-built candidate objects to send
 *   ({ suggestionId, url, originalHtmlMarkdownKey, markdownDiffKey, hasPrompts }).
 * @param {boolean} [generatePrompts] - Whether to generate RCV prompts for the suggestions.
 * @returns {Promise<number>} - Number of suggestions sent to Mystique
 */
export async function sendPrerenderGuidanceRequestToMystique(
  auditUrl,
  auditData,
  opportunity,
  context,
  candidates,
  generatePrompts = false,
) {
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

    if (!candidates || candidates.length === 0) {
      log.info(`${LOG_PREFIX} No eligible suggestions to send to Mystique for opportunityId=${opportunityId}. baseUrl=${baseUrl}, siteId=${siteId}`);
      return 0;
    }

    const deliveryType = site?.getDeliveryType?.() || 'unknown';

    // Upload all suggestions to S3 and send just the S3 key via SQS.
    // This avoids the 256 KB SQS message size limit — Mystique downloads from S3.
    const { s3Client } = context;
    const suggestionsS3Key = `${MYSTIQUE_SUGGESTIONS_S3_PREFIX}/${opportunityId}.json`;

    await s3Client.send(new PutObjectCommand({
      Bucket: env.S3_SCRAPER_BUCKET_NAME,
      Key: suggestionsS3Key,
      Body: JSON.stringify(candidates),
      ContentType: 'application/json',
    }));

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
        suggestionsS3Key,
        suggestionsS3Bucket: env.S3_SCRAPER_BUCKET_NAME,
        generatePrompts,
        siteRegion: site.getRegion() ?? '',
      },
    });

    log.info(`${LOG_PREFIX} Queued guidance:prerender message to Mystique for baseUrl=${baseUrl}, `
      + `siteId=${siteId}, opportunityId=${opportunityId}, suggestions=${candidates.length}, `
      + `suggestionsS3Key=${suggestionsS3Key}`);
    return candidates.length;
  /* c8 ignore start - S3/SQS dispatch failures are surfaced to the caller */
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send guidance:prerender message to Mystique for opportunityId=${opportunityId}, `
      + `baseUrl=${auditUrl}, siteId=${siteId}: ${error.message}`, error);
    throw error;
  }
  /* c8 ignore stop */
}
