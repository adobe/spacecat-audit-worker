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
import { measureInfoGain, categorizeScore, analyzeContentTraits } from './information-gain.js';

/**
 * Guidance handler for information-gain content improvements from Mystique
 * Processes AI-generated improved content and updates the preflight job results
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Site, AsyncJob: AsyncJobEntity,
  } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;

  log.debug(`[information-gain guidance]: Received Mystique guidance: ${JSON.stringify(message, null, 2)}`);

  // For preflight audits, auditId is actually a jobId (AsyncJob ID)
  log.debug(`[information-gain guidance]: Processing guidance for auditId: ${auditId} (AsyncJob ID), siteId: ${siteId}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[information-gain guidance]: Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }
  const auditUrl = site.getBaseURL();

  log.debug(`[information-gain guidance]: Processing improvement for ${siteId} and auditUrl: ${auditUrl}`);

  // Validate that the AsyncJob (preflight job) exists
  const asyncJob = await AsyncJobEntity.findById(auditId);
  if (!asyncJob) {
    log.error(`[information-gain guidance]: AsyncJob not found for auditId: ${auditId}`);
    return notFound('AsyncJob not found');
  }
  log.debug(`[information-gain guidance]: Found AsyncJob with status: ${asyncJob.getStatus()}`);

  // Get information-gain metadata from job
  const jobMetadata = asyncJob.getMetadata() || {};
  const infoGainMetadata = jobMetadata.payload?.informationGainMetadata || {};

  if (!infoGainMetadata.originalOrderMapping) {
    const errorMsg = `[information-gain guidance]: No information-gain metadata found in job ${auditId}`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Track processed improvements
  const processedImprovementIds = new Set(infoGainMetadata.processedImprovementIds || []);
  if (processedImprovementIds.has(messageId)) {
    log.info(`[information-gain guidance]: Improvement with id ${messageId} already processed. Skipping.`);
    return ok();
  } else {
    processedImprovementIds.add(messageId);
  }

  // Extract improved content from Mystique response
  const improvedContent = data?.improved_content || data?.guidance || '';
  if (!improvedContent) {
    log.warn('[information-gain guidance]: No improved content found in Mystique response');
    return ok();
  }

  // Calculate new metrics for improved content
  const originalContent = data.original_content || '';
  const newMetrics = measureInfoGain(improvedContent, improvedContent);
  const newScoreCategory = categorizeScore(newMetrics.infogain_score);
  const newTraitScores = analyzeContentTraits(improvedContent);

  // Calculate improvement delta
  const improvementDelta = newMetrics.infogain_score - (data.current_score || 0);

  // Create improvement object
  const improvement = {
    id: `infogain-${data.pageUrl || 'unknown'}-${data.aspect}`,
    pageUrl: data.pageUrl,
    aspect: data.aspect,
    originalContent,
    improvedContent,
    originalScore: data.current_score,
    newScore: newMetrics.ten_point_score,
    newScoreCategory,
    improvementDelta: parseFloat(improvementDelta.toFixed(3)),
    newMetrics: {
      compression_ratio: newMetrics.compression_ratio.toFixed(2),
      semantic_similarity: newMetrics.semantic_similarity.toFixed(2),
      entity_preservation: newMetrics.entity_preservation.toFixed(2),
      fact_coverage: newMetrics.fact_coverage.toFixed(2),
      infogain_score: newMetrics.infogain_score.toFixed(2),
    },
    newTraitScores,
    seoImpact: data.seo_impact || 'Moderate',
    aiRationale: `Improved ${data.aspect} by ${improvementDelta > 0 ? 'increasing' : 'maintaining'} information density`,
  };

  // Update job metadata with the improvement
  const currentImprovements = infoGainMetadata.improvements || [];
  currentImprovements.push(improvement);

  const updatedMetadata = {
    ...infoGainMetadata,
    improvements: currentImprovements,
    mystiqueResponsesReceived: (infoGainMetadata.mystiqueResponsesReceived || 0) + 1,
    processedImprovementIds: Array.from(processedImprovementIds),
    lastMystiqueResponse: new Date().toISOString(),
  };

  jobMetadata.payload.informationGainMetadata = updatedMetadata;
  asyncJob.setMetadata(jobMetadata);

  // Check if all responses received
  const allReceived = updatedMetadata
    .mystiqueResponsesReceived >= updatedMetadata.mystiqueResponsesExpected;

  if (allReceived) {
    log.info(`[information-gain guidance]: All ${updatedMetadata.mystiqueResponsesExpected} Mystique responses received for job ${auditId}`);

    // Update job results with improvements
    const currentResult = asyncJob.getResult() || [];

    // Add improvements to each page's information-gain audit
    currentResult.forEach((pageResult) => {
      const infoGainAudit = pageResult.audits?.find((a) => a.name === 'information-gain');
      if (infoGainAudit) {
        // Find improvements for this page
        const pageImprovements = currentImprovements.filter(
          (imp) => imp.pageUrl === pageResult.pageUrl,
        );

        // Update opportunities with improvements
        infoGainAudit.opportunities.forEach((opp) => {
          if (opp.check === 'information-gain-analysis' && opp.weakAspects) {
            // Add improvements to each weak aspect
            // eslint-disable-next-line no-param-reassign
            opp.weakAspects = opp.weakAspects.map((aspect) => {
              // eslint-disable-next-line no-shadow
              const improvement = pageImprovements.find((imp) => imp.aspect === aspect.aspect);
              if (improvement) {
                return {
                  ...aspect,
                  improvedContent: improvement.improvedContent,
                  newScore: improvement.newScore,
                  newScoreCategory: improvement.newScoreCategory,
                  improvementDelta: improvement.improvementDelta,
                  newMetrics: improvement.newMetrics,
                  aiRationale: improvement.aiRationale,
                  suggestionStatus: 'completed',
                };
              }
              return aspect;
            });
          }
        });
      }
    });

    asyncJob.setResult(currentResult);

    // Mark job as completed if it's still in progress
    if (asyncJob.getStatus() === AsyncJob.Status.IN_PROGRESS) {
      asyncJob.setStatus(AsyncJob.Status.COMPLETED);
      asyncJob.setEndedAt(new Date().toISOString());
    }

    log.info(`[information-gain guidance]: Updated job ${auditId} with ${currentImprovements.length} improvements and marked as completed`);
  } else {
    log.info(
      `[information-gain guidance]: Received ${updatedMetadata.mystiqueResponsesReceived}/${updatedMetadata.mystiqueResponsesExpected} responses for job ${auditId}`,
    );
  }

  await asyncJob.save();

  return ok();
}

// Export helper functions for testing
export { measureInfoGain, categorizeScore, analyzeContentTraits };
