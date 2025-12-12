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

import { AVIF_COMPRESSION_RATIO, WEBP_COMPRESSION_RATIO } from '../constants.js';
import { verifyDmFormats } from '../dm-format-verifier.js';

/**
 * Checks format optimization using compression ratio estimates
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null
 */
function checkFormatEstimation(imageData) {
  const {
    src, format, isAvif, isWebp, fileSize, naturalWidth, naturalHeight,
  } = imageData;

  // Already using modern format
  if (isAvif) {
    return null;
  }

  // Calculate potential savings
  const recommendedFormat = 'avif';
  let projectedSize = fileSize;
  let savingsBytes = 0;
  let savingsPercent = 0;

  if (!fileSize || fileSize === 0) {
    return null; // Can't calculate savings without file size
  }

  if (isWebp) {
    // WebP to AVIF conversion
    projectedSize = Math.round(fileSize * (AVIF_COMPRESSION_RATIO / WEBP_COMPRESSION_RATIO));
    savingsBytes = fileSize - projectedSize;
    savingsPercent = Math.round((savingsBytes / fileSize) * 100);
  } else if (format === 'jpeg' || format === 'jpg' || format === 'png') {
    // JPEG/PNG to AVIF conversion
    const ratio = format === 'png' ? AVIF_COMPRESSION_RATIO : AVIF_COMPRESSION_RATIO;
    projectedSize = Math.round(fileSize * ratio);
    savingsBytes = fileSize - projectedSize;
    savingsPercent = Math.round((savingsBytes / fileSize) * 100);
  } else {
    return null; // Unknown format or can't optimize
  }

  // Only suggest if savings are significant (> 10%)
  if (savingsPercent < 10) {
    return null;
  }

  return {
    type: 'format-optimization',
    severity: 'medium',
    impact: savingsBytes > 100000 ? 'high' : 'medium', // High impact if > 100KB savings
    title: `Convert ${format.toUpperCase()} to ${recommendedFormat.toUpperCase()}`,
    description: `Image can be converted to ${recommendedFormat.toUpperCase()} format for better compression`,
    imageUrl: src,
    currentFormat: format,
    recommendedFormat,
    currentSize: fileSize,
    projectedSize,
    savingsBytes,
    savingsPercent,
    dimensions: `${naturalWidth}x${naturalHeight}`,
    recommendation: `Convert image to ${recommendedFormat.toUpperCase()} format to save ${savingsPercent}% (${Math.round(savingsBytes / 1024)}KB)`,
    verificationMethod: 'estimation',
  };
}

/**
 * Checks DM image format optimization using real HEAD requests
 * @param {Object} imageData - Image data from scraper
 * @param {Object} log - Logger
 * @returns {Promise<Object|null>} Suggestion object or null
 */
async function checkDmFormatOptimization(imageData, log) {
  try {
    const verification = await verifyDmFormats(imageData.src, log);

    // If there are recommendations from the verifier
    if (verification.recommendations && verification.recommendations.length > 0) {
      const rec = verification.recommendations[0];

      return {
        type: 'format-detection',
        severity: rec.savingsPercent > 30 ? 'high' : 'medium',
        impact: rec.savingsBytes > 100000 ? 'high' : 'medium',
        title: `Convert to ${rec.recommendedFormat?.toUpperCase() || 'AVIF'}`,
        description: rec.message,
        imageUrl: imageData.src,
        currentFormat: rec.currentFormat,
        recommendedFormat: rec.recommendedFormat,
        currentSize: rec.currentSize,
        projectedSize: rec.recommendedSize,
        savingsBytes: rec.savingsBytes,
        savingsPercent: rec.savingsPercent,
        dimensions: `${imageData.naturalWidth}x${imageData.naturalHeight}`,
        recommendation: rec.message,
        verificationMethod: 'real-dm-check',
        formatComparison: verification.formats, // Include all format comparisons
      };
    }

    return null;
  } catch (error) {
    log.warn(`[format-checker] DM verification failed for ${imageData.src}, falling back to estimation: ${error.message}`);
    return checkFormatEstimation(imageData);
  }
}

/**
 * Checks if image format can be optimized to AVIF or WebP
 * For Dynamic Media images, uses real format verification.
 * For other images, uses compression ratio estimates.
 *
 * @param {Object} imageData - Image data from scraper
 * @param {Object} log - Logger (optional, for DM verification)
 * @returns {Object|null|Promise<Object|null>} Suggestion object or null if no optimization needed
 */
export function checkFormatDetection(imageData, log = null) {
  // If it's a Dynamic Media image and we have a logger, use real verification
  if (imageData.isDynamicMedia && log) {
    return checkDmFormatOptimization(imageData, log);
  }

  // Otherwise, use estimation logic
  return checkFormatEstimation(imageData);
}
