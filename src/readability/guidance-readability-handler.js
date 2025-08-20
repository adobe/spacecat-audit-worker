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
import { addReadabilitySuggestions } from './suggestions-opportunity-handler.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.READABILITY;

/**
 * Maps Mystique readability suggestions to the same format used in opportunityHandler.js
 * @param {Array} mystiquesuggestions - Array of suggestions from Mystique
 * @returns {Array} Array of suggestions in the same format as opportunityHandler
 */
function mapMystiqueSuggestionsToOpportunityFormat(mystiquesuggestions) {
  return mystiquesuggestions.map((suggestion, index) => {
    const suggestionId = `readability-${suggestion.pageUrl || 'unknown'}-${index}`;

    return {
      id: suggestionId,
      pageUrl: suggestion.pageUrl,
      originalText: suggestion.original_paragraph,
      improvedText: suggestion.improved_paragraph,
      originalFleschScore: suggestion.current_flesch_score,
      improvedFleschScore: suggestion.improved_flesch_score,
      seoRecommendation: suggestion.seo_recommendation,
      aiRationale: suggestion.ai_rationale,
      targetFleschScore: suggestion.target_flesch_score,
    };
  });
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity, Site, Audit } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;
  const { suggestions } = data || {};

  log.info(`[${AUDIT_TYPE}]: Received Mystique guidance for readability: ${JSON.stringify(message, null, 2)}`);

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE}]: No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const site = await Site.findById(siteId);
  const auditUrl = site.getBaseURL();

  log.info(`[${AUDIT_TYPE}]: Processing suggestions for ${siteId} and auditUrl: ${auditUrl}`);

  let readabilitySuggestionsOppty;
  try {
    const opportunities = await Opportunity.allBySiteId(siteId);
    readabilitySuggestionsOppty = opportunities.find(
      (oppty) => oppty.getType() === 'readability-suggestions' && oppty.getAuditId() === auditId,
    );
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: Fetching opportunities for siteId ${siteId} failed with error: ${e.message}`);
    throw new Error(`[${AUDIT_TYPE}]: Failed to fetch opportunities for siteId ${siteId}: ${e.message}`);
  }

  if (!readabilitySuggestionsOppty) {
    const errorMsg = `[${AUDIT_TYPE}]: No existing readability-suggestions opportunity found for siteId ${siteId}, auditId ${auditId}. Opportunity should be created by main handler before processing suggestions.`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  const existingData = readabilitySuggestionsOppty.getData() || {};
  const processedSuggestionIds = new Set(existingData.processedSuggestionIds || []);
  if (processedSuggestionIds.has(messageId)) {
    log.info(`[${AUDIT_TYPE}]: Suggestions with id ${messageId} already processed. Skipping processing.`);
    return ok();
  } else {
    processedSuggestionIds.add(messageId);
  }

  // Process different response formats from Mystique
  let mappedSuggestions = [];

  // Check if we have direct improved paragraph data (single response)
  if (data?.improved_paragraph && data?.improved_flesch_score) {
    mappedSuggestions.push({
      id: `readability-${auditId}-${messageId}`,
      pageUrl: data.pageUrl || auditUrl,
      originalText: data.original_paragraph,
      improvedText: data.improved_paragraph,
      originalFleschScore: data.current_flesch_score,
      improvedFleschScore: data.improved_flesch_score,
      seoRecommendation: data.seo_recommendation,
      aiRationale: data.ai_rationale,
      targetFleschScore: data.target_flesch_score,
    });
  } else if (suggestions && suggestions.length > 0) {
    // Check if we have suggestions array (batch response)
    mappedSuggestions = mapMystiqueSuggestionsToOpportunityFormat(suggestions);
  } else if (data?.guidance && data.guidance.length > 0) {
    // Check if we have guidance array (alternative format)
    mappedSuggestions = mapMystiqueSuggestionsToOpportunityFormat(data.guidance);
  }

  if (mappedSuggestions.length === 0) {
    log.warn(`[${AUDIT_TYPE}]: No valid readability improvements found in Mystique response for siteId: ${siteId}`);
    return ok();
  }

  // Update opportunity data
  const updatedOpportunityData = {
    ...existingData,
    mystiqueResponsesReceived: (existingData.mystiqueResponsesReceived || 0) + 1,
    mystiqueResponsesExpected: existingData.mystiqueResponsesExpected || 0,
    totalReadabilityImprovements: mappedSuggestions.length,
    processedSuggestionIds: [...processedSuggestionIds],
    lastMystiqueResponse: new Date().toISOString(),
  };

  log.info(`[${AUDIT_TYPE}]: Received ${updatedOpportunityData.mystiqueResponsesReceived}/${updatedOpportunityData.mystiqueResponsesExpected} responses from Mystique for siteId: ${siteId}`);

  // Update opportunity with accumulated data
  try {
    readabilitySuggestionsOppty.setAuditId(auditId);
    readabilitySuggestionsOppty.setData(updatedOpportunityData);
    readabilitySuggestionsOppty.setUpdatedBy('system');
    await readabilitySuggestionsOppty.save();
    log.info(`[${AUDIT_TYPE}]: Updated opportunity with accumulated data`);
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: Updating opportunity for siteId ${siteId} failed with error: ${e.message}`, e);
    throw new Error(`[${AUDIT_TYPE}]: Failed to update opportunity for siteId ${siteId}: ${e.message}`);
  }

  // Process suggestions from Mystique
  if (mappedSuggestions.length > 0) {
    await addReadabilitySuggestions({
      opportunity: readabilitySuggestionsOppty,
      newSuggestionDTOs: mappedSuggestions.map((suggestion) => ({
        opportunityId: readabilitySuggestionsOppty.getId(),
        type: SuggestionModel.TYPES.CONTENT_UPDATE,
        data: { recommendations: [suggestion] },
        rank: 1,
      })),
      log,
    });

    log.info(`[${AUDIT_TYPE}]: Successfully processed ${mappedSuggestions.length} suggestions from Mystique for siteId: ${siteId}`);
  } else {
    log.info(`[${AUDIT_TYPE}]: No suggestions to process for siteId: ${siteId}`);
  }

  log.info(`[${AUDIT_TYPE}]: Successfully processed Mystique guidance for siteId: ${siteId}`);
  return ok();
}
