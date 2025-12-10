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

/**
 * Checks if image is upscaled (rendered larger than intrinsic size)
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if not upscaled
 */
export function checkBlurryOrUpscaled(imageData) {
  const {
    src,
    naturalWidth,
    naturalHeight,
    renderedWidth,
    renderedHeight,
    position,
  } = imageData;

  // Check if image is being upscaled (rendered size > natural size)
  const widthRatio = renderedWidth / naturalWidth;
  const heightRatio = renderedHeight / naturalHeight;
  const upscaleRatio = Math.max(widthRatio, heightRatio);

  // Only flag if significantly upscaled (>20%)
  if (upscaleRatio <= 1.2) {
    return null;
  }

  // Calculate how much larger the image needs to be
  const neededWidth = Math.ceil(renderedWidth * 1.5); // 1.5x for high-DPI displays
  const neededHeight = Math.ceil(renderedHeight * 1.5);

  return {
    type: 'upscaled-image',
    severity: upscaleRatio > 2 ? 'high' : 'medium',
    impact: position?.isAboveFold ? 'high' : 'medium',
    title: 'Image appears blurry (upscaled)',
    description: `Image is being displayed ${Math.round((upscaleRatio - 1) * 100)}% larger than its intrinsic size, causing blurriness`,
    imageUrl: src,
    naturalDimensions: `${naturalWidth}x${naturalHeight}`,
    renderedDimensions: `${renderedWidth}x${renderedHeight}`,
    recommendedDimensions: `${neededWidth}x${neededHeight}`,
    upscaleRatio: parseFloat(upscaleRatio.toFixed(2)),
    isAboveFold: position?.isAboveFold || false,
    recommendation: `Use a higher resolution image (at least ${neededWidth}x${neededHeight}) to avoid blurriness on high-DPI displays`,
  };
}
