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
import { AsyncJob as AsyncJobEntity, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
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
      seoRecommendation: suggestion.seo_recommendation,
      aiRationale: suggestion.ai_rationale,
      targetFleschScore: suggestion.target_flesch_score,
    };
  });
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Opportunity, Site, AsyncJob,
  } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;
  const { suggestions } = data || {};

  log.info(`[readability-suggest]: Received Mystique guidance for readability: ${JSON.stringify(message, null, 2)}`);

  // For preflight audits, auditId is actually a jobId (AsyncJob ID), not an Audit entity ID
  // We'll validate the AsyncJob exists later when we try to update it
  log.info(`[readability-suggest]: Processing guidance for auditId: ${auditId} (AsyncJob ID), siteId: ${siteId}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[readability-suggest]: Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }
  const auditUrl = site.getBaseURL();

  log.info(`[readability-suggest]: Processing suggestions for ${siteId} and auditUrl: ${auditUrl}`);

  // Validate that the AsyncJob (preflight job) exists
  const asyncJob = await AsyncJob.findById(auditId);
  if (!asyncJob) {
    log.error(`[readability-suggest]: AsyncJob not found for auditId: ${auditId}. This may indicate the preflight job was deleted or expired.`);
    return notFound('AsyncJob not found');
  }
  log.info(`[readability-suggest]: Found AsyncJob with status: ${asyncJob.getStatus()}`);

  let readabilityOppty;
  try {
    const opportunities = await Opportunity.allBySiteId(siteId);
    readabilityOppty = opportunities.find(
      (oppty) => oppty.getAuditId() === auditId && oppty.getData()?.subType === 'readability',
    );
  } catch (e) {
    log.error(`[readability-suggest]: Fetching opportunities for siteId ${siteId} failed with error: ${e.message}`);
    throw new Error(`[readability-suggest]: Failed to fetch opportunities for siteId ${siteId}: ${e.message}`);
  }

  if (!readabilityOppty) {
    const errorMsg = `[readability-suggest]: No existing opportunity found for siteId ${siteId}. Opportunity should be created by main handler before processing suggestions.`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  const existingData = readabilityOppty.getData() || {};
  const processedSuggestionIds = new Set(existingData.processedSuggestionIds || []);
  if (processedSuggestionIds.has(messageId)) {
    log.info(`[readability-suggest]: Suggestions with id ${messageId} already processed. Skipping processing.`);
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
    log.warn(`[readability-suggest]: No valid readability improvements found in Mystique response for siteId: ${siteId}`);
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

  log.info(`[readability-suggest]: Received ${updatedOpportunityData.mystiqueResponsesReceived}/${updatedOpportunityData.mystiqueResponsesExpected} responses from Mystique for siteId: ${siteId}`);

  // Update opportunity with accumulated data
  try {
    readabilityOppty.setAuditId(auditId);
    readabilityOppty.setData(updatedOpportunityData);
    readabilityOppty.setUpdatedBy('system');
    await readabilityOppty.save();
    log.info('[readability-suggest]: Updated opportunity with accumulated data');
  } catch (e) {
    log.error(`[readability-suggest]: Updating opportunity for siteId ${siteId} failed with error: ${e.message}`, e);
    throw new Error(`[readability-suggest]: Failed to update opportunity for siteId ${siteId}: ${e.message}`);
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

    log.info(`[readability-suggest]: Successfully processed ${mappedSuggestions.length} suggestions from Mystique for siteId: ${siteId}`);
  }

  // Check if all Mystique responses have been received and update AsyncJob if complete
  const allResponsesReceived = updatedOpportunityData.mystiqueResponsesReceived
    >= updatedOpportunityData.mystiqueResponsesExpected;
  if (allResponsesReceived && updatedOpportunityData.mystiqueResponsesExpected > 0) {
    try {
      log.info(`[readability-suggest]: All ${updatedOpportunityData.mystiqueResponsesExpected} `
        + `Mystique responses received. Updating AsyncJob ${auditId} to COMPLETED.`);

      // Use the AsyncJob we already validated earlier
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

                // The AsyncJob may have 0 opportunities if cleared during async processing
                // We need to reconstruct them from the stored suggestions
                log.info(`[readability-suggest]: AsyncJob has ${auditItem.opportunities.length} readability opportunities stored`);
                log.info(`[readability-suggest]: Found ${allSuggestions.length} stored suggestions to use for reconstruction`);

                let opportunitiesToProcess = auditItem.opportunities;

                // If AsyncJob has no opportunities but we have suggestions,
                // reconstruct from suggestions
                if (auditItem.opportunities.length === 0 && allSuggestions.length > 0) {
                  log.info(`[readability-suggest]: Reconstructing opportunities from ${allSuggestions.length} stored suggestions`);
                  opportunitiesToProcess = allSuggestions.map((suggestion, index) => {
                    const suggestionData = suggestion.getData();
                    log.info(`[readability-suggest]: Examining suggestion ${index}: ${JSON.stringify(suggestionData, null, 2)}`);

                    const recommendation = suggestionData.recommendations?.[0];
                    if (recommendation) {
                      log.info(`[readability-suggest]: Found recommendation with originalText: "${recommendation.originalText?.substring(0, 50)}..."`);

                      const reconstructedOpportunity = {
                        check: 'poor-readability',
                        issue: `Text element is difficult to read: "${(recommendation.originalText || 'Unknown text')?.substring(0, 100)}..."`
                          .replace(/\n/g, ' '),
                        seoImpact: 'Moderate',
                        fleschReadingEase: recommendation.originalFleschScore || 0,
                        textContent: recommendation.originalText,
                        seoRecommendation: 'Improve readability by using shorter sentences, '
                          + 'simpler words, and clearer structure',
                      };

                      log.info(`[readability-suggest]: Successfully reconstructed opportunity: ${JSON.stringify(reconstructedOpportunity, null, 2)}`);
                      return reconstructedOpportunity;
                    } else {
                      log.warn(`[readability-suggest]: No recommendation found in suggestion ${index} - suggestionData structure: ${JSON.stringify(suggestionData, null, 2)}`);
                    }
                    return null;
                  }).filter(Boolean);
                  log.info(`[readability-suggest]: Reconstructed ${opportunitiesToProcess.length} `
                    + 'opportunities from suggestions');
                }

                const updatedOpportunities = opportunitiesToProcess.map((opportunity) => {
                  log.info('[readability-suggest]: Looking for suggestion matching opportunity text: '
                    + `"${opportunity.textContent?.substring(0, 80)}..."`);
                  log.info(`[readability-suggest]: Found ${allSuggestions.length} stored suggestions`);

                  const matchingSuggestion = allSuggestions.find((suggestion) => {
                    const suggestionData = suggestion.getData();
                    log.info('[readability-suggest]: Checking suggestion with data: '
                      + `${JSON.stringify(suggestionData, null, 2)}`);

                    // All suggestions are stored as { recommendations: [suggestion] }
                    const recommendation = suggestionData.recommendations?.[0];
                    if (recommendation) {
                      log.info(`[readability-suggest]: Comparing "${recommendation.originalText?.substring(0, 80)}..."`
                          + ` vs "${opportunity.textContent?.substring(0, 80)}..."`);
                      return recommendation.originalText === opportunity.textContent;
                    }
                    return false;
                  });

                  if (matchingSuggestion) {
                    const suggestionData = matchingSuggestion.getData();
                    // All suggestions use the standard format
                    const recommendation = suggestionData.recommendations[0];

                    const updatedOpportunity = {
                      ...opportunity,
                      suggestionStatus: 'completed',
                      suggestionMessage: 'AI-powered readability improvement '
                        + 'generated successfully.',
                      // originalText: recommendation.originalText,
                      // originalFleschScore: opportunity.fleschReadingEase,
                      improvedFleschScore: recommendation.improvedFleschScore,
                      readabilityImprovement: recommendation.improvedFleschScore
                        - (recommendation.originalFleschScore || opportunity.fleschReadingEase),
                      aiSuggestion: recommendation.improvedText,
                      aiRationale: recommendation.aiRationale,
                      mystiqueProcessingCompleted: new Date().toISOString(),
                    };

                    log.info(`[readability-suggest]: Updated opportunity with Mystique suggestions: ${JSON.stringify(updatedOpportunity, null, 2)}`);

                    return updatedOpportunity;
                  } else {
                    log.warn(`[readability-suggest]: No matching suggestion found for opportunity: "${opportunity.textContent?.substring(0, 80)}..."`);
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
        asyncJob.setStatus(AsyncJobEntity.Status.COMPLETED);
        asyncJob.setEndedAt(new Date().toISOString());
        await asyncJob.save();

        log.info(`[readability-suggest]: Successfully updated AsyncJob ${auditId} `
          + 'with completed readability suggestions');
      }
    } catch (error) {
      log.error(`[readability-suggest]: Error updating AsyncJob ${auditId} with completed suggestions: `
        + `${error.message}`, error);
      // Don't throw - the suggestions were still processed successfully
    }
  }

  log.info(`[readability-suggest]: Successfully processed Mystique guidance for siteId: ${siteId}`);
  return ok();
}
