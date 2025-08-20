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

import { Audit as AuditModel, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { getRUMUrl, toggleWWW } from '../support/utils.js';
import {
  CPC, PENALTY_PER_IMAGE, RUM_INTERVAL, ALT_TEXT_GUIDANCE_TYPE, ALT_TEXT_OBSERVATION,
  MYSTIQUE_BATCH_SIZE,
} from './constants.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

/**
 * Synchronizes existing suggestions with new data
 * by removing existing suggestions and adding new ones.
 *
 * @param {Object} params - The parameters for the sync operation.
 * @param {Object} params.opportunity - The opportunity object to synchronize suggestions for.
 * @param {Array} params.newSuggestionDTOs - Array of new data objects (not models) to sync.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export async function syncAltTextSuggestions({ opportunity, newSuggestionDTOs, log }) {
  const existingSuggestions = await opportunity.getSuggestions();

  const IGNORED_STATUSES = [SuggestionModel.STATUSES.SKIPPED, SuggestionModel.STATUSES.FIXED];
  const ignoredSuggestions = existingSuggestions.filter(
    (s) => IGNORED_STATUSES.includes(s.getStatus()),
  );
  const ignoredSuggestionIds = ignoredSuggestions.map((s) => s.getData().recommendations[0].id);

  // Remove existing suggestions that were not ignored
  await Promise.all(existingSuggestions
    .filter(
      (suggestion) => !ignoredSuggestionIds.includes(suggestion.getData().recommendations[0].id),
    )
    .map((suggestion) => suggestion.remove()));

  const suggestionsToAdd = newSuggestionDTOs.filter(
    (s) => !ignoredSuggestionIds.includes(s.data.recommendations[0].id),
  );

  // Add new suggestions to oppty
  if (isNonEmptyArray(suggestionsToAdd)) {
    const updateResult = await opportunity.addSuggestions(suggestionsToAdd);

    if (isNonEmptyArray(updateResult.errorItems)) {
      log.error(`[${AUDIT_TYPE}]: Suggestions for siteId ${opportunity.getSiteId()} contains ${updateResult.errorItems.length} items with errors`);
      updateResult.errorItems.forEach((errorItem) => {
        log.error(`[${AUDIT_TYPE}]: Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
      });

      if (!isNonEmptyArray(updateResult.createdItems)) {
        throw new Error(`[${AUDIT_TYPE}]: Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
      }
    }
  }
}

export const getProjectedMetrics = async ({
  images, auditUrl, context, log,
}) => {
  let finalUrl;
  let results;

  try {
    finalUrl = await getRUMUrl(auditUrl);
    log.info(`[${AUDIT_TYPE}]: RUM URL: ${finalUrl}`);
    const rumAPIClient = RUMAPIClient.createFrom(context);
    const options = {
      domain: finalUrl,
      interval: RUM_INTERVAL,
    };

    results = await rumAPIClient.query('traffic-acquisition', options);
  } catch (err) {
    log.error(`[${AUDIT_TYPE}]: Failed to get RUM results for ${auditUrl} with error: ${err.message}`);
    return {
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
    };
  }

  const pageUrlToOrganicTrafficMap = results.reduce((acc, page) => {
    acc[page.url] = {
      organicTraffic: page.earned,
      imagesWithoutAltText: 0,
    };
    return acc;
  }, {});

  images.forEach((image) => {
    const fullPageUrl = new URL(image.pageUrl, auditUrl).toString();

    // Images from RUM (might) come with www while our scraper gives us always non-www pages
    if (pageUrlToOrganicTrafficMap[fullPageUrl]) {
      pageUrlToOrganicTrafficMap[fullPageUrl].imagesWithoutAltText += 1;
    } else if (pageUrlToOrganicTrafficMap[toggleWWW(fullPageUrl)]) {
      pageUrlToOrganicTrafficMap[toggleWWW(fullPageUrl)].imagesWithoutAltText += 1;
    } else {
      log.debug(`[${AUDIT_TYPE}]: Page URL ${fullPageUrl} or ${toggleWWW(fullPageUrl)} not found in RUM API results`);
    }
  });

  const projectedTrafficLost = Object.values(pageUrlToOrganicTrafficMap)
    .reduce(
      (acc, page) => acc + (page.organicTraffic * PENALTY_PER_IMAGE * page.imagesWithoutAltText),
      0,
    );

  const projectedTrafficValue = projectedTrafficLost * CPC;
  return {
    projectedTrafficLost: Math.round(projectedTrafficLost),
    projectedTrafficValue: Math.round(projectedTrafficValue),
  };
};

export const chunkArray = (array, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

/**
 * Sends alt-text opportunity message to Mystique for AI-powered suggestions
 * @param {string} auditUrl - The base URL being audited
 * @param {Array} pageUrls - Array of page URLs to analyze for missing alt-text
 * @param {string} siteId - Site identifier
 * @param {string} auditId - Audit identifier
 * @param {Object} context - The context object containing sqs, env, etc.
 * @returns {Promise<void>}
 */
export async function sendAltTextOpportunityToMystique(
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

    // Batch the URLs to avoid sending too many at once
    const urlBatches = chunkArray(pageUrls, MYSTIQUE_BATCH_SIZE);

    log.info(`[${AUDIT_TYPE}]: Sending ${pageUrls.length} URLs to Mystique in ${urlBatches.length} batch(es)`);

    // Send each batch as a separate message
    for (let i = 0; i < urlBatches.length; i += 1) {
      const batch = urlBatches[i];

      const mystiqueMessage = {
        type: ALT_TEXT_GUIDANCE_TYPE,
        siteId,
        auditId,
        deliveryType: site.getDeliveryType(),
        time: new Date().toISOString(),
        url: auditUrl,
        observation: ALT_TEXT_OBSERVATION,
        data: {
          pageUrls: batch,
        },
      };
      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
      log.info(`[${AUDIT_TYPE}]: Batch ${i + 1}/${urlBatches.length} sent to Mystique with ${batch.length} URLs`);
      log.info(`[${AUDIT_TYPE}]: Message sent to Mystique: ${JSON.stringify(mystiqueMessage)}`);
    }

    log.info(`[${AUDIT_TYPE}]: All ${urlBatches.length} batches sent to Mystique successfully`);
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Failed to send alt-text opportunity to Mystique: ${error.message}`);
    throw error;
  }
}

/**
 * Clears all existing alt-text suggestions except those that are ignored/skipped
 * This should be called once at the beginning of the alt-text audit process
 *
 * @param {Object} params - The parameters for the cleanup operation.
 * @param {Object} params.opportunity - The opportunity object to clear suggestions for.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the cleanup is complete.
 */
export async function clearAltTextSuggestions({ opportunity, log }) {
  if (!opportunity) {
    log.debug(`[${AUDIT_TYPE}]: No opportunity found, skipping suggestion cleanup`);
    return;
  }

  const existingSuggestions = await opportunity.getSuggestions();

  if (!existingSuggestions || existingSuggestions.length === 0) {
    log.debug(`[${AUDIT_TYPE}]: No existing suggestions to clear`);
    return;
  }

  const IGNORED_STATUSES = [SuggestionModel.STATUSES.SKIPPED, SuggestionModel.STATUSES.FIXED];
  const ignoredSuggestions = existingSuggestions.filter(
    (s) => IGNORED_STATUSES.includes(s.getStatus()),
  );
  const ignoredSuggestionIds = ignoredSuggestions.map((s) => s.getData().recommendations[0].id);

  // Remove existing suggestions that were not ignored
  const suggestionsToRemove = existingSuggestions.filter(
    (suggestion) => !ignoredSuggestionIds.includes(suggestion.getData().recommendations[0].id),
  );

  if (suggestionsToRemove.length > 0) {
    await Promise.all(suggestionsToRemove.map((suggestion) => suggestion.remove()));
    log.info(`[${AUDIT_TYPE}]: Cleared ${suggestionsToRemove.length} existing suggestions (preserved ${ignoredSuggestions.length} ignored suggestions)`);
  } else {
    log.debug(`[${AUDIT_TYPE}]: No suggestions to clear (all ${existingSuggestions.length} suggestions are ignored)`);
  }
}

/**
 * Adds new alt-text suggestions incrementally without removing existing ones
 * This should be called when receiving batches from Mystique
 *
 * @param {Object} params - The parameters for the sync operation.
 * @param {Object} params.opportunity - The opportunity object to add suggestions to.
 * @param {Array} params.newSuggestionDTOs - Array of new suggestion DTOs to add.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the addition is complete.
 */
export async function addAltTextSuggestions({ opportunity, newSuggestionDTOs, log }) {
  if (!isNonEmptyArray(newSuggestionDTOs)) {
    log.debug(`[${AUDIT_TYPE}]: No new suggestions to add`);
    return;
  }

  const updateResult = await opportunity.addSuggestions(newSuggestionDTOs);

  if (isNonEmptyArray(updateResult.errorItems)) {
    log.error(`[${AUDIT_TYPE}]: Suggestions for siteId ${opportunity.getSiteId()} contains ${updateResult.errorItems.length} items with errors`);
    updateResult.errorItems.forEach((errorItem) => {
      log.error(`[${AUDIT_TYPE}]: Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
    });

    if (!isNonEmptyArray(updateResult.createdItems)) {
      throw new Error(`[${AUDIT_TYPE}]: Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
    }
  }

  log.info(`[${AUDIT_TYPE}]: Added ${newSuggestionDTOs.length} new suggestions`);
}
