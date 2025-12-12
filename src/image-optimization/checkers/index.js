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

import { checkFormatDetection } from './format-checker.js';
import { checkOversizedImage } from './oversized-checker.js';
import { checkResponsiveImages } from './responsive-checker.js';
import { checkPictureElement } from './picture-element-checker.js';
import { checkMissingDimensions } from './dimensions-checker.js';
import { checkLazyLoading } from './lazy-loading-checker.js';
import { checkWrongFileType } from './file-type-checker.js';
import { checkSvgOpportunity } from './svg-opportunity-checker.js';
import { checkBlurryOrUpscaled } from './upscaled-checker.js';

export {
  checkFormatDetection,
  checkOversizedImage,
  checkResponsiveImages,
  checkPictureElement,
  checkMissingDimensions,
  checkLazyLoading,
  checkWrongFileType,
  checkSvgOpportunity,
  checkBlurryOrUpscaled,
};

/**
 * Runs all image optimization checks on a single image
 * @param {Object} imageData - Image data from scraper
 * @param {Array<string>} enabledChecks - Optional list of enabled checks
 *                                         (runs all if not specified)
 * @param {Object} log - Logger object (optional, enables DM format verification)
 * @returns {Promise<Array<Object>>} Array of suggestion objects
 */
export async function runAllChecks(imageData, enabledChecks = null, log = null) {
  const checkers = [
    { name: 'format', fn: checkFormatDetection, async: true }, // Can be async for DM images
    { name: 'oversized', fn: checkOversizedImage },
    { name: 'responsive', fn: checkResponsiveImages },
    { name: 'picture', fn: checkPictureElement },
    { name: 'dimensions', fn: checkMissingDimensions },
    { name: 'lazy-loading', fn: checkLazyLoading },
    { name: 'file-type', fn: checkWrongFileType },
    { name: 'svg', fn: checkSvgOpportunity },
    { name: 'upscaled', fn: checkBlurryOrUpscaled },
  ];

  const suggestions = [];

  // Process checkers sequentially to handle async ones
  for (const checker of checkers) {
    // Skip if check is not enabled
    if (!enabledChecks || enabledChecks.includes(checker.name)) {
      try {
        // Pass log to format checker for DM verification
        const args = checker.name === 'format' ? [imageData, log] : [imageData];
        // eslint-disable-next-line no-await-in-loop
        const result = await checker.fn(...args);

        if (result) {
          suggestions.push(result);
        }
      } catch (error) {
        // Silently skip failed checkers - errors are handled gracefully
        // in production, logging should be handled by the caller
        if (log) {
          log.debug(`[runAllChecks] Checker ${checker.name} failed: ${error.message}`);
        }
      }
    }
  }

  return suggestions;
}
