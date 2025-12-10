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
 * Checks if image is oversized (intrinsic size larger than rendered size)
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if properly sized
 */
export function checkOversizedImage(imageData) {
  const {
    src,
    isOversized,
    oversizeRatio,
    naturalWidth,
    naturalHeight,
    renderedWidth,
    renderedHeight,
    suggestedWidth,
    suggestedHeight,
    fileSize,
    position,
  } = imageData;

  if (!isOversized) {
    return null;
  }

  // Parse oversizeRatio (comes as string like "1.92")
  const ratio = parseFloat(oversizeRatio);

  // Only flag if significantly oversized (ratio > 1.5)
  if (ratio < 1.5) {
    return null;
  }

  // Calculate potential savings (rough estimate: file size scales with pixel count)
  const currentPixels = naturalWidth * naturalHeight;
  const neededPixels = suggestedWidth * suggestedHeight;
  const pixelReduction = (currentPixels - neededPixels) / currentPixels;
  const estimatedSavings = fileSize ? Math.round(fileSize * pixelReduction) : 0;
  const savingsPercent = fileSize ? Math.round(pixelReduction * 100) : 0;

  return {
    type: 'oversized-image',
    severity: ratio > 2 ? 'high' : 'medium',
    impact: estimatedSavings > 50000 ? 'high' : 'medium',
    title: 'Image is oversized',
    description: `Image intrinsic size is ${ratio.toFixed(2)}x larger than displayed size`,
    imageUrl: src,
    naturalDimensions: `${naturalWidth}x${naturalHeight}`,
    renderedDimensions: `${renderedWidth}x${renderedHeight}`,
    suggestedDimensions: `${suggestedWidth}x${suggestedHeight}`,
    oversizeRatio: ratio,
    currentSize: fileSize,
    estimatedSavings,
    savingsPercent,
    isAboveFold: position?.isAboveFold || false,
    recommendation: `Resize image to ${suggestedWidth}x${suggestedHeight} or use responsive images with srcset`,
  };
}
