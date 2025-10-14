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
import { Audit } from '@adobe/spacecat-shared-data-access';

/**
 * Maps Mystique readability suggestions to opportunity format
 * @param {Array} mystiquesuggestions - Array of suggestions from Mystique
 * @returns {Array} Array of suggestions for opportunity
 */
function mapMystiqueSuggestionsToOpportunityFormat(mystiquesuggestions) {
  return mystiquesuggestions.map((suggestion, index) => {
    const suggestionId = `readability-opportunity-${suggestion.pageUrl || 'unknown'}-${index}`;

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
      type: 'READABILITY_IMPROVEMENT',
    };
  });
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, Opportunity,
  } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;
  const { suggestions } = data || {};

  log.info(`[readability-opportunity guidance]: Received Mystique guidance for readability opportunities: ${JSON.stringify(message, null, 2)}`);

  // For opportunity audits, auditId is an actual Audit entity ID
  log.info(`[readability-opportunity guidance]: Processing guidance for auditId: ${auditId}, siteId: ${siteId}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[readability-opportunity guidance]: Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }
  const auditUrl = site.getBaseURL();

  log.info(`[readability-opportunity guidance]: Processing suggestions for ${siteId} and auditUrl: ${auditUrl}`);

  // Validate that the audit exists
  const audit = await dataAccess.Audit.findById(auditId);
  if (!audit) {
    log.error(`[readability-opportunity guidance]: Audit not found for auditId: ${auditId}`);
    return notFound('Audit not found');
  }
  log.info(`[readability-opportunity guidance]: Found audit with type: ${audit.getAuditType()}`);

  // Find the readability opportunity for this site and audit
  const opportunities = await Opportunity.allBySiteIdAndAuditId(siteId, auditId);
  const readabilityOpportunity = opportunities.find(
    (opp) => opp.getAuditType() === (Audit.AUDIT_TYPES.READABILITY || 'readability'),
  );

  if (!readabilityOpportunity) {
    log.error(
      `[readability-opportunity guidance]: No readability opportunity found for siteId: ${siteId}, auditId: ${auditId}`,
    );
    return notFound('Readability opportunity not found');
  }

  // Process different response formats from Mystique
  let mappedSuggestions = [];

  // Check if we have direct improved paragraph data (single response)
  if (data?.improved_paragraph && data?.improved_flesch_score) {
    mappedSuggestions.push({
      id: `readability-opportunity-${auditId}-${messageId}`,
      pageUrl: data.pageUrl || auditUrl,
      originalText: data.original_paragraph,
      improvedText: data.improved_paragraph,
      originalFleschScore: data.current_flesch_score,
      improvedFleschScore: data.improved_flesch_score,
      seoRecommendation: data.seo_recommendation,
      aiRationale: data.ai_rationale,
      targetFleschScore: data.target_flesch_score,
      type: 'READABILITY_IMPROVEMENT',
    });
    log.info('[readability-opportunity guidance]: Processed single Mystique response with improved text');
  } else if (suggestions && Array.isArray(suggestions)) {
    // Handle batch response format
    mappedSuggestions = mapMystiqueSuggestionsToOpportunityFormat(suggestions);
    log.info(`[readability-opportunity guidance]: Processed ${suggestions.length} suggestions from batch response`);
  } else {
    log.warn(`[readability-opportunity guidance]: Unknown Mystique response format: ${JSON.stringify(data, null, 2)}`);
    return ok(); // Don't fail for unexpected format
  }

  if (mappedSuggestions.length === 0) {
    log.info('[readability-opportunity guidance]: No valid suggestions to process');
    return ok();
  }

  // Update existing suggestions with AI improvements
  const existingSuggestions = await readabilityOpportunity.getSuggestions();

  // Prepare update operations
  const updateOperations = mappedSuggestions.map((mystiquesuggestion) => {
    // Find matching suggestion by text preview (first 500 chars)
    const matchingSuggestion = existingSuggestions.find(
      (existing) => {
        const existingData = existing.getData();
        const mystiqueTextTruncated = mystiquesuggestion.originalText?.substring(0, 500);
        return existingData?.textPreview === mystiqueTextTruncated;
      },
    );

    if (matchingSuggestion) {
      return async () => {
        try {
          // Update the existing suggestion with AI improvements
          const currentData = matchingSuggestion.getData();
          const updatedData = {
            ...currentData,
            improvedText: mystiquesuggestion.improvedText,
            improvedFleschScore: mystiquesuggestion.improvedFleschScore,
            readabilityImprovement: mystiquesuggestion.improvedFleschScore
              - mystiquesuggestion.originalFleschScore,
            aiSuggestion: mystiquesuggestion.seoRecommendation,
            aiRationale: mystiquesuggestion.aiRationale,
            suggestionStatus: 'completed',
            mystiqueProcessingCompleted: new Date().toISOString(),
          };

          await matchingSuggestion.setData(updatedData);
          await matchingSuggestion.save();

          log.info(`[readability-opportunity guidance]: Updated suggestion ${matchingSuggestion.getId()} with AI improvements`);
          return true;
        } catch (error) {
          log.error(`[readability-opportunity guidance]: Error updating suggestion ${matchingSuggestion.getId()}: ${error.message}`);
          return false;
        }
      };
    }

    log.warn(`[readability-opportunity guidance]: No matching suggestion found for text: ${mystiquesuggestion.originalText?.substring(0, 100)}...`);
    return null;
  }).filter(Boolean);

  // Execute all updates in parallel
  const updateResults = await Promise.all(updateOperations.map((op) => op()));
  const updatedCount = updateResults.filter(Boolean).length;

  log.info(`[readability-opportunity guidance]: Successfully updated ${updatedCount} readability suggestions with AI improvements for siteId: ${siteId}`);

  return ok();
}
