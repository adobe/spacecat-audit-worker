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
import {
  addImageOptimizationSuggestions,
  isDynamicMedia,
} from './opportunityHandler.js';
import { runAllChecks } from './checkers/index.js';
import {
  batchVerifyDmFormats,
  createVerificationSummary,
} from './dm-format-verifier.js';
import {
  batchVerifyNonDmFormats,
  createNonDmVerificationSummary,
} from './non-dm-format-verifier.js';

const AUDIT_TYPE = 'image-optimization';

/**
 * Converts raw analyzer results into structured suggestion DTOs.
 * Runs all image optimization checks and creates suggestions for each detected issue.
 *
 * @param {Array} imageAnalysisResults - Array of image analysis results from analyzer
 * @param {string} opportunityId - The opportunity ID to associate suggestions with
 * @returns {Array} Array of suggestion DTOs ready for creation
 */
function mapAnalysisResultsToSuggestionDTOs(imageAnalysisResults, opportunityId) {
  const allSuggestions = [];

  imageAnalysisResults.forEach((result) => {
    // Prepare image data for checkers (normalize field names from scraper format)
    const imageData = {
      src: result.imageUrl,
      xpath: result.xpath,
      alt: result.alt,
      isDynamicMedia: isDynamicMedia(result.imageUrl),
      format: result.format || result.currentFormat,
      isAvif: result.isAvif || result.currentFormat === 'avif',
      isWebp: result.isWebp || result.currentFormat === 'webp',
      fileSize: result.fileSize || result.currentSize,
      naturalWidth: result.naturalWidth,
      naturalHeight: result.naturalHeight,
      renderedWidth: result.renderedWidth,
      renderedHeight: result.renderedHeight,
      containerWidth: result.containerWidth,
      containerHeight: result.containerHeight,
      containerTag: result.containerTag,
      position: result.position,
      isOversized: result.isOversized,
      oversizeRatio: result.oversizeRatio,
      suggestedWidth: result.suggestedWidth,
      suggestedHeight: result.suggestedHeight,
      hasLazyLoading: result.hasLazyLoading,
      hasWidthAttribute: result.hasWidthAttribute,
      hasHeightAttribute: result.hasHeightAttribute,
      srcset: result.srcset,
      sizes: result.sizes,
      hasPictureElement: result.hasPictureElement,
      responseHeaders: result.responseHeaders,
    };

    // Run all optimization checks
    const issues = runAllChecks(imageData);

    // Create a suggestion for each detected issue
    issues.forEach((issue) => {
      const suggestionId = `${result.pageUrl}/${result.imageUrl}/${issue.type}`;

      // Calculate rank based on severity and impact
      const rankMap = { high: 100, medium: 50, low: 25 };
      const severityRank = rankMap[issue.severity] || 0;
      const impactRank = rankMap[issue.impact] || 0;
      const rank = severityRank + impactRank;

      allSuggestions.push({
        opportunityId,
        type: SuggestionModel.TYPES.CONTENT_UPDATE,
        data: {
          id: suggestionId,
          pageUrl: result.pageUrl,
          imageUrl: result.imageUrl,
          issueType: issue.type,
          severity: issue.severity,
          impact: issue.impact,
          title: issue.title,
          description: issue.description,
          recommendation: issue.recommendation,
          xpath: result.xpath || null,
          // Include all issue-specific data
          ...issue,
        },
        rank, // Higher rank = higher priority
      });
    });
  });

  return allSuggestions;
}

/**
 * Calculates aggregate metrics from image analysis results.
 * Aggregates data for opportunity-level reporting across all issue types.
 *
 * @param {Array} imageAnalysisResults - Array of image analysis results
 * @returns {Object} Aggregated metrics object
 */
