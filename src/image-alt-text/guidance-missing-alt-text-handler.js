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

import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { Suggestion as SuggestionModel, Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { addAltTextSuggestions, getProjectedMetrics } from './opportunityHandler.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

/**
 * Maps Mystique alt-text suggestions to suggestion DTO format
 * @param {Array} mystiquesuggestions - Array of suggestions from Mystique
 * @param {string} opportunityId - The opportunity ID to associate suggestions with
 * @returns {Array} Array of suggestion DTOs ready for addition
 */

function mapMystiqueSuggestionsToSuggestionDTOs(mystiquesuggestions, opportunityId) {
  return mystiquesuggestions.map((suggestion) => {
    const suggestionId = `${suggestion.pageUrl}/${suggestion.imageId}`;

    return {
      opportunityId,
      type: SuggestionModel.TYPES.CONTENT_UPDATE,
      data: {
        recommendations: [{
          id: suggestionId,
          pageUrl: suggestion.pageUrl,
          imageUrl: suggestion.imageUrl,
          altText: suggestion.altText,
          isAppropriate: suggestion.isAppropriate,
          isDecorative: suggestion.isDecorative,
          xpath: suggestion.xpath,
          language: suggestion.language,
        }],
      },
      rank: 1,
    };
  });
}

/**
 * Clears existing suggestions for specific pages and calculates their metrics for removal
 * @param {Object} opportunity - The opportunity object
 * @param {Array} pageUrls - Array of page URLs to clear suggestions for
 * @param {string} auditUrl - Base audit URL
 * @param {Object} context - Context object
 * @param {Object} Suggestion - Suggestion model from dataAccess
 * @param {Object} log - Logger
 * @returns {Promise<Object>} Metrics for removed suggestions
 */
async function clearSuggestionsForPagesAndCalculateMetrics(
  opportunity,
  pageUrls,
  auditUrl,
  context,
  Suggestion,
  log,
) {
  const opportunityId = opportunity.getId?.() || opportunity.id || 'unknown';
  log.debug(`[${AUDIT_TYPE}]: Starting clearSuggestionsForPagesAndCalculateMetrics for ${pageUrls.length} pages, opportunityId: ${opportunityId}`);

  const existingSuggestions = await opportunity.getSuggestions();
  log.debug(`[${AUDIT_TYPE}]: Found ${existingSuggestions.length} total existing suggestions`);

  const pageUrlSet = new Set(pageUrls);
  /**
  * TODO: ASSETS-59781 - Update alt-text opportunity to use syncSuggestions
  * instead of current approach. This will enable handling of PENDING_VALIDATION status.
  */
  // Find suggestions to remove for these pages
  const suggestionsToRemove = existingSuggestions.filter((suggestion) => {
    const pageUrl = suggestion.getData()?.recommendations?.[0]?.pageUrl;
    return pageUrl && pageUrlSet.has(pageUrl);
  }).filter((suggestion) => {
    const IGNORED_STATUSES = ['SKIPPED', 'FIXED', 'OUTDATED'];
    return !IGNORED_STATUSES.includes(suggestion.getStatus());
  });

  log.info(`[${AUDIT_TYPE}]: Identified ${suggestionsToRemove.length} suggestions to remove for ${pageUrls.length} pages`);

  // Extract images from suggestions being removed
  const removedImages = suggestionsToRemove.map((suggestion) => {
    const rec = suggestion.getData()?.recommendations?.[0];
    return {
      pageUrl: rec?.pageUrl,
      src: rec?.imageUrl,
    };
  }).filter((img) => img.pageUrl);

  log.debug(`[${AUDIT_TYPE}]: Extracted ${removedImages.length} images from suggestions being removed`);

  // Calculate metrics for removed suggestions using getProjectedMetrics
  const removedMetrics = removedImages.length > 0
    ? await getProjectedMetrics({
      images: removedImages,
      auditUrl,
      context,
      log,
    })
    : { projectedTrafficLost: 0, projectedTrafficValue: 0 };

  // Calculate decorative count separately
  const removedDecorativeCount = suggestionsToRemove
    .map((s) => s.getData()?.recommendations?.[0]?.isDecorative)
    .filter((isDecorative) => isDecorative === true).length;

  log.debug(`[${AUDIT_TYPE}]: Removed decorative images count: ${removedDecorativeCount}`);

  // Mark suggestions as OUTDATED
  if (suggestionsToRemove.length > 0) {
    await Suggestion.bulkUpdateStatus(suggestionsToRemove, SuggestionModel.STATUSES.OUTDATED);
    log.debug(`[${AUDIT_TYPE}]: Marked ${suggestionsToRemove.length} suggestions as OUTDATED for ${pageUrls.length} pages`);
    log.info(`[${AUDIT_TYPE}]: Marked ${suggestionsToRemove.length} suggestions as OUTDATED for ${pageUrls.length} pages`);
  }

  return {
    ...removedMetrics,
    decorativeImagesCount: removedDecorativeCount,
  };
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Opportunity, Site, Audit, Suggestion,
  } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;
  const { suggestions, pageUrls } = data || {};

  log.info(`[${AUDIT_TYPE}]: Received Mystique response - messageId: ${messageId}, siteId: ${siteId}, auditId: ${auditId}`);
  log.debug(`[${AUDIT_TYPE}]: Processing ${pageUrls?.length || 0} page URLs with ${suggestions?.length || 0} suggestions`);

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE}]: No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const site = await Site.findById(siteId);
  const auditUrl = site.getBaseURL();
  log.debug(`[${AUDIT_TYPE}]: Processing for baseURL: ${auditUrl}`);

  let altTextOppty;
  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AUDIT_TYPE,
    );
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: Fetching opportunities for siteId ${siteId} failed with error: ${e.message}`, { error: e.stack });
    throw new Error(`[${AUDIT_TYPE}]: Failed to fetch opportunities for siteId ${siteId}: ${e.message}`);
  }

  if (!altTextOppty) {
    const errorMsg = `[${AUDIT_TYPE}]: No existing opportunity found for siteId ${siteId}. Opportunity should be created by main handler before processing suggestions.`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  const opportunityId = altTextOppty.getId?.() || altTextOppty.id || 'unknown';
  log.info(`[${AUDIT_TYPE}]: Found opportunity ${opportunityId} for siteId: ${siteId}`);

  const existingData = altTextOppty.getData() || {};
  const processedSuggestionIds = new Set(existingData.processedSuggestionIds || []);
  if (processedSuggestionIds.has(messageId)) {
    log.info(`[${AUDIT_TYPE}]: Suggestions with id ${messageId} already processed. Skipping processing.`);
    return ok();
  }

  log.info(`[${AUDIT_TYPE}]: Processing new message ${messageId} for opportunityId: ${opportunityId} (${existingData.mystiqueResponsesReceived || 0}/${existingData.mystiqueResponsesExpected || 0} responses received so far)`);

  // Process the Mystique response
  if (pageUrls && Array.isArray(pageUrls) && pageUrls.length > 0) {
    log.info(`[${AUDIT_TYPE}]: Processing ${pageUrls.length} page URLs for opportunityId: ${opportunityId}`);

    // Clear existing suggestions for the processed pages and calculate their metrics
    log.debug(`[${AUDIT_TYPE}]: Clearing existing suggestions for ${pageUrls.length} pages`);
    const removedMetrics = await clearSuggestionsForPagesAndCalculateMetrics(
      altTextOppty,
      pageUrls,
      auditUrl,
      context,
      Suggestion,
      log,
    );

    log.info(`[${AUDIT_TYPE}]: Cleared suggestions - removed metrics: projectedTrafficLost=${removedMetrics.projectedTrafficLost}, projectedTrafficValue=${removedMetrics.projectedTrafficValue}, decorativeImagesCount=${removedMetrics.decorativeImagesCount}`);

    let newMetrics = {
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
      decorativeImagesCount: 0,
    };

    if (suggestions && suggestions.length > 0) {
      log.info(`[${AUDIT_TYPE}]: Adding ${suggestions.length} new suggestions for opportunityId: ${opportunityId}`);

      const mappedSuggestions = mapMystiqueSuggestionsToSuggestionDTOs(
        suggestions,
        altTextOppty.getId(),
      );
      await addAltTextSuggestions({
        opportunity: altTextOppty,
        newSuggestionDTOs: mappedSuggestions,
        log,
      });

      // Calculate metrics for new suggestions using getProjectedMetrics
      const newImages = suggestions.map((suggestion) => ({
        pageUrl: suggestion.pageUrl,
        src: suggestion.imageUrl,
      }));
      log.debug(`[${AUDIT_TYPE}]: Calculating projected metrics for ${newImages.length} images`);
      newMetrics = await getProjectedMetrics({
        images: newImages,
        auditUrl,
        context,
        log,
      });

      // Calculate decorative count separately
      const newDecorativeCount = suggestions.filter((s) => s.isDecorative === true).length;
      newMetrics.decorativeImagesCount = newDecorativeCount;

      log.debug(`[${AUDIT_TYPE}]: Added ${suggestions.length} new suggestions for ${pageUrls.length} processed pages`);
      log.info(`[${AUDIT_TYPE}]: New metrics - projectedTrafficLost=${newMetrics.projectedTrafficLost}, projectedTrafficValue=${newMetrics.projectedTrafficValue}, decorativeImagesCount=${newMetrics.decorativeImagesCount}`);
    } else {
      log.debug(`[${AUDIT_TYPE}]: No new suggestions for ${pageUrls.length} processed pages`);
    }

    // Update opportunity data: subtract removed metrics, add new metrics
    const updatedOpportunityData = {
      ...existingData,
      projectedTrafficLost: Math.max(0, (existingData.projectedTrafficLost || 0)
      - removedMetrics.projectedTrafficLost + newMetrics.projectedTrafficLost),
      projectedTrafficValue: Math.max(0, (existingData.projectedTrafficValue || 0)
      - removedMetrics.projectedTrafficValue + newMetrics.projectedTrafficValue),
      decorativeImagesCount: Math.max(
        0,
        (existingData.decorativeImagesCount || 0)
        - removedMetrics.decorativeImagesCount + newMetrics.decorativeImagesCount,
      ),
      mystiqueResponsesReceived: (existingData.mystiqueResponsesReceived || 0) + 1,
      processedSuggestionIds: [...processedSuggestionIds, messageId],
    };

    log.info(`[${AUDIT_TYPE}]: Updating opportunity ${opportunityId} - total metrics: projectedTrafficLost=${updatedOpportunityData.projectedTrafficLost}, projectedTrafficValue=${updatedOpportunityData.projectedTrafficValue}, decorativeImagesCount=${updatedOpportunityData.decorativeImagesCount}`);
    log.info(`[${AUDIT_TYPE}]: Mystique responses progress: ${updatedOpportunityData.mystiqueResponsesReceived}/${existingData.mystiqueResponsesExpected || 0}`);

    altTextOppty.setAuditId(auditId);
    altTextOppty.setData(updatedOpportunityData);
    altTextOppty.setUpdatedBy('system');
    await altTextOppty.save();
    log.info(`[${AUDIT_TYPE}]: Successfully saved opportunity ${opportunityId} with updated metrics`);
  } else {
    log.info(`[${AUDIT_TYPE}]: No page URLs to process for siteId: ${siteId}, messageId: ${messageId}`);
  }
  return ok();
}
