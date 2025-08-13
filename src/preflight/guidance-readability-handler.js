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

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.READABILITY;

/**
 * Maps Mystique readability suggestions to the same format used in opportunityHandler.js
 * @param {Array} mystiqueSuggestions - Array of suggestions from Mystique
 * @returns {Array} Mapped suggestions in opportunity format
 */
function mapMystiqueSuggestionsToOpportunityFormat(mystiqueSuggestions) {
  return mystiqueSuggestions.map((suggestion) => ({
    type: SuggestionModel.TYPES.CONTENT_UPDATE,
    rank: suggestion.rank || 1,
    data: {
      url: suggestion.url,
      originalParagraph: suggestion.original_paragraph,
      improvedParagraph: suggestion.improved_paragraph,
      originalFleschScore: suggestion.current_flesch_score,
      improvedFleschScore: suggestion.improved_flesch_score,
      seoRecommendation: suggestion.seo_recommendation,
      aiRationale: suggestion.ai_rationale,
      targetFleschScore: suggestion.target_flesch_score,
    },
  }));
}

/**
 * Processes Mystique response for readability guidance
 * This function processes responses from Mystique containing detailed guidance for
 * readability improvements, including specific text improvements and user impact.
 *
 * @param {Object} message - The message from Mystique containing detailed readability guidance
 * @param {Object} context - The context object containing dataAccess, log, etc.
 * @returns {Promise<Object>} Processed opportunity data
 */
export async function processReadabilityGuidance(message, context) {
  const { dataAccess, log } = context;
  const { Site, Opportunity } = dataAccess;

  try {
    const { siteId, auditId, data } = message;

    log.info(
      `[${AUDIT_TYPE}]: Received Mystique guidance for readability: ${JSON.stringify(message, null, 2)}`,
    );

    const site = await Site.findById(siteId);
    if (!site) {
      log.warn(`[${AUDIT_TYPE}]: No site found for siteId: ${siteId}`);
      return null;
    }

    // Find existing opportunity or create new one
    const opportunity = await Opportunity.findBySiteIdAndAuditIdAndType(
      siteId,
      auditId,
      AUDIT_TYPE,
    );

    if (!opportunity) {
      const errorMsg = `[${AUDIT_TYPE}]: No opportunity found for siteId: ${siteId}, auditId: ${auditId}, type: ${AUDIT_TYPE}`;
      log.warn(errorMsg);
      return null;
    }

    // Get existing opportunity data
    const existingData = opportunity.getData() || {};

    // Extract suggestions from Mystique response
    const suggestions = data?.guidance || [];

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      log.warn(`[${AUDIT_TYPE}]: No suggestions found in Mystique response for siteId: ${siteId}`);
      return null;
    }

    const mappedSuggestions = mapMystiqueSuggestionsToOpportunityFormat(suggestions);
    const totalImprovements = suggestions.length;

    const updatedOpportunityData = {
      ...existingData,
      mystiqueResponsesReceived: (existingData.mystiqueResponsesReceived || 0) + 1,
      mystiqueResponsesExpected: existingData.mystiqueResponsesExpected || 0,
      totalReadabilityIssues: totalImprovements,
      lastMystiqueResponse: new Date().toISOString(),
    };

    opportunity.setData(updatedOpportunityData);
    await opportunity.save();

    if (mappedSuggestions.length > 0) {
      // Use Promise.all to avoid await in loop
      await Promise.all(
        mappedSuggestions.map((suggestionData) => opportunity.addSuggestion(suggestionData)),
      );
      log.info(
        `[${AUDIT_TYPE}]: Successfully processed ${suggestions.length} suggestions from Mystique for siteId: ${siteId}`,
      );
    }
    log.info(`[${AUDIT_TYPE}]: Successfully processed Mystique guidance for siteId: ${siteId}`);
    return {
      opportunity,
      suggestions: mappedSuggestions,
      totalImprovements,
    };
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Error processing readability guidance:`, error);
    throw error;
  }
}

/**
 * Handles Mystique response for readability guidance
 * This is the main entry point for processing Mystique responses
 *
 * @param {Object} message - The message from Mystique
 * @param {Object} context - The context object
 * @returns {Promise<void>}
 */
export default async function handler(message, context) {
  const { log } = context;

  try {
    // Check if this is a readability guidance message
    if (message.type !== 'guidance:readability') {
      log.debug(`[${AUDIT_TYPE}]: Ignoring non-readability message type: ${message.type}`);
      return;
    }

    await processReadabilityGuidance(message, context);
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Error handling readability guidance:`, error);
  }
}
