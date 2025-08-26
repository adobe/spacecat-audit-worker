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
import { addAltTextSuggestions, getProjectedMetrics, cleanupOutdatedSuggestions } from './opportunityHandler.js';

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
  const existingSuggestions = await opportunity.getSuggestions();
  const pageUrlSet = new Set(pageUrls);

  // Find suggestions to remove for these pages
  const suggestionsToRemove = existingSuggestions.filter((suggestion) => {
    const pageUrl = suggestion.getData()?.recommendations?.[0]?.pageUrl;
    return pageUrl && pageUrlSet.has(pageUrl);
  }).filter((suggestion) => {
    const IGNORED_STATUSES = ['SKIPPED', 'FIXED'];
    return !IGNORED_STATUSES.includes(suggestion.getStatus());
  });

  // Extract images from suggestions being removed
  const removedImages = suggestionsToRemove.map((suggestion) => {
    const rec = suggestion.getData()?.recommendations?.[0];
    return {
      pageUrl: rec?.pageUrl,
      src: rec?.imageUrl,
    };
  }).filter((img) => img.pageUrl);

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

  // Mark suggestions as OUTDATED
  if (suggestionsToRemove.length > 0) {
    await Suggestion.bulkUpdateStatus(suggestionsToRemove, SuggestionModel.STATUSES.OUTDATED);
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

  log.info(`[${AUDIT_TYPE}]: Received Mystique guidance for alt-text: ${JSON.stringify(message, null, 2)}`);

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE}]: No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const site = await Site.findById(siteId);
  const auditUrl = site.getBaseURL();

  log.info(`[${AUDIT_TYPE}]: Processing suggestions for ${siteId} and auditUrl: ${auditUrl}`);

  let altTextOppty;
  try {
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AUDIT_TYPE,
    );
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: Fetching opportunities for siteId ${siteId} failed with error: ${e.message}`);
    throw new Error(`[${AUDIT_TYPE}]: Failed to fetch opportunities for siteId ${siteId}: ${e.message}`);
  }

  if (!altTextOppty) {
    const errorMsg = `[${AUDIT_TYPE}]: No existing opportunity found for siteId ${siteId}. Opportunity should be created by main handler before processing suggestions.`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  const existingData = altTextOppty.getData() || {};
  const processedSuggestionIds = new Set(existingData.processedSuggestionIds || []);
  if (processedSuggestionIds.has(messageId)) {
    log.info(`[${AUDIT_TYPE}]: Suggestions with id ${messageId} already processed. Skipping processing.`);
    return ok();
  }

  // Process the Mystique response
  if (pageUrls && Array.isArray(pageUrls) && pageUrls.length > 0) {
    // Clear existing suggestions for the processed pages and calculate their metrics
    const removedMetrics = await clearSuggestionsForPagesAndCalculateMetrics(
      altTextOppty,
      pageUrls,
      auditUrl,
      context,
      Suggestion,
      log,
    );

    let newMetrics = {
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
      decorativeImagesCount: 0,
    };

    if (suggestions && suggestions.length > 0) {
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
      newMetrics = await getProjectedMetrics({
        images: newImages,
        auditUrl,
        context,
        log,
      });

      // Calculate decorative count separately
      const newDecorativeCount = suggestions.filter((s) => s.isDecorative === true).length;
      newMetrics.decorativeImagesCount = newDecorativeCount;

      log.info(`[${AUDIT_TYPE}]: Added ${suggestions.length} new suggestions for ${pageUrls.length} processed pages`);
    } else {
      log.info(`[${AUDIT_TYPE}]: No new suggestions for ${pageUrls.length} processed pages`);
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

    altTextOppty.setAuditId(auditId);
    altTextOppty.setData(updatedOpportunityData);
    altTextOppty.setUpdatedBy('system');
    await altTextOppty.save();

    log.info(`[${AUDIT_TYPE}]: 
      Received ${updatedOpportunityData.mystiqueResponsesReceived}/${updatedOpportunityData.mystiqueResponsesExpected} responses from Mystique for siteId: ${siteId}`);

    // Cleanup OUTDATED suggestions if this is the last batch
    if (updatedOpportunityData.mystiqueResponsesReceived
      >= (updatedOpportunityData.mystiqueResponsesExpected || 0)
    ) {
      log.info(`[${AUDIT_TYPE}]: All Mystique batches completed. 
        Starting cleanup of OUTDATED suggestions for ${siteId} and auditId: ${auditId}`);

      // Small delay to ensure no concurrent operations
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });

      await cleanupOutdatedSuggestions(altTextOppty, log);
    }

    log.info(`[${AUDIT_TYPE}]: Successfully processed ${suggestions.length} suggestions from Mystique for siteId: ${siteId}`);
  } else {
    log.info(`[${AUDIT_TYPE}]: No suggestions to process for siteId: ${siteId}`);
  }

  log.info(`[${AUDIT_TYPE}]: Successfully processed Mystique guidance for siteId: ${siteId}`);
  return ok();
}
