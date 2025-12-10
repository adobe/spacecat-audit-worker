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

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE}]: No audit found for auditId: ${auditId}`);
    return notFound();
  }

  await Site.findById(siteId);

  // Find and validate opportunity
  let imageOptOppty;
  try {
    imageOptOppty = await validateAndGetOpportunity(Opportunity, siteId, log);
  } catch (e) {
    log.error(`[${AUDIT_TYPE}]: ${e.message}`);
    throw e;
  }

  // Check for duplicate processing
  const existingData = imageOptOppty.getData() || {};
  if (isAlreadyProcessed(existingData, messageId)) {
    log.info(`[${AUDIT_TYPE}]: Analysis ${messageId} already processed. Skipping.`);
    return ok();
  }

  // Process image analysis results
  const hasResults = imageAnalysisResults
    && Array.isArray(imageAnalysisResults)
    && imageAnalysisResults.length > 0;

  if (hasResults) {
    // Convert results to suggestions
    const mappedSuggestions = mapAnalysisResultsToSuggestionDTOs(
      imageAnalysisResults,
      imageOptOppty.getId(),
    );

    // Add suggestions to opportunity
    await addImageOptimizationSuggestions({
      opportunity: imageOptOppty,
      newSuggestionDTOs: mappedSuggestions,
      log,
    });

    // Calculate and update aggregate metrics
    const metrics = calculateAggregateMetrics(imageAnalysisResults);

    await updateOpportunityMetrics(
      imageOptOppty,
      metrics,
      messageId,
      auditId,
    );

    // Log summary
    const sizeMB = (metrics.totalSavings / 1024 / 1024).toFixed(2);
    log.debug(`[${AUDIT_TYPE}]: Processed ${metrics.totalImages} images, found ${metrics.totalIssues} total issues`);
    log.debug(`[${AUDIT_TYPE}]: ${metrics.dynamicMediaCount} using Dynamic Media, ${metrics.avifCount} already AVIF`);
    log.debug(`[${AUDIT_TYPE}]: Issue breakdown: ${JSON.stringify(metrics.issueBreakdown)}`);
    log.debug(`[${AUDIT_TYPE}]: Total potential savings: ${sizeMB} MB (${metrics.savingsPercent}%)`);
  } else {
    log.info(`[${AUDIT_TYPE}]: No image analysis results to process for siteId: ${siteId}`);
  }

  return ok();
}
