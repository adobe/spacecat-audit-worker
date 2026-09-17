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
import { AsyncJob } from '@adobe/spacecat-shared-data-access';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { toElementTargets } from '../../preflight/utils/dom-selector.js';
import {
  READABILITY_PREFLIGHT_COMPLETION_PREFIX,
  READABILITY_PREFLIGHT_RESPONSE_PREFIX,
} from '../shared/constants.js';

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

export async function accumulateReadabilityResponse({
  s3Client,
  bucketName,
  asyncJob,
  auditId,
  messageId,
  mappedSuggestions,
  log,
}) {
  if (!s3Client || !bucketName) {
    throw new Error('[readability-suggest guidance]: Missing S3 context for response accumulation');
  }

  const responsePrefix = `${READABILITY_PREFLIGHT_RESPONSE_PREFIX}/${auditId}/`;
  const responseKey = `${responsePrefix}${encodeURIComponent(messageId)}.json`;

  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: responseKey,
    Body: JSON.stringify({ messageId, mappedSuggestions }),
    ContentType: 'application/json',
  }));

  const listResponse = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: responsePrefix,
  }));
  const responseKeys = (listResponse.Contents || []).map(({ Key }) => Key).filter(Boolean);
  const jobMetadata = asyncJob.getMetadata();
  const { readabilityMetadata } = jobMetadata.payload;
  const responsesExpected = readabilityMetadata.mystiqueResponsesExpected || 0;
  const storedResponseIds = readabilityMetadata.processedSuggestionIds || [];
  const s3ResponseIds = responseKeys.map((key) => decodeURIComponent(
    key.slice(responsePrefix.length, -'.json'.length),
  ));
  const storedResponseIdSet = new Set(storedResponseIds);
  const newS3ResponseIds = s3ResponseIds.filter((id) => !storedResponseIdSet.has(id));
  const storedResponseCount = Math.max(
    readabilityMetadata.mystiqueResponsesReceived || 0,
    storedResponseIds.length,
  );
  const responseCount = storedResponseCount + newS3ResponseIds.length;

  log.debug(`[readability-suggest guidance]: Received ${responseCount}/${responsesExpected} responses from Mystique`);

  let responses = [];
  if (responseCount >= responsesExpected && responsesExpected > 0) {
    responses = await Promise.all(responseKeys.map(async (Key) => {
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key,
      }));
      return JSON.parse(await response.Body.transformToString());
    }));
    responses = responses.filter(({ messageId: id }) => !storedResponseIdSet.has(id));
  }

  return {
    asyncJob,
    responseKeys,
    readabilityMetadata: {
      ...readabilityMetadata,
      mystiqueResponsesReceived: responseCount,
      mystiqueResponsesExpected: responsesExpected,
      totalReadabilityIssues: readabilityMetadata.totalReadabilityIssues || 0,
      processedSuggestionIds: [
        ...storedResponseIds,
        ...responses.map(({ messageId: id }) => id),
      ],
      lastMystiqueResponse: new Date().toISOString(),
      suggestions: [
        ...(readabilityMetadata.suggestions || []),
        ...responses.flatMap(({ mappedSuggestions: responseSuggestions }) => (
          responseSuggestions || []
        )),
      ],
    },
  };
}

