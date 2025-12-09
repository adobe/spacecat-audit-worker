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

import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import {
  DYNAMIC_MEDIA_PATTERNS,
  IMAGE_FORMATS,
  AVIF_COMPRESSION_RATIO,
  IMAGE_OPTIMIZATION_GUIDANCE_TYPE,
  IMAGE_OPTIMIZATION_OBSERVATION,
  ANALYZER_BATCH_SIZE,
} from './constants.js';

const AUDIT_TYPE = 'image-optimization';

/**
 * Checks if an image URL uses Adobe Dynamic Media.
 * Follows Single Responsibility Principle - only checks Dynamic Media detection.
 *
 * @param {string} imageUrl - The image URL to check
 * @returns {boolean} True if Dynamic Media is detected
 */
export function isDynamicMedia(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return false;
  }
  return DYNAMIC_MEDIA_PATTERNS.some((pattern) => pattern.test(imageUrl));
}

/**
 * Determines image format from URL or response headers.
 * Priority: content-type header, then URL extension/parameters.
 *
 * @param {string} imageUrl - The image URL
 * @param {Object} headers - Optional response headers
 * @returns {string} Image format (avif, webp, jpeg, png, gif, or 'unknown')
 */
export function getImageFormat(imageUrl, headers = {}) {
  const contentType = headers['content-type'] || '';
  const urlLower = imageUrl.toLowerCase();

  // Check content-type header first (more reliable)
  if (contentType.includes('avif')) return IMAGE_FORMATS.AVIF;
  if (contentType.includes('webp')) return IMAGE_FORMATS.WEBP;
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return IMAGE_FORMATS.JPEG;
  if (contentType.includes('png')) return IMAGE_FORMATS.PNG;
  if (contentType.includes('gif')) return IMAGE_FORMATS.GIF;

  // Fallback to URL-based detection
  if (urlLower.includes('.avif') || urlLower.includes('fmt=avif')) return IMAGE_FORMATS.AVIF;
  if (urlLower.includes('.webp') || urlLower.includes('fmt=webp')) return IMAGE_FORMATS.WEBP;
  if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) return IMAGE_FORMATS.JPEG;
  if (urlLower.includes('.png')) return IMAGE_FORMATS.PNG;
  if (urlLower.includes('.gif')) return IMAGE_FORMATS.GIF;

  return 'unknown';
}

/**
 * Calculates potential file size savings when converting to AVIF format.
 * Uses industry-standard compression ratios.
 *
 * @param {number} currentSize - Current file size in bytes
 * @param {string} currentFormat - Current image format
 * @returns {Object} Object with potentialSavingsBytes, potentialSavingsPercent, and newSize
 */
export function calculateSavings(currentSize, currentFormat) {
  // No savings if already in AVIF format
  if (currentFormat === IMAGE_FORMATS.AVIF) {
    return {
      potentialSavingsBytes: 0,
      potentialSavingsPercent: 0,
      newSize: currentSize,
    };
  }

  const projectedSize = Math.round(currentSize * AVIF_COMPRESSION_RATIO);
  const savings = currentSize - projectedSize;
  const savingsPercent = Math.round((savings / currentSize) * 100);

  return {
    potentialSavingsBytes: savings,
    potentialSavingsPercent: savingsPercent,
    newSize: projectedSize,
  };
}

/**
 * Splits an array into smaller chunks of specified size.
 * Utility function for batch processing.
 *
 * @param {Array} array - Array to chunk
 * @param {number} chunkSize - Size of each chunk
 * @returns {Array} Array of chunks
 */
export const chunkArray = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

/**
 * Sends image optimization analysis request to external analyzer service.
 * Follows separation of concerns - handles only message sending logic.
 *
 * @param {string} auditUrl - The base URL being audited
 * @param {Array} pageUrls - Array of page URLs to analyze for images
 * @param {string} siteId - Site identifier
 * @param {string} auditId - Audit identifier
 * @param {Object} context - Context object containing sqs, env, log, dataAccess
 * @returns {Promise<void>}
 */