function calculateAggregateMetrics(imageAnalysisResults) {
  const totalImages = imageAnalysisResults.length;
  const dynamicMediaCount = imageAnalysisResults.filter((r) => isDynamicMedia(r.imageUrl)).length;
  const avifCount = imageAnalysisResults.filter(
    (r) => r.isAvif || r.currentFormat === 'avif',
  ).length;

  // Count issues by type
  const issueTypeCounts = {
    formatOptimization: 0,
    oversized: 0,
    missingResponsive: 0,
    missingDimensions: 0,
    missingLazyLoading: 0,
    wrongFileType: 0,
    upscaled: 0,
    other: 0,
  };

  let totalSavings = 0;
  let totalIssues = 0;

  imageAnalysisResults.forEach((result) => {
    const imageData = {
      src: result.imageUrl,
      isDynamicMedia: isDynamicMedia(result.imageUrl),
      format: result.format || result.currentFormat,
      isAvif: result.isAvif || result.currentFormat === 'avif',
      isWebp: result.isWebp || result.currentFormat === 'webp',
      fileSize: result.fileSize || result.currentSize,
      naturalWidth: result.naturalWidth,
      naturalHeight: result.naturalHeight,
      renderedWidth: result.renderedWidth,
      renderedHeight: result.renderedHeight,
      isOversized: result.isOversized,
      oversizeRatio: result.oversizeRatio,
      suggestedWidth: result.suggestedWidth,
      suggestedHeight: result.suggestedHeight,
      hasLazyLoading: result.hasLazyLoading,
      hasWidthAttribute: result.hasWidthAttribute,
      hasHeightAttribute: result.hasHeightAttribute,
      srcset: result.srcset,
      position: result.position,
    };

    // Run checks and count issues
    const issues = runAllChecks(imageData);
    totalIssues += issues.length;

    issues.forEach((issue) => {
      // Count by type
      if (issue.type === 'format-optimization') issueTypeCounts.formatOptimization += 1;
      else if (issue.type === 'oversized-image') issueTypeCounts.oversized += 1;
      else if (issue.type === 'missing-responsive-images') issueTypeCounts.missingResponsive += 1;
      else if (issue.type === 'missing-dimensions') issueTypeCounts.missingDimensions += 1;
      else if (issue.type === 'missing-lazy-loading') issueTypeCounts.missingLazyLoading += 1;
      else if (issue.type === 'wrong-file-type') issueTypeCounts.wrongFileType += 1;
      else if (issue.type === 'upscaled-image') issueTypeCounts.upscaled += 1;
      else issueTypeCounts.other += 1;

      // Accumulate savings if present
      if (issue.savingsBytes) {
        totalSavings += issue.savingsBytes;
      } else if (issue.estimatedSavings) {
        totalSavings += issue.estimatedSavings;
      }
    });
  });

  const totalCurrentSize = imageAnalysisResults.reduce(
    (acc, result) => acc + (result.currentSize || result.fileSize || 0),
    0,
  );

  const savingsPercent = totalCurrentSize > 0
    ? Math.round((totalSavings / totalCurrentSize) * 100)
    : 0;

  return {
    totalImages,
    totalIssues,
    dynamicMediaCount,
    nonDynamicMediaCount: totalImages - dynamicMediaCount,
    avifCount,
    totalSavings,
    savingsPercent,
    issueBreakdown: issueTypeCounts,
  };
}

/**
 * Validates that required opportunity exists for processing results.
 * Ensures data integrity by checking for existing opportunity.
 *
 * @param {Object} Opportunity - Opportunity model from dataAccess
 * @param {string} siteId - Site identifier
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} The found opportunity
 * @throws {Error} If opportunity not found
 */
async function validateAndGetOpportunity(Opportunity, siteId, log) {
  const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
  const imageOptOppty = opportunities.find(
    (oppty) => oppty.getType() === AUDIT_TYPE,
  );

  if (!imageOptOppty) {
    const errorMsg = `[${AUDIT_TYPE}]: No existing opportunity found for siteId ${siteId}. `
      + 'Opportunity should be created by main handler before processing results.';
    log.error(errorMsg);
    throw new Error(errorMsg);
  }

  return imageOptOppty;
}

