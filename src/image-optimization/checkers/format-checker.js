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

/**
 * Checks if image format can be optimized to AVIF or WebP
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if no optimization needed
 */
export function checkFormatDetection(imageData) {
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
  };
}
