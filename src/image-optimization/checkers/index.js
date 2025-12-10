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
import { checkCdnDelivery } from './cdn-checker.js';
import { checkCacheControlHeaders } from './cache-checker.js';
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
  checkCdnDelivery,
  checkCacheControlHeaders,
  checkBlurryOrUpscaled,
};

/**
 * Runs all image optimization checks on a single image
 * @param {Object} imageData - Image data from scraper
 * @param {Array<string>} enabledChecks - Optional list of enabled checks
 *                                         (runs all if not specified)
 * @returns {Array<Object>} Array of suggestion objects
 */
export function runAllChecks(imageData, enabledChecks = null) {
  const checkers = [
    { name: 'format', fn: checkFormatDetection },
    { name: 'oversized', fn: checkOversizedImage },
    { name: 'responsive', fn: checkResponsiveImages },
    { name: 'picture', fn: checkPictureElement },
    { name: 'dimensions', fn: checkMissingDimensions },
    { name: 'lazy-loading', fn: checkLazyLoading },
    { name: 'file-type', fn: checkWrongFileType },
    { name: 'svg', fn: checkSvgOpportunity },
    { name: 'cdn', fn: checkCdnDelivery },
    { name: 'cache', fn: checkCacheControlHeaders },
    { name: 'upscaled', fn: checkBlurryOrUpscaled },
  ];

  const suggestions = [];

  checkers.forEach((checker) => {
    // Skip if check is not enabled
    if (enabledChecks && !enabledChecks.includes(checker.name)) {
      return;
    }

    try {
      const result = checker.fn(imageData);
      if (result) {
        suggestions.push(result);
      }
    } catch (error) {
      // Silently skip failed checkers - errors are handled gracefully
      // in production, logging should be handled by the caller
    }
  });

  return suggestions;
}