export default async function handler(message, context) {
  const {
    log, dataAccess, s3Client, env,
  } = context;
  const {
    Site, AsyncJob: AsyncJobEntity,
  } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;
  const { suggestions } = data || {};

  log.debug(`[readability-suggest guidance]: Received Mystique guidance for readability: ${JSON.stringify(message, null, 2)}`);

  // For preflight audits, auditId is actually a jobId (AsyncJob ID), not an Audit entity ID
  // We'll validate the AsyncJob exists later when we try to update it
  log.debug(`[readability-suggest guidance]: Processing guidance for auditId: ${auditId} (AsyncJob ID), siteId: ${siteId}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[readability-suggest guidance]: Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }
  const auditUrl = site.getBaseURL();

  log.debug(`[readability-suggest guidance]: Processing suggestions for ${siteId} and auditUrl: ${auditUrl}`);

  // Validate that the AsyncJob (preflight job) exists
  const asyncJob = await AsyncJobEntity.findById(auditId);
  if (!asyncJob) {
    log.error(`[readability-suggest guidance]: AsyncJob not found for auditId: ${auditId}. This may indicate the preflight job was deleted or expired.`);
    return notFound('AsyncJob not found');
  }
  log.debug(`[readability-suggest guidance]: Found AsyncJob with status: ${asyncJob.getStatus()}`);

  if (asyncJob.getStatus() === AsyncJob.Status.COMPLETED) {
    log.info(`[readability-suggest guidance]: AsyncJob ${auditId} is already completed. Skipping processing.`);
    return ok();
  }

  // Get readability metadata from job instead of opportunity (preflight audit pattern)
  const jobMetadata = asyncJob.getMetadata() || {};
  const readabilityMetadata = jobMetadata.payload?.readabilityMetadata || {};

  if (!readabilityMetadata.originalOrderMapping) {
    const errorMsg = `[readability-suggest guidance]: No readability metadata found in job ${auditId}. Data should be stored by async-mystique handler.`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  if (readabilityMetadata.processedSuggestionIds?.includes(messageId)) {
    log.info(`[readability-suggest guidance]: Suggestions with id ${messageId} already processed. Skipping processing.`);
    return ok();
  }

  // Process different response formats from Mystique
  let mappedSuggestions = [];

  // Classifier exclusions still produce a row so AsyncJob result merge can mark them excluded
  const isAiExcluded = data?.should_exclude === true;

  if (isAiExcluded) {
    log.info(`[readability-suggest guidance]: Content excluded by AI classifier for siteId: ${siteId}, reason: ${data.exclusion_reason}`);
    const originalParagraph = data?.original_paragraph != null ? String(data.original_paragraph).trim() : '';
    if (originalParagraph !== '') {
      mappedSuggestions.push({
        id: `readability-${auditId}-${messageId}`,
        pageUrl: data.pageUrl || auditUrl,
        originalText: data.original_paragraph,
        shouldExclude: true,
        exclusionReason: data.exclusion_reason,
        suggestionStatus: 'excluded',
      });
    } else {
      log.warn(`[readability-suggest guidance]: Excluded Mystique response missing original_paragraph; cannot attach excluded row for siteId: ${siteId}`);
    }
  } else if (data?.improved_paragraph && data?.improved_flesch_score) {
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
    mappedSuggestions = mapMystiqueSuggestionsToOpportunityFormat(suggestions);
  } else if (data?.guidance && data.guidance.length > 0) {
    mappedSuggestions = mapMystiqueSuggestionsToOpportunityFormat(data.guidance);
  }

  // For classifier exclusions without attachable paragraph, still persist response counts below
  if (mappedSuggestions.length === 0 && !isAiExcluded) {
    log.warn(`[readability-suggest guidance]: No valid readability improvements found in Mystique response for siteId: ${siteId}`);
  }

  const accumulated = await accumulateReadabilityResponse({
    s3Client,
    bucketName: env?.S3_MYSTIQUE_BUCKET_NAME,
    asyncJob,
    auditId,
    messageId,
    mappedSuggestions,
    log,
  });
  const {
    asyncJob: accumulatedJob,
    responseKeys,
    readabilityMetadata: updatedReadabilityMetadata,
  } = accumulated;
  log.debug('[readability-suggest guidance]: Updated job with accumulated readability metadata');

  // For preflight audits, suggestions are stored in job metadata (not as opportunity suggestions)
  if (mappedSuggestions.length > 0) {
    log.debug(`[readability-suggest guidance]: Successfully processed ${mappedSuggestions.length} suggestions from Mystique for siteId: ${siteId}`);
  }

  // Check if all Mystique responses have been received and update AsyncJob if complete
  const allResponsesReceived = updatedReadabilityMetadata.mystiqueResponsesReceived
    >= updatedReadabilityMetadata.mystiqueResponsesExpected;
  if (allResponsesReceived && updatedReadabilityMetadata.mystiqueResponsesExpected > 0) {
    const completionKey = `${READABILITY_PREFLIGHT_COMPLETION_PREFIX}/${auditId}.lock`;
    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: env.S3_MYSTIQUE_BUCKET_NAME,
        Key: completionKey,
        Body: new Date().toISOString(),
        ContentType: 'text/plain',
        IfNoneMatch: '*',
      }));
    } catch (error) {
      if (error.name === 'PreconditionFailed' || error.$metadata?.httpStatusCode === 412) {
        const claim = await s3Client.send(new GetObjectCommand({
          Bucket: env.S3_MYSTIQUE_BUCKET_NAME,
          Key: completionKey,
        }));
        const claimedAt = Date.parse(await claim.Body.transformToString());
        if (Number.isFinite(claimedAt) && Date.now() - claimedAt > 5 * 60 * 1000) {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: env.S3_MYSTIQUE_BUCKET_NAME,
            Key: completionKey,
          }));
          throw new Error(`[readability-suggest guidance]: Removed stale completion claim for AsyncJob ${auditId}; retrying`);
        }
        throw new Error(`[readability-suggest guidance]: Completion is already in progress for AsyncJob ${auditId}`);
      }
      throw error;
    }

    try {
      log.debug(`[readability-suggest guidance]: All ${updatedReadabilityMetadata.mystiqueResponsesExpected} `
        + `Mystique responses received. Updating AsyncJob ${auditId} to COMPLETED.`);

      // Use the AsyncJob we already validated earlier
      if (asyncJob) {
        // Get current job result
        const currentResult = accumulatedJob.getResult() || [];

        // Update the readability audit opportunities with the completed suggestions
        const updatedResult = currentResult.map((pageResult) => {
          if (pageResult.audits) {
            const updatedAudits = pageResult.audits.map((auditItem) => {
              if (auditItem.name === 'readability') {
                // Get all suggestions from job metadata for merge (preflight audit pattern)
                const allSuggestions = updatedReadabilityMetadata.suggestions;

                // The AsyncJob may have 0 opportunities if cleared during async processing
                // We need to reconstruct them from the stored suggestions
                log.debug(`[readability-suggest guidance]: AsyncJob has ${auditItem.opportunities.length} readability opportunities stored`);
                log.debug(`[readability-suggest guidance]: Found ${allSuggestions.length} stored suggestions to use for reconstruction`);

                let opportunitiesToProcess = auditItem.opportunities;

                // If AsyncJob has no opportunities but we have suggestions,
                // reconstruct from suggestions (note: original order may be lost in this case)
                if (auditItem.opportunities.length === 0 && allSuggestions.length > 0) {
                  log.debug(`[readability-suggest guidance]: Reconstructing opportunities from ${allSuggestions.length} stored suggestions`);
                  opportunitiesToProcess = allSuggestions.map((suggestion, index) => {
                    log.debug(`[readability-suggest guidance]: Examining suggestion ${index}: ${JSON.stringify(suggestion, null, 2)}`);

                    // Suggestions are stored directly as objects (not wrapped in .getData())
                    if (suggestion) {
                      log.debug(`[readability-suggest guidance]: Found suggestion with originalText: "${suggestion.originalText?.substring(0, 50)}..."`);

                      const reconstructedOpportunity = {
                        check: 'poor-readability',
                        issue: `Text element is difficult to read: "${(suggestion.originalText || 'Unknown text')?.substring(0, 100)}..."`
                          .replace(/\n/g, ' '),
                        seoImpact: 'Moderate',
                        fleschReadingEase: suggestion.originalFleschScore || 0,
                        // Passage lives once in elements[].textContent (no top-level duplicate).
                        // No selector — the suggest step reconstructs from AI output with no DOM.
                        ...toElementTargets({ textContent: suggestion.originalText }),
                        seoRecommendation: 'Improve readability by using shorter sentences, '
                          + 'simpler words, and clearer structure',
                      };

                      log.debug(`[readability-suggest guidance]: Successfully reconstructed opportunity: ${JSON.stringify(reconstructedOpportunity, null, 2)}`);
                      return reconstructedOpportunity;
                    } else {
                      log.warn(`[readability-suggest guidance]: No valid suggestion found at index ${index}`);
                    }
                    return null;
                  }).filter(Boolean);
                  log.debug(`[readability-suggest guidance]: Reconstructed ${opportunitiesToProcess.length} `
                    + 'opportunities from suggestions');
                }

                // Get stored original order mapping from job metadata,
                // or create from current order as fallback
                const storedOrderMapping = updatedReadabilityMetadata.originalOrderMapping;

                let originalOrder;
                if (storedOrderMapping && Array.isArray(storedOrderMapping)) {
                  // Use stored original order mapping from identify step
                  log.debug(`[readability-suggest guidance]: Using stored original order mapping with ${storedOrderMapping.length} items`);
                  originalOrder = storedOrderMapping;
                } else {
                  // Fallback: create from current order (may not match original identify order)
                  log.warn('[readability-suggest guidance]: No stored order mapping found, using current order as fallback');
                  originalOrder = opportunitiesToProcess.map((opp, index) => ({
                    textContent: opp.elements?.[0]?.textContent,
                    originalIndex: index,
                  }));
                }

                const updatedOpportunities = opportunitiesToProcess.map((opportunity) => {
                  log.debug('[readability-suggest guidance]: Looking for suggestion matching opportunity text: '
                    + `"${opportunity.elements?.[0]?.textContent?.substring(0, 80)}..."`);
                  log.debug(`[readability-suggest guidance]: Found ${allSuggestions.length} stored suggestions`);

                  const matchingSuggestion = allSuggestions.find((suggestion) => {
                    log.debug('[readability-suggest guidance]: Checking suggestion with data: '
                      + `${JSON.stringify(suggestion, null, 2)}`);

                    // Suggestions are stored directly as objects (not wrapped in .getData())
                    if (suggestion) {
                      log.debug(`[readability-suggest guidance]: Comparing "${suggestion.originalText?.substring(0, 80)}..."`
                          + ` vs "${opportunity.elements?.[0]?.textContent?.substring(0, 80)}..."`);
                      return suggestion.originalText === opportunity.elements?.[0]?.textContent;
                    }
                    return false;
                  });

                  if (matchingSuggestion) {
                    // Suggestions are stored directly as objects
                    const recommendation = matchingSuggestion;
                    const isExcluded = recommendation.shouldExclude === true
                      || recommendation.suggestionStatus === 'excluded';

                    if (isExcluded) {
                      const exclusionReason = recommendation.exclusionReason
                        ?? recommendation.exclusion_reason;

                      const updatedOpportunity = {
                        ...opportunity,
                        suggestionStatus: 'excluded',
                        suggestionMessage: exclusionReason
                          ? `Excluded from AI readability improvement: ${exclusionReason}`
                          : 'Excluded from AI readability improvement.',
                        exclusionReason,
                        mystiqueProcessingCompleted: new Date().toISOString(),
                        shouldExclude: true,
                      };

                      log.debug(`[readability-suggest guidance]: Updated opportunity with excluded readability row: ${JSON.stringify(updatedOpportunity, null, 2)}`);

                      return updatedOpportunity;
                    }

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

                    log.debug(`[readability-suggest guidance]: Updated opportunity with Mystique suggestions: ${JSON.stringify(updatedOpportunity, null, 2)}`);

                    return updatedOpportunity;
                  } else {
                    log.warn(`[readability-suggest guidance]: No matching suggestion found for opportunity: "${opportunity.elements?.[0]?.textContent?.substring(0, 80)}..."`);
                  }

                  return opportunity;
                });

                // Sort updatedOpportunities back to original order based on textContent
                const sortedOpportunities = updatedOpportunities.sort((a, b) => {
                  const aOriginalIndex = originalOrder.find(
                    (item) => item.textContent === a.elements?.[0]?.textContent,
                  )?.originalIndex ?? Number.MAX_SAFE_INTEGER;
                  const bOriginalIndex = originalOrder.find(
                    (item) => item.textContent === b.elements?.[0]?.textContent,
                  )?.originalIndex ?? Number.MAX_SAFE_INTEGER;
                  return aOriginalIndex - bOriginalIndex;
                });

                log.debug(`[readability-suggest guidance]: Sorted ${sortedOpportunities.length} opportunities back to original order`);

                return { ...auditItem, opportunities: sortedOpportunities };
              }
              return auditItem;
            });

            return { ...pageResult, audits: updatedAudits };
          }
          return pageResult;
        });

        // Reload job before saving to avoid stale updatedAt conflicts
        const freshAsyncJob = await AsyncJobEntity.findById(auditId);

        // Use updatedResult directly instead of asyncJob.getResult()
        // After asyncJob.save() at the metadata step, the entity may reset
        // internal state causing getResult() to return the stale (empty) result
        freshAsyncJob.setResult(updatedResult);

        // Persist completion progress without copying the transient S3 suggestion buffer.
        const freshMetadata = freshAsyncJob.getMetadata();
        const completedReadabilityMetadata = { ...updatedReadabilityMetadata };
        delete completedReadabilityMetadata.suggestions;
        freshAsyncJob.setMetadata({
          ...freshMetadata,
          payload: {
            ...freshMetadata.payload,
            readabilityMetadata: completedReadabilityMetadata,
          },
        });

        if (freshAsyncJob.getStatus() !== AsyncJob.Status.COMPLETED) {
          freshAsyncJob.setStatus(AsyncJob.Status.COMPLETED);
          freshAsyncJob.setEndedAt(new Date().toISOString());
        }

        await freshAsyncJob.save();

        log.debug(`[readability-suggest guidance]: Successfully updated AsyncJob ${auditId} `
          + 'with completed readability suggestions');
      }
    } catch (error) {
      log.error(`[readability-suggest guidance]: Error updating AsyncJob ${auditId} with completed suggestions: `
        + `${error.message}`, error);
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: env.S3_MYSTIQUE_BUCKET_NAME,
          Key: completionKey,
        }));
      } catch (cleanupError) {
        log.error(`[readability-suggest guidance]: Failed to release completion claim for AsyncJob ${auditId}: ${cleanupError.message}`);
      }
      throw error;
    }

    try {
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: env.S3_MYSTIQUE_BUCKET_NAME,
        Delete: {
          Objects: [...responseKeys, completionKey].map((Key) => ({ Key })),
          Quiet: true,
        },
      }));
      log.debug(`[readability-suggest guidance]: Cleaned up ${responseKeys.length} response objects for AsyncJob ${auditId}`);
    } catch (cleanupError) {
      log.warn(`[readability-suggest guidance]: Failed to clean up response objects for AsyncJob ${auditId}: ${cleanupError.message}`);
    }
  }

  log.debug(`[readability-suggest guidance]: Successfully processed Mystique guidance for siteId: ${siteId}`);
  return ok();
}
