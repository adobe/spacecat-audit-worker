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
 * Maps Mystique alt-text suggestions to the same format used in opportunityHandler.js
 * @param {Array} mystiquesuggestions - Array of suggestions from Mystique
 * @returns {Array} Array of suggestions in the same format as opportunityHandler
 */
function mapMystiqueSuggestionsToOpportunityFormat(mystiquesuggestions) {
  return mystiquesuggestions.map((suggestion) => {
    const suggestionId = `${suggestion.pageUrl}/${suggestion.imageId}`;

    return {
      id: suggestionId,
      pageUrl: suggestion.pageUrl,
      imageUrl: suggestion.imageUrl,
      altText: suggestion.altText,
      isAppropriate: suggestion.isAppropriate,
      isDecorative: suggestion.isDecorative,
      xpath: suggestion.xpath,
      language: suggestion.language,
    };
  });
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity, Site, Audit } = dataAccess;
  const { auditId, siteId, data } = message;
  const { suggestions } = data || {};

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

  // Map Mystique suggestions
  const mappedSuggestions = mapMystiqueSuggestionsToOpportunityFormat(suggestions || []);

  // Calculate projected metrics based on Mystique suggestions
  const batchProjectedMetrics = await getProjectedMetrics({
    images: mappedSuggestions.map((suggestion) => ({
      pageUrl: suggestion.pageUrl,
      src: suggestion.imageUrl,
    })),
    auditUrl,
    context,
    log,
  });

  const batchDecorativeImagesCount = mappedSuggestions.filter((
    suggestion,
  ) => suggestion.isDecorative === true).length;

  // Accumulate metrics with existing data
  const existingData = altTextOppty.getData() || {};
  const updatedOpportunityData = {
    projectedTrafficLost: (existingData.projectedTrafficLost || 0)
    + batchProjectedMetrics.projectedTrafficLost,
    projectedTrafficValue: (existingData.projectedTrafficValue || 0)
    + batchProjectedMetrics.projectedTrafficValue,
    decorativeImagesCount: (existingData.decorativeImagesCount || 0) + batchDecorativeImagesCount,
    dataSources: existingData.dataSources,
    mystiqueResponsesReceived: (existingData.mystiqueResponsesReceived || 0) + 1,
    mystiqueResponsesExpected: existingData.mystiqueResponsesExpected || 0,
  };
  log.info(`[${AUDIT_TYPE}]: Received ${updatedOpportunityData.mystiqueResponsesReceived}/${updatedOpportunityData.mystiqueResponsesExpected} responses from Mystique for siteId: ${siteId}`);

  // Update opportunity with accumulated metrics
  try {
    altTextOppty.setAuditId(auditId);
    altTextOppty.setData(updatedOpportunityData);
    altTextOppty.setUpdatedBy('system');
    await altTextOppty.save();
    log.info(`[${AUDIT_TYPE}]: Updated opportunity with accumulated metrics`);
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: Updating opportunity for siteId ${siteId} failed with error: ${e.message}`, e);
    throw new Error(`[${AUDIT_TYPE}]: Failed to update opportunity for siteId ${siteId}: ${e.message}`);
  }

  // Process suggestions from Mystique
  if (suggestions && suggestions.length > 0) {
    await addAltTextSuggestions({
      opportunity: altTextOppty,
      newSuggestionDTOs: mappedSuggestions.map((suggestion) => ({
        opportunityId: altTextOppty.getId(),
        type: SuggestionModel.TYPES.CONTENT_UPDATE,
        data: { recommendations: [suggestion] },
        rank: 1,
      })),
      log,
    });

    log.info(`[${AUDIT_TYPE}]: Successfully processed ${suggestions.length} suggestions from Mystique for siteId: ${siteId}`);
  } else {
    log.info(`[${AUDIT_TYPE}]: No suggestions to process for siteId: ${siteId}`);
  }

  log.info(`[${AUDIT_TYPE}]: Successfully processed Mystique guidance for siteId: ${siteId}`);
  return ok();
}
