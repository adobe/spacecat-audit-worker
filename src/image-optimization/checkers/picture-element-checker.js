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
 * Checks if picture element should be used for modern format fallbacks
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if picture is used or not needed
 */
export function checkPictureElement(imageData) {
  const {
    src,
    format,
    isAvif,
    isWebp,
    hasPictureElement,
    fileSize,
    naturalWidth,
    isDynamicMedia,
  } = imageData;

  // Skip if already using picture element
  if (hasPictureElement) {
    return null;
  }

  // Skip if already modern format
  if (isAvif || isWebp) {
    return null;
  }

  // Skip Dynamic Media (handles format negotiation)
  if (isDynamicMedia) {
    return null;
  }

  // Only suggest for significant images
  if (!fileSize || fileSize < 50000 || naturalWidth < 400) {
    return null;
  }

  // Only suggest for JPEG/PNG that would benefit from modern formats
  if (format !== 'jpeg' && format !== 'jpg' && format !== 'png') {
    return null;
  }

  return {
    type: 'missing-picture-element',
    severity: 'low',
    impact: fileSize > 200000 ? 'medium' : 'low',
    title: 'Consider using <picture> element',
    description: 'Using <picture> enables serving modern formats with fallbacks for older browsers',
    imageUrl: src,
    currentFormat: format,
    currentSize: fileSize,
    recommendation: 'Use <picture> element to serve AVIF/WebP with fallback',
    example: `<picture>
  <source type="image/avif" srcset="image.avif">
  <source type="image/webp" srcset="image.webp">
  <img src="${src}" alt="...">
</picture>`,
  };
}
