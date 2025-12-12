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
    return null;
  }

  if (!log) {
    return null;
  }

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
        formatComparison: verification.formats,
      };
    }

    return null;
  } catch (error) {
    log.warn(`[format-checker] DM verification failed for ${imageData.src}: ${error.message}`);
    return null;
  }
}
