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
 * Checks if image is missing responsive srcset and sizes attributes
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if responsive images are used
 */
export function checkResponsiveImages(imageData) {
  const {
    src,
    srcset,
    sizes,
    naturalWidth,
    naturalHeight,
    fileSize,
    position,
    isDynamicMedia,
  } = imageData;

  // Skip if already using srcset
  if (srcset && srcset.length > 0) {
    return null;
  }

  // Skip very small images (< 200px wide)
  if (naturalWidth < 200) {
    return null;
  }

  // Skip if using Dynamic Media (it handles responsive delivery)
  if (isDynamicMedia) {
    return null;
  }

  // Only suggest for content images (significant size)
  if (!fileSize || fileSize < 10000) {
    return null; // Skip tiny images
  }

  return {
    type: 'missing-responsive-images',
    severity: fileSize > 100000 ? 'high' : 'medium',
    impact: position?.isAboveFold ? 'high' : 'medium',
    title: 'Missing responsive image srcset',
    description: 'Image serves one size for all devices, wasting bandwidth on mobile',
    imageUrl: src,
    currentDimensions: `${naturalWidth}x${naturalHeight}`,
    currentSize: fileSize,
    isAboveFold: position?.isAboveFold || false,
    hasSrcset: false,
    hasSizes: !!sizes,
    recommendation: 'Add srcset attribute with multiple image sizes (e.g., 320w, 640w, 1024w, 1920w)',
    example: '<img src="image.jpg" srcset="image-320.jpg 320w, image-640.jpg 640w, image-1024.jpg 1024w" sizes="(max-width: 640px) 100vw, 50vw">',
  };
}