/**
 * Checks if this analysis has already been processed.
 * Prevents duplicate processing of the same results.
 *
 * @param {Object} opportunityData - Current opportunity data
 * @param {string} messageId - Message identifier
 * @returns {boolean} True if already processed
 */
function isAlreadyProcessed(opportunityData, messageId) {
  const processedAnalysisIds = new Set(opportunityData.processedAnalysisIds || []);
  return processedAnalysisIds.has(messageId);
}

/**
 * Updates opportunity with new metrics from analysis results.
 * Incrementally updates aggregate metrics as batches are processed.
 *
 * @param {Object} opportunity - The opportunity to update
 * @param {Object} metrics - New metrics to add
 * @param {string} messageId - Message identifier to mark as processed
 * @param {string} auditId - Audit identifier
 * @returns {Promise<void>}
 */
async function updateOpportunityMetrics(opportunity, metrics, messageId, auditId) {
  const existingData = opportunity.getData() || {};
  const processedAnalysisIds = new Set(existingData.processedAnalysisIds || []);

  // Merge issue breakdowns
  const existingBreakdown = existingData.issueBreakdown || {};
  const newBreakdown = {};
  const allKeys = new Set([
    ...Object.keys(existingBreakdown),
    ...Object.keys(metrics.issueBreakdown || {}),
  ]);

  allKeys.forEach((key) => {
    newBreakdown[key] = (existingBreakdown[key] || 0) + (metrics.issueBreakdown?.[key] || 0);
  });

  const updatedOpportunityData = {
    ...existingData,
    totalImages: (existingData.totalImages || 0) + metrics.totalImages,
    totalIssues: (existingData.totalIssues || 0) + metrics.totalIssues,
    dynamicMediaImages: (existingData.dynamicMediaImages || 0) + metrics.dynamicMediaCount,
    nonDynamicMediaImages: (existingData.nonDynamicMediaImages || 0) + metrics.nonDynamicMediaCount,
    issueBreakdown: newBreakdown,
    avifImages: (existingData.avifImages || 0) + metrics.avifCount,
    potentialSavingsBytes: (existingData.potentialSavingsBytes || 0) + metrics.totalSavings,
    potentialSavingsPercent: metrics.savingsPercent,
    analyzerResponsesReceived: (existingData.analyzerResponsesReceived || 0) + 1,
    processedAnalysisIds: [...processedAnalysisIds, messageId],
  };

  opportunity.setAuditId(auditId);
  opportunity.setData(updatedOpportunityData);
  opportunity.setUpdatedBy('system');
  await opportunity.save();
}