export async function sendImageOptimizationToAnalyzer(
  auditUrl,
  pageUrls,
  siteId,
  auditId,
  context,
) {
  const {
    sqs, env, log, dataAccess,
  } = context;

  try {
    const site = await dataAccess.Site.findById(siteId);
    const urlBatches = chunkArray(pageUrls, ANALYZER_BATCH_SIZE);

    log.debug(`[${AUDIT_TYPE}]: Sending ${pageUrls.length} URLs to analyzer in ${urlBatches.length} batch(es)`);

    // Send each batch as a separate message to avoid payload size limits
    for (let i = 0; i < urlBatches.length; i += 1) {
      const batch = urlBatches[i];

      const analyzerMessage = {
        type: IMAGE_OPTIMIZATION_GUIDANCE_TYPE,
        siteId,
        auditId,
        deliveryType: site.getDeliveryType(),
        time: new Date().toISOString(),
        url: auditUrl,
        observation: IMAGE_OPTIMIZATION_OBSERVATION,
        data: {
          pageUrls: batch,
          analysisType: 'image-optimization',
          checkDynamicMedia: true,
          checkAvif: true,
        },
      };

      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, analyzerMessage);
      log.debug(`[${AUDIT_TYPE}]: Batch ${i + 1}/${urlBatches.length} sent with ${batch.length} URLs`);
    }

    log.debug(`[${AUDIT_TYPE}]: All ${urlBatches.length} batches sent to analyzer successfully`);
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Failed to send to analyzer: ${error.message}`);
    throw error;
  }
}

/**
 * Adds new image optimization suggestions to an opportunity.
 * Handles error reporting and partial success scenarios.
 *
 * @param {Object} params - Parameters object
 * @param {Object} params.opportunity - The opportunity object to add suggestions to
 * @param {Array} params.newSuggestionDTOs - Array of new suggestion DTOs to add
 * @param {Object} params.log - Logger object
 * @returns {Promise<void>}
 */
export async function addImageOptimizationSuggestions({ opportunity, newSuggestionDTOs, log }) {
  if (!isNonEmptyArray(newSuggestionDTOs)) {
    log.debug(`[${AUDIT_TYPE}]: No new suggestions to add`);
    return;
  }

  const updateResult = await opportunity.addSuggestions(newSuggestionDTOs);

  // Handle partial failures - log errors but don't fail if some succeeded
  if (isNonEmptyArray(updateResult.errorItems)) {
    log.error(`[${AUDIT_TYPE}]: Suggestions for siteId ${opportunity.getSiteId()} contains ${updateResult.errorItems.length} items with errors`);
    updateResult.errorItems.forEach((errorItem) => {
      log.error(`[${AUDIT_TYPE}]: Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
    });

    // Only throw if ALL items failed
    if (!isNonEmptyArray(updateResult.createdItems)) {
      throw new Error(`[${AUDIT_TYPE}]: Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
    }
  }

  log.debug(`[${AUDIT_TYPE}]: Added ${newSuggestionDTOs.length} new suggestions`);
}

/**
 * Removes all OUTDATED suggestions for an opportunity.
 * Keeps the opportunity data clean by removing stale suggestions.
 *
 * @param {Object} opportunity - The opportunity object
 * @param {Object} log - Logger object
 * @returns {Promise<void>}
 */
export async function cleanupOutdatedSuggestions(opportunity, log) {
  try {
    const allSuggestions = await opportunity.getSuggestions();
    const outdatedSuggestions = allSuggestions.filter(
      (suggestion) => suggestion.getStatus() === SuggestionModel.STATUSES.OUTDATED,
    );

    if (outdatedSuggestions.length > 0) {
      await Promise.all(outdatedSuggestions.map((suggestion) => suggestion.remove()));
      log.debug(`[${AUDIT_TYPE}]: Cleaned up ${outdatedSuggestions.length} OUTDATED suggestions`);
    } else {
      log.debug(`[${AUDIT_TYPE}]: No OUTDATED suggestions to clean up`);
    }
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Failed to cleanup OUTDATED suggestions: ${error.message}`);
  }
}
