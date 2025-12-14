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

import { verifyDmFormats } from '../dm-format-verifier.js';

/**
 * Checks Dynamic Media image format optimization using real HEAD requests.
 * Only runs for Dynamic Media images.
 *
 * @param {Object} imageData - Image data from scraper
 * @param {Object} log - Logger
 * @returns {Promise<Object|null>} Suggestion object or null if no optimization needed
 */
export async function checkFormatDetection(imageData, log) {
  // Only check Dynamic Media images
  if (!imageData.isDynamicMedia) {
    if (log) {
      log.debug('[format-checker] Skipping non-DM image');
    }
    return null;
  }

  if (!log) {
    return null;
  }

  log.info(`[format-checker] 🔍 Checking DM format for: ${imageData.src}`);

  try {
    const verification = await verifyDmFormats(imageData.src, log);

    log.info(`[format-checker] Verification result: currentFormat=${verification.currentFormat}, smallestFormat=${verification.smallestFormat}, recommendations=${verification.recommendations.length}`);

    if (verification.formats) {
      log.debug(`[format-checker] Format comparison: ${JSON.stringify(verification.formats)}`);
    }

    // If there are recommendations from the verifier
    if (verification.recommendations && verification.recommendations.length > 0) {
      const rec = verification.recommendations[0];

      log.info(`[format-checker] ✅ Found optimization: ${rec.currentFormat} → ${rec.recommendedFormat}, savings: ${rec.savingsPercent}%`);

      return {
        type: 'format-detection',
        severity: rec.savingsPercent > 30 ? 'high' : 'medium',
        impact: rec.savingsBytes > 100000 ? 'high' : 'medium',
        title: `Convert to ${rec.recommendedFormat?.toUpperCase() || 'AVIF'}`,
        description: rec.message,
        imageUrl: imageData.src,
        currentFormat: rec.currentFormat,
        recommendedFormat: rec.recommendedFormat,
        recommendedUrl: rec.recommendedUrl,
        currentSize: rec.currentSize,
        projectedSize: rec.recommendedSize,
        savingsBytes: rec.savingsBytes,
        savingsPercent: rec.savingsPercent,
        dimensions: `${imageData.naturalWidth}x${imageData.naturalHeight}`,
        recommendation: rec.message,
        verificationMethod: 'real-dm-check',
        formatComparison: verification.formats,
        smartImagingAlternative: 'Alternatively, enable Smart Imaging by adding bfc=on parameter. This automatically converts images to the best format (AVIF, WebP, JPEG 2000, or JPEG XR) based on browser support.',
      };
    }

    log.info('[format-checker] ⚪ No optimization recommendations (image may already be optimized)');
    return null;
  } catch (error) {
    log.warn(`[format-checker] ❌ DM verification failed for ${imageData.src}: ${error.message}`);
    return null;
  }
}