/**
 * Main handler for processing image optimization guidance messages.
 * Receives and processes image analysis results from external analyzer.
 *
 * @param {Object} message - Message from analyzer containing image analysis results
 * @param {Object} context - Context object with dataAccess and log
 * @returns {Promise<Response>} HTTP response (ok or notFound)
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Opportunity, Site, Audit,
  } = dataAccess;
  const {
    auditId, siteId, data, id: messageId,
  } = message;
  const { imageAnalysisResults } = data || {};

  log.info(`[${AUDIT_TYPE}]: 🔵 GUIDANCE HANDLER CALLED`);
  log.info(`[${AUDIT_TYPE}]: MessageId: ${messageId}`);
  log.info(`[${AUDIT_TYPE}]: AuditId: ${auditId}, SiteId: ${siteId}`);
  log.info(`[${AUDIT_TYPE}]: Message type: ${message.type}`);
  log.info(`[${AUDIT_TYPE}]: Has imageAnalysisResults: ${!!imageAnalysisResults}`);
  if (imageAnalysisResults) {
    log.info(`[${AUDIT_TYPE}]: Number of images in results: ${imageAnalysisResults.length}`);
  }

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE}]: ❌ No audit found for auditId: ${auditId}`);
    return notFound();
  }
  log.info(`[${AUDIT_TYPE}]: ✅ Audit found`);

  await Site.findById(siteId);
  log.info(`[${AUDIT_TYPE}]: ✅ Site found`);

  // Find and validate opportunity
  let imageOptOppty;
  try {
    log.info(`[${AUDIT_TYPE}]: Looking for existing opportunity...`);
    imageOptOppty = await validateAndGetOpportunity(Opportunity, siteId, log);
    log.info(`[${AUDIT_TYPE}]: ✅ Found opportunity: ${imageOptOppty.getId()}`);
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: ❌ Failed to find opportunity: ${e.message}`);
    throw e;
  }

  // Check for duplicate processing
  const existingData = imageOptOppty.getData() || {};
  log.info(`[${AUDIT_TYPE}]: Checking for duplicate processing...`);
  log.info(`[${AUDIT_TYPE}]: Processed IDs so far: ${JSON.stringify(existingData.processedAnalysisIds || [])}`);

  if (isAlreadyProcessed(existingData, messageId)) {
    log.info(`[${AUDIT_TYPE}]: ⚠️  Analysis ${messageId} already processed. Skipping.`);
    return ok();
  }
  log.info(`[${AUDIT_TYPE}]: ✅ Not a duplicate, proceeding...`);

  // Process image analysis results
  const hasResults = imageAnalysisResults
    && Array.isArray(imageAnalysisResults)
    && imageAnalysisResults.length > 0;

  if (hasResults) {
    log.info(`[${AUDIT_TYPE}]: ✅ Has results! Processing ${imageAnalysisResults.length} images...`);

    // Convert results to suggestions
    log.info(`[${AUDIT_TYPE}]: Step 1: Mapping analysis results to suggestion DTOs...`);
    const mappedSuggestions = mapAnalysisResultsToSuggestionDTOs(
      imageAnalysisResults,
      imageOptOppty.getId(),
    );
    log.info(`[${AUDIT_TYPE}]: ✅ Created ${mappedSuggestions.length} suggestion DTOs`);

    // Step 2: Verify DM images for actual format savings
    log.info(`[${AUDIT_TYPE}]: Step 2: Verifying image formats for actual savings...`);

    // Prepare images for verification
    const imagesForVerification = imageAnalysisResults.map((result) => ({
      src: result.imageUrl,
      pageUrl: result.pageUrl,
      xpath: result.xpath,
      alt: result.alt,
      isDynamicMedia: isDynamicMedia(result.imageUrl),
      naturalWidth: result.naturalWidth,
      naturalHeight: result.naturalHeight,
      renderedWidth: result.renderedWidth,
      renderedHeight: result.renderedHeight,
    }));

    // Separate DM and non-DM images
    const dmImages = imagesForVerification.filter((img) => img.isDynamicMedia);
    const nonDmImages = imagesForVerification.filter((img) => !img.isDynamicMedia);

    log.info(`[${AUDIT_TYPE}]: Found ${dmImages.length} DM images and ${nonDmImages.length} non-DM images`);

    // Verify DM images (fast - just HEAD requests)
    let dmVerificationSummary = null;
    if (dmImages.length > 0) {
      try {
        log.info(`[${AUDIT_TYPE}]: Verifying ${dmImages.length} DM images...`);
        const dmResults = await batchVerifyDmFormats(dmImages, log, { concurrency: 5 });
        dmVerificationSummary = createVerificationSummary(dmResults);

        // Add verified DM suggestions
        dmResults.forEach((result) => {
          if (result.recommendations && result.recommendations.length > 0) {
            const rec = result.recommendations[0];
            const suggestionId = `${result.pageUrl}|${result.originalUrl}|dm-format-verified`;
            const savingsRank = rec.savingsPercent > 50 ? 150 : 100;

            mappedSuggestions.push({
              opportunityId: imageOptOppty.getId(),
              type: SuggestionModel.TYPES.CONTENT_UPDATE,
              data: {
                id: suggestionId,
                pageUrl: result.pageUrl,
                imageUrl: result.originalUrl,
                issueType: 'dm-format-optimization-verified',
                severity: rec.savingsPercent > 50 ? 'high' : 'medium',
                impact: rec.savingsPercent > 50 ? 'high' : 'medium',
                title: `Verified: ${rec.message}`,
                description: `Actual format comparison shows ${rec.recommendedFormat.toUpperCase()} is optimal.`,
                recommendation: rec.message,
                xpath: result.xpath || null,
                verified: true,
                currentFormat: rec.currentFormat,
                recommendedFormat: rec.recommendedFormat,
                currentSize: rec.currentSize,
                recommendedSize: rec.recommendedSize,
                savingsBytes: rec.savingsBytes,
                savingsPercent: rec.savingsPercent,
                recommendedUrl: rec.recommendedUrl,
                formatComparison: result.formats,
              },
              rank: savingsRank,
            });
          }
        });

        log.info(`[${AUDIT_TYPE}]: ✅ DM verification complete: ${dmVerificationSummary.imagesWithRecommendations} with recommendations`);
      } catch (dmError) {
        log.warn(`[${AUDIT_TYPE}]: ⚠️ DM verification failed: ${dmError.message}`);
      }
    }

    // Verify non-DM images (slower - requires upload to Scene7)
    let nonDmVerificationSummary = null;
    if (nonDmImages.length > 0) {
      try {
        log.info(`[${AUDIT_TYPE}]: Verifying ${nonDmImages.length} non-DM images via Scene7 Snapshot...`);
        const nonDmResults = await batchVerifyNonDmFormats(nonDmImages, log, {
          concurrency: 2,
        });
        nonDmVerificationSummary = createNonDmVerificationSummary(nonDmResults);

        // Add verified non-DM suggestions
        nonDmResults.forEach((result) => {
          if (result.success && result.recommendations && result.recommendations.length > 0) {
            const rec = result.recommendations[0];
            const suggestionId = `${result.pageUrl}|${result.originalUrl}|non-dm-format-verified`;
            const savingsRank = rec.savingsPercent > 50 ? 150 : 100;

            mappedSuggestions.push({
              opportunityId: imageOptOppty.getId(),
              type: SuggestionModel.TYPES.CONTENT_UPDATE,
              data: {
                id: suggestionId,
                pageUrl: result.pageUrl,
                imageUrl: result.originalUrl,
                issueType: 'non-dm-format-optimization-verified',
                severity: rec.savingsPercent > 50 ? 'high' : 'medium',
                impact: rec.savingsPercent > 50 ? 'high' : 'medium',
                title: `Verified: ${rec.message}`,
                description: `Scene7 format comparison shows ${rec.recommendedFormat.toUpperCase()} is optimal.`,
                recommendation: rec.message,
                xpath: result.xpath || null,
                verified: true,
                currentFormat: rec.currentFormat,
                recommendedFormat: rec.recommendedFormat,
                currentSize: rec.currentSize,
                recommendedSize: rec.recommendedSize,
                savingsBytes: rec.savingsBytes,
                savingsPercent: rec.savingsPercent,
                previewUrl: result.previewUrl,
                previewExpiry: result.previewExpiry,
                recommendedUrl: rec.previewUrl,
                formatComparison: result.formats,
              },
              rank: savingsRank,
            });
          }
        });

        log.info(`[${AUDIT_TYPE}]: ✅ Non-DM verification complete: ${nonDmVerificationSummary.imagesWithRecommendations} with recommendations`);
      } catch (nonDmError) {
        log.warn(`[${AUDIT_TYPE}]: ⚠️ Non-DM verification failed: ${nonDmError.message}`);
      }
    }

    if (mappedSuggestions.length > 0) {
      log.info(`[${AUDIT_TYPE}]: Sample suggestion: ${JSON.stringify(mappedSuggestions[0], null, 2)}`);
    }

    // Add suggestions to opportunity
    log.info(`[${AUDIT_TYPE}]: Step 3: Adding suggestions to opportunity...`);
    await addImageOptimizationSuggestions({
      opportunity: imageOptOppty,
      newSuggestionDTOs: mappedSuggestions,
      log,
    });
    log.info(`[${AUDIT_TYPE}]: ✅ Suggestions added successfully`);

    // Calculate and update aggregate metrics
    log.info(`[${AUDIT_TYPE}]: Step 4: Calculating aggregate metrics...`);
    const metrics = calculateAggregateMetrics(imageAnalysisResults);

    // Add verification metrics
    if (dmVerificationSummary) {
      metrics.dmVerification = {
        imagesVerified: dmVerificationSummary.totalImagesVerified,
        withRecommendations: dmVerificationSummary.imagesWithRecommendations,
        verifiedSavingsKB: dmVerificationSummary.totalPotentialSavingsKB,
      };
    }
    if (nonDmVerificationSummary) {
      metrics.nonDmVerification = {
        imagesProcessed: nonDmVerificationSummary.totalImagesProcessed,
        successful: nonDmVerificationSummary.successfulVerifications,
        withRecommendations: nonDmVerificationSummary.imagesWithRecommendations,
        verifiedSavingsKB: nonDmVerificationSummary.totalPotentialSavingsKB,
      };
    }

    log.info(`[${AUDIT_TYPE}]: ✅ Metrics calculated: ${JSON.stringify(metrics, null, 2)}`);

    log.info(`[${AUDIT_TYPE}]: Step 5: Updating opportunity metrics...`);
    await updateOpportunityMetrics(
      imageOptOppty,
      metrics,
      messageId,
      auditId,
    );
    log.info(`[${AUDIT_TYPE}]: ✅ Opportunity metrics updated`);

    // Log summary
    const sizeMB = (metrics.totalSavings / 1024 / 1024).toFixed(2);
    log.info(`[${AUDIT_TYPE}]: ═══════════════════════════════════════════`);
    log.info(`[${AUDIT_TYPE}]: 📊 PROCESSING SUMMARY`);
    log.info(`[${AUDIT_TYPE}]: Processed ${metrics.totalImages} images`);
    log.info(`[${AUDIT_TYPE}]: Found ${metrics.totalIssues} total issues`);
    log.info(`[${AUDIT_TYPE}]: Created ${mappedSuggestions.length} suggestions`);
    log.info(`[${AUDIT_TYPE}]: ${metrics.dynamicMediaCount} using Dynamic Media`);
    log.info(`[${AUDIT_TYPE}]: ${metrics.avifCount} already AVIF`);
    log.info(`[${AUDIT_TYPE}]: Issue breakdown: ${JSON.stringify(metrics.issueBreakdown)}`);
    log.info(`[${AUDIT_TYPE}]: Total estimated savings: ${sizeMB} MB (${metrics.savingsPercent}%)`);
    if (metrics.dmVerification) {
      log.info(`[${AUDIT_TYPE}]: DM Verified: ${metrics.dmVerification.withRecommendations} images, ${metrics.dmVerification.verifiedSavingsKB} KB savings`);
    }
    if (metrics.nonDmVerification) {
      log.info(`[${AUDIT_TYPE}]: Non-DM Verified: ${metrics.nonDmVerification.withRecommendations} images, ${metrics.nonDmVerification.verifiedSavingsKB} KB savings`);
    }
    log.info(`[${AUDIT_TYPE}]: ═══════════════════════════════════════════`);
  } else {
    log.warn(`[${AUDIT_TYPE}]: ⚠️  No image analysis results to process for siteId: ${siteId}`);
    log.warn(`[${AUDIT_TYPE}]: Message data: ${JSON.stringify(data, null, 2)}`);
  }

  return ok();
}
