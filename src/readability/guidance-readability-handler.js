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
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { addReadabilitySuggestions } from './opportunity-handler.js';

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
      aiSuggestion: suggestion.seo_recommendation,
      aiRationale: suggestion.ai_rationale,
      targetFleschScore: suggestion.target_flesch_score,
    };
  });
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Opportunity, Site, Audit, AsyncJob,
  } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;
  const { suggestions } = data || {};

  log.info(`[read-suggest]: Received Mystique guidance for readability: ${JSON.stringify(message, null, 2)}`);

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[read-suggest]: No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const site = await Site.findById(siteId);
  const auditUrl = site.getBaseURL();

  log.info(`[read-suggest]: Processing suggestions for ${siteId} and auditUrl: ${auditUrl}`);

  let readabilityOppty;
  try {
    const opportunities = await Opportunity.allBySiteId(siteId);
    readabilityOppty = opportunities.find(
      (oppty) => oppty.getAuditId() === auditId && oppty.getData()?.subType === 'readability',
    );
  } catch (e) {
    log.error(`[read-suggest]: Fetching opportunities for siteId ${siteId} failed with error: ${e.message}`);
    throw new Error(`[read-suggest]: Failed to fetch opportunities for siteId ${siteId}: ${e.message}`);
  }

  if (!readabilityOppty) {
    const errorMsg = `[read-suggest]: No existing opportunity found for siteId ${siteId}. Opportunity should be created by main handler before processing suggestions.`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  const existingData = readabilityOppty.getData() || {};
  const processedSuggestionIds = new Set(existingData.processedSuggestionIds || []);
  if (processedSuggestionIds.has(messageId)) {
    log.info(`[read-suggest]: Suggestions with id ${messageId} already processed. Skipping processing.`);
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
      aiSuggestion: data.seo_recommendation,
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
    log.warn(`[read-suggest]: No valid readability improvements found in Mystique response for siteId: ${siteId}`);
    return ok();
  }

  // Update opportunity data
  const updatedOpportunityData = {
    ...existingData,
    mystiqueResponsesReceived: (existingData.mystiqueResponsesReceived || 0) + 1,
    mystiqueResponsesExpected: existingData.mystiqueResponsesExpected || 0,
    totalReadabilityIssues: mappedSuggestions.length,
    processedSuggestionIds: [...processedSuggestionIds],
    lastMystiqueResponse: new Date().toISOString(),
  };

  log.info(`[read-suggest]: Received ${updatedOpportunityData.mystiqueResponsesReceived}/${updatedOpportunityData.mystiqueResponsesExpected} responses from Mystique for siteId: ${siteId}`);

  // Update opportunity with accumulated data
  try {
    readabilityOppty.setAuditId(auditId);
    readabilityOppty.setData(updatedOpportunityData);
    readabilityOppty.setUpdatedBy('system');
    await readabilityOppty.save();
    log.info('[read-suggest]: Updated opportunity with accumulated data');
  } catch (e) {
    log.error(`[read-suggest]: Updating opportunity for siteId ${siteId} failed with error: ${e.message}`, e);
    throw new Error(`[read-suggest]: Failed to update opportunity for siteId ${siteId}: ${e.message}`);
  }

  // Process suggestions from Mystique
  if (mappedSuggestions.length > 0) {
    await addReadabilitySuggestions({
      opportunity: readabilityOppty,
      newSuggestionDTOs: mappedSuggestions.map((suggestion) => ({
        opportunityId: readabilityOppty.getId(),
        type: SuggestionModel.TYPES.CONTENT_UPDATE,
        data: { recommendations: [suggestion] },
        rank: 1,
      })),
      log,
    });

    log.info(`[read-suggest]: Successfully processed ${mappedSuggestions.length} suggestions from Mystique for siteId: ${siteId}`);
  } else {
    log.info(`[read-suggest]: No suggestions to process for siteId: ${siteId}`);
  }

  // Check if all Mystique responses have been received and update AsyncJob if complete
  const allResponsesReceived = updatedOpportunityData.mystiqueResponsesReceived
    >= updatedOpportunityData.mystiqueResponsesExpected;
  if (allResponsesReceived && updatedOpportunityData.mystiqueResponsesExpected > 0) {
    try {
      log.info(`[read-suggest]: All ${updatedOpportunityData.mystiqueResponsesExpected} `
        + `Mystique responses received. Updating AsyncJob ${auditId} to COMPLETED.`);

      // Find the AsyncJob (auditId is the jobId for preflight audits)
      const asyncJob = await AsyncJob.findById(auditId);
      if (asyncJob) {
        // Get current job result
        const currentResult = asyncJob.getResult() || [];

        // Update the readability audit opportunities with the completed suggestions
        const updatedResult = await Promise.all(currentResult.map(async (pageResult) => {
          if (pageResult.audits) {
            const updatedAudits = await Promise.all(pageResult.audits.map(async (auditItem) => {
              if (auditItem.name === 'readability') {
                // Get all suggestions for this opportunity
                const allSuggestions = await readabilityOppty.getSuggestions();

                // Update opportunities with suggestion data
                const updatedOpportunities = auditItem.opportunities.map((opportunity) => {
                  const matchingSuggestion = allSuggestions.find((suggestion) => {
                    const suggestionData = suggestion.getData();
                    const recommendations = suggestionData.data?.recommendations || [];
                    return recommendations.some((rec) => rec.originalText
                      === opportunity.textContent);
                  });

                  if (matchingSuggestion) {
                    const suggestionData = matchingSuggestion.getData();
                    const recommendation = suggestionData.data?.recommendations?.[0] || {};

                    return {
                      ...opportunity,
                      suggestionStatus: 'completed',
                      suggestionMessage: 'AI-powered readability improvement '
                        + 'generated successfully. DOGADOGADOGA',
                      originalText: recommendation.originalText,
                      improvedText: recommendation.improvedText,
                      originalFleschScore: opportunity.fleschReadingEase,
                      improvedFleschScore: recommendation.improvedFleschScore,
                      readabilityImprovement: recommendation.improvedFleschScore
                        - (recommendation.originalFleschScore || opportunity.fleschReadingEase),
                      aiSuggestion: recommendation.aiSuggestion,
                      aiRationale: recommendation.aiRationale,
                      mystiqueProcessingCompleted: new Date().toISOString(),
                    };
                  }

                  return opportunity;
                });

                return { ...auditItem, opportunities: updatedOpportunities };
              }
              return auditItem;
            }));

            return { ...pageResult, audits: updatedAudits };
          }
          return pageResult;
        }));

        // Update AsyncJob with completed results
        asyncJob.setResult(updatedResult);
        asyncJob.setStatus('COMPLETED');
        asyncJob.setEndedAt(new Date().toISOString());
        await asyncJob.save();

        log.info(`[read-suggest]: Successfully updated AsyncJob ${auditId} `
          + 'with completed readability suggestions');
      } else {
        log.warn(`[read-suggest]: AsyncJob ${auditId} not found when trying to update `
          + 'with completed suggestions');
      }
    } catch (error) {
      log.error(`[read-suggest]: Error updating AsyncJob ${auditId} with completed suggestions: `
        + `${error.message}`, error);
      // Don't throw - the suggestions were still processed successfully
    }
  }

  log.info(`[read-suggest]: Successfully processed Mystique guidance for siteId: ${siteId}`);
  return ok();
}
