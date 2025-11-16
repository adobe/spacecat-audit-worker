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
import { getProjectedMetrics } from './opportunityHandler.js';
import { syncSuggestions, keepSameDataFunction } from '../utils/data-access.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

// Maps incoming Mystique suggestions to suggestion DTOs is no longer needed here

// clearSuggestionsForPagesAndCalculateMetrics removed in favor of syncSuggestions

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Opportunity, Site, Audit,
  } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;
  const { suggestions, pageUrls } = data || {};

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE}]: No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const site = await Site.findById(siteId);
  const auditUrl = site.getBaseURL();

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
    const pageUrlSet = new Set(pageUrls);

    // Compute removed metrics for existing suggestions on processed pages
    // that are not in the new batch
    const allExisting = await altTextOppty.getSuggestions();
    const existingOnProcessedPages = allExisting.filter((s) => {
      const rec = s.getData()?.recommendations?.[0];
      return rec?.pageUrl && pageUrlSet.has(rec.pageUrl);
    });

    const IGNORED_STATUSES = [
      SuggestionModel.STATUSES.SKIPPED,
      SuggestionModel.STATUSES.FIXED,
      SuggestionModel.STATUSES.OUTDATED,
    ];
    const incomingKeys = new Set((suggestions || []).map((s) => `${s.pageUrl}/${s.imageId}`));
    const suggestionsToRemove = existingOnProcessedPages
      .filter((s) => !IGNORED_STATUSES.includes(s.getStatus()))
      .filter((s) => {
        const rec = s.getData()?.recommendations?.[0];
        return rec?.id && !incomingKeys.has(rec.id);
      });

    const removedImages = suggestionsToRemove.map((s) => {
      const rec = s.getData()?.recommendations?.[0];
      return { pageUrl: rec?.pageUrl, src: rec?.imageUrl };
    }).filter((i) => i.pageUrl);

    const removedMetrics = removedImages.length > 0
      ? await getProjectedMetrics({
        images: removedImages,
        auditUrl,
        context,
        log,
      })
      : {
        projectedTrafficLost: 0,
        projectedTrafficValue: 0,
      };

    const removedDecorativeCount = suggestionsToRemove
      .map((s) => s.getData()?.recommendations?.[0]?.isDecorative)
      .filter((isDecorative) => isDecorative === true).length;

    let newMetrics = {
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
      decorativeImagesCount: 0,
    };

    if (suggestions && suggestions.length > 0) {
      // Prepare sync inputs
      const buildKey = (payload) => {
        const rec = payload?.recommendations?.[0];
        return rec?.id ?? `${payload.pageUrl}/${payload.imageId}`;
      };
      const mapNewSuggestion = (s) => ({
        opportunityId: altTextOppty.getId(),
        type: SuggestionModel.TYPES.CONTENT_UPDATE,
        data: {
          recommendations: [{
            id: `${s.pageUrl}/${s.imageId}`,
            pageUrl: s.pageUrl,
            imageUrl: s.imageUrl,
            altText: s.altText,
            isAppropriate: s.isAppropriate,
            isDecorative: s.isDecorative,
            xpath: s.xpath,
            language: s.language,
          }],
        },
        rank: 1,
      });
      // Preserve existing suggestions for unprocessed pages to avoid marking them OUTDATED
      const preserveData = allExisting
        .filter((s) => {
          const rec = s.getData()?.recommendations?.[0];
          return rec?.pageUrl && !pageUrlSet.has(rec.pageUrl);
        })
        .map((s) => {
          const rec = s.getData().recommendations[0];
          const imageId = rec.id.split('/').pop();
          return { pageUrl: rec.pageUrl, imageId };
        });
      await syncSuggestions({
        context,
        opportunity: altTextOppty,
        newData: [...suggestions, ...preserveData],
        buildKey,
        mapNewSuggestion,
        mergeDataFunction: keepSameDataFunction,
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

      log.debug(`[${AUDIT_TYPE}]: Synced ${suggestions.length} suggestions for ${pageUrls.length} processed pages`);
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
          - removedDecorativeCount + newMetrics.decorativeImagesCount,
      ),
      mystiqueResponsesReceived: (existingData.mystiqueResponsesReceived || 0) + 1,
      processedSuggestionIds: [...processedSuggestionIds, messageId],
    };

    altTextOppty.setAuditId(auditId);
    altTextOppty.setData(updatedOpportunityData);
    altTextOppty.setUpdatedBy('system');
    await altTextOppty.save();
  } else {
    log.info(`[${AUDIT_TYPE}]: No suggestions to process for siteId: ${siteId}`);
  }
  return ok();
}
