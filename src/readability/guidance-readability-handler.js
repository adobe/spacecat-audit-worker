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
import { AsyncJob as AsyncJobEntity } from '@adobe/spacecat-shared-data-access';

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
      improvedText: `READ ${suggestion.improved_paragraph}`,
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
    Site, AsyncJob,
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

  // Get readability metadata from job instead of opportunity (preflight audit pattern)
  const jobMetadata = asyncJob.getMetadata() || {};
  const readabilityMetadata = jobMetadata.payload?.readabilityMetadata || {};

  if (!readabilityMetadata.originalOrderMapping) {
    const errorMsg = `[readability-suggest]: No readability metadata found in job ${auditId}. Data should be stored by async-mystique handler.`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Track processed suggestions in job metadata
  const processedSuggestionIds = new Set(readabilityMetadata.processedSuggestionIds || []);
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
      improvedText: `READ ${data.improved_paragraph}`,
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

  // Update job metadata with response tracking (preflight audit pattern)
  const updatedReadabilityMetadata = {
    ...readabilityMetadata,
    mystiqueResponsesReceived: (readabilityMetadata.mystiqueResponsesReceived || 0) + 1,
    mystiqueResponsesExpected: readabilityMetadata.mystiqueResponsesExpected || 0,
    totalReadabilityIssues: readabilityMetadata.totalReadabilityIssues || 0,
    processedSuggestionIds: [...processedSuggestionIds],
    lastMystiqueResponse: new Date().toISOString(),
    // Store suggestions directly in job metadata
    suggestions: [...(readabilityMetadata.suggestions || []), ...mappedSuggestions],
  };

  log.info(`[readability-suggest]: Received ${updatedReadabilityMetadata.mystiqueResponsesReceived}/${updatedReadabilityMetadata.mystiqueResponsesExpected} responses from Mystique for siteId: ${siteId}`);

  // Update job with accumulated data (preflight audit pattern)
  try {
    const updatedJobMetadata = {
      ...jobMetadata,
      payload: {
        ...jobMetadata.payload,
        readabilityMetadata: updatedReadabilityMetadata,
      },
    };
    asyncJob.setMetadata(updatedJobMetadata);
    await asyncJob.save();
    log.info('[readability-suggest]: Updated job with accumulated readability metadata');
  } catch (e) {
    log.error(`[readability-suggest]: Updating job metadata for job ${auditId} failed with error: ${e.message}`, e);
    throw new Error(`[readability-suggest]: Failed to update job metadata for job ${auditId}: ${e.message}`);
  }

  // For preflight audits, suggestions are stored in job metadata (not as opportunity suggestions)
  if (mappedSuggestions.length > 0) {
    log.info(`[readability-suggest]: Successfully processed ${mappedSuggestions.length} suggestions from Mystique for siteId: ${siteId}`);
  }

  // Check if all Mystique responses have been received and update AsyncJob if complete
  const allResponsesReceived = updatedReadabilityMetadata.mystiqueResponsesReceived
    >= updatedReadabilityMetadata.mystiqueResponsesExpected;
  if (allResponsesReceived && updatedReadabilityMetadata.mystiqueResponsesExpected > 0) {
    try {
      log.info(`[readability-suggest]: All ${updatedReadabilityMetadata.mystiqueResponsesExpected} `
        + `Mystique responses received. Updating AsyncJob ${auditId} to COMPLETED.`);

      // Use the AsyncJob we already validated earlier
      if (asyncJob) {
        // Get current job result
        const currentResult = asyncJob.getResult() || [];

        // Update the readability audit opportunities with the completed suggestions
        const updatedResult = currentResult.map((pageResult) => {
          if (pageResult.audits) {
            const updatedAudits = pageResult.audits.map((auditItem) => {
              if (auditItem.name === 'readability') {
                // Get all suggestions from job metadata (preflight audit pattern)
                const allSuggestions = updatedReadabilityMetadata.suggestions || [];

                // The AsyncJob may have 0 opportunities if cleared during async processing
                // We need to reconstruct them from the stored suggestions
                log.info(`[readability-suggest]: AsyncJob has ${auditItem.opportunities.length} readability opportunities stored`);
                log.info(`[readability-suggest]: Found ${allSuggestions.length} stored suggestions to use for reconstruction`);

                let opportunitiesToProcess = auditItem.opportunities;

                // If AsyncJob has no opportunities but we have suggestions,
                // reconstruct from suggestions (note: original order may be lost in this case)
                if (auditItem.opportunities.length === 0 && allSuggestions.length > 0) {
                  log.info(`[readability-suggest]: Reconstructing opportunities from ${allSuggestions.length} stored suggestions`);
                  opportunitiesToProcess = allSuggestions.map((suggestion, index) => {
                    log.info(`[readability-suggest]: Examining suggestion ${index}: ${JSON.stringify(suggestion, null, 2)}`);

                    // Suggestions are stored directly as objects (not wrapped in .getData())
                    if (suggestion) {
                      log.info(`[readability-suggest]: Found suggestion with originalText: "${suggestion.originalText?.substring(0, 50)}..."`);

                      const reconstructedOpportunity = {
                        check: 'poor-readability',
                        issue: `Text element is difficult to read: "${(suggestion.originalText || 'Unknown text')?.substring(0, 100)}..."`
                          .replace(/\n/g, ' '),
                        seoImpact: 'Moderate',
                        fleschReadingEase: suggestion.originalFleschScore || 0,
                        textContent: suggestion.originalText,
                        seoRecommendation: 'Improve readability by using shorter sentences, '
                          + 'simpler words, and clearer structure',
                      };

                      log.info(`[readability-suggest]: Successfully reconstructed opportunity: ${JSON.stringify(reconstructedOpportunity, null, 2)}`);
                      return reconstructedOpportunity;
                    } else {
                      log.warn(`[readability-suggest]: No valid suggestion found at index ${index}`);
                    }
                    return null;
                  }).filter(Boolean);
                  log.info(`[readability-suggest]: Reconstructed ${opportunitiesToProcess.length} `
                    + 'opportunities from suggestions');
                }

                // Get stored original order mapping from job metadata,
                // or create from current order as fallback
                const storedOrderMapping = updatedReadabilityMetadata.originalOrderMapping;

                let originalOrder;
                if (storedOrderMapping && Array.isArray(storedOrderMapping)) {
                  // Use stored original order mapping from identify step
                  log.info(`[readability-suggest]: Using stored original order mapping with ${storedOrderMapping.length} items`);
                  originalOrder = storedOrderMapping;
                } else {
                  // Fallback: create from current order (may not match original identify order)
                  log.warn('[readability-suggest]: No stored order mapping found, using current order as fallback');
                  originalOrder = opportunitiesToProcess.map((opp, index) => ({
                    textContent: opp.textContent,
                    originalIndex: index,
                  }));
                }

                const updatedOpportunities = opportunitiesToProcess.map((opportunity) => {
                  log.info('[readability-suggest]: Looking for suggestion matching opportunity text: '
                    + `"${opportunity.textContent?.substring(0, 80)}..."`);
                  log.info(`[readability-suggest]: Found ${allSuggestions.length} stored suggestions`);

                  const matchingSuggestion = allSuggestions.find((suggestion) => {
                    log.info('[readability-suggest]: Checking suggestion with data: '
                      + `${JSON.stringify(suggestion, null, 2)}`);

                    // Suggestions are stored directly as objects (not wrapped in .getData())
                    if (suggestion) {
                      log.info(`[readability-suggest]: Comparing "${suggestion.originalText?.substring(0, 80)}..."`
                          + ` vs "${opportunity.textContent?.substring(0, 80)}..."`);
                      return suggestion.originalText === opportunity.textContent;
                    }
                    return false;
                  });

                  if (matchingSuggestion) {
                    // Suggestions are stored directly as objects
                    const recommendation = matchingSuggestion;

                    const updatedOpportunity = {
                      ...opportunity,
                      suggestionStatus: 'completed',
                      suggestionMessage: 'AI-powered readability improvement '
                        + 'generated successfully.',
                      // originalText: recommendation.originalText,
                      // originalFleschScore: opportunity.fleschReadingEase,
                      improvedFleschScore: Math.round(
                        recommendation.improvedFleschScore * 100,
                      ) / 100,
                      readabilityImprovement: Math.round((recommendation.improvedFleschScore
                        - (recommendation.originalFleschScore
                          || opportunity.fleschReadingEase)) * 100) / 100,
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

                // Sort updatedOpportunities back to original order based on textContent
                const sortedOpportunities = updatedOpportunities.sort((a, b) => {
                  const aOriginalIndex = originalOrder.find(
                    (item) => item.textContent === a.textContent,
                  )?.originalIndex ?? Number.MAX_SAFE_INTEGER;
                  const bOriginalIndex = originalOrder.find(
                    (item) => item.textContent === b.textContent,
                  )?.originalIndex ?? Number.MAX_SAFE_INTEGER;
                  return aOriginalIndex - bOriginalIndex;
                });

                log.info(`[readability-suggest]: Sorted ${sortedOpportunities.length} opportunities back to original order`);

                return { ...auditItem, opportunities: sortedOpportunities };
              }
              return auditItem;
            });

            return { ...pageResult, audits: updatedAudits };
          }
          return pageResult;
        });

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
