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

      // Calculate KB and MB for consistency
      const savingsKB = Math.round(rec.savingsBytes / 1024);
      const savingsMB = (rec.savingsBytes / 1024 / 1024).toFixed(2);

      // Determine severity and impact based on savings percentage (aligned with non-DM logic)
      let severity = 'low';
      let impact = 'low';
      if (rec.savingsPercent > 50) {
        severity = 'high';
        impact = 'high';
      } else if (rec.savingsPercent > 25) {
        severity = 'medium';
        impact = 'medium';
      }

      return {
        type: 'image-format-optimization',
        checkerType: 'format-detection',
        severity,
        impact,
        title: `Optimize to ${rec.recommendedFormat?.toUpperCase()} for ${rec.savingsPercent}% savings`,
        description: rec.message,
        recommendation: `Update image URL to use ?fmt=${rec.recommendedFormat} parameter to reduce file size by ${savingsKB} KB`,

        // Image location (unified)
        imageSrc: imageData.src,

        // Format optimization (unified)
        currentFormat: rec.currentFormat,
        recommendedFormat: rec.recommendedFormat,
        currentSize: rec.currentSize,
        projectedSize: rec.recommendedSize,

        // Savings (unified)
        savingsBytes: rec.savingsBytes,
        savingsKB,
        savingsMB,
        savingsPercent: rec.savingsPercent,

        // Suggested URL (unified)
        suggestedUrl: rec.recommendedUrl,
        suggestedUrlExpiry: null,

        // DM specific
        requiresMigration: false,
        verified: true,
        verificationMethod: 'dm-head-request',

        // Additional info
        dimensions: `${imageData.naturalWidth}x${imageData.naturalHeight}`,
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
