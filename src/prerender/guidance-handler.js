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
import { isPaidLLMOCustomer } from './utils/utils.js';

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

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Opportunity, Suggestion,
  } = dataAccess;
  const { siteId, data } = message;

  log.info(
    `${LOG_PREFIX} Received Mystique guidance for prerender (presigned URL): ${JSON.stringify(
      message,
      null,
      2,
    )}`,
  );

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
    log.info(
      `${LOG_PREFIX} Successfully loaded ${suggestions.length} suggestions from presigned URL for opportunityId=${opportunityId}`,
    );

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
      log.warn(
        `${LOG_PREFIX} No existing suggestions found for opportunityId=${opportunityId}, siteId=${siteId}`,
      );
      return ok();
    }

    // Filter out OUTDATED suggestions (stale data from previous audit runs)
    const updateableSuggestions = existingSuggestions.filter((s) => {
      const status = s.getStatus?.();
      return status !== 'OUTDATED';
    });

    if (updateableSuggestions.length === 0) {
      log.info(
        `${LOG_PREFIX} No updateable suggestions found (all are OUTDATED) for opportunityId=${opportunityId}, siteId=${siteId}`,
      );
      return ok();
    }

    log.info(
      `${LOG_PREFIX} Found ${updateableSuggestions.length}/${existingSuggestions.length} updateable suggestions (excluding OUTDATED) for opportunityId=${opportunityId}`,
    );

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
        log.warn(
          `${LOG_PREFIX} Skipping Mystique suggestion without URL: ${JSON.stringify(
            incoming,
          )}`,
        );
        return;
      }

      const existing = suggestionsByUrl.get(url);
      if (!existing) {
        log.warn(
          `${LOG_PREFIX} No existing suggestion found for URL=${url} on opportunityId=${opportunityId}`,
        );
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
        // Treat "Not available" (case-insensitive) as empty string for better UX
        aiSummary: hasValidAiSummary ? aiSummary : '',
        // Default to true if not provided, but respect explicit boolean from Mystique
        valuable: isValuable,
      };

      existing.setData(updatedData);
      suggestionsToSave.push(existing);
    });

    // 9. Batch save all suggestions using DynamoDB batch write
    if (suggestionsToSave.length > 0) {
      try {
        // eslint-disable-next-line no-underscore-dangle
        await Suggestion._saveMany(suggestionsToSave);

        // Check if this is a paid LLMO customer for quality tracking
        const isPaid = await isPaidLLMOCustomer(context);

        // Log comprehensive quality metrics with paid customer flag
        log.info(
          `${LOG_PREFIX} Successfully updated aiSummaries for siteId=${siteId} | `
          + `baseUrl=${site.getBaseURL()} | opportunityId=${opportunityId} | isPaidLLMOCustomer=${isPaid} | `
          + `totalSuggestions=${suggestionsToSave.length} | valuableSuggestions=${valuableCount} | validAiSummaryCount=${validAiSummaryCount}`,
        );
      } catch (error) {
        log.error(
          `${LOG_PREFIX} Error batch saving suggestions: ${error.message}`,
        );
        throw error;
      }
    } else {
      log.warn(
        `${LOG_PREFIX} No valid suggestions to update for opportunityId=${opportunityId}, siteId=${siteId}`,
      );
    }

    return ok();
  } catch (error) {
    log.error(
      `${LOG_PREFIX} Error processing guidance for opportunityId=${opportunityId}, siteId=${siteId}: ${error.message}`,
      error,
    );
    return badRequest(`Failed to process guidance: ${error.message}`);
  }
}
