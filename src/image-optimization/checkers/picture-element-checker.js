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
 * Constructs DM URL with specific format parameter
 * @param {string} src - Original DM image URL
 * @param {string} format - Desired format (avif, webp, jpeg, png)
 * @returns {string} URL with format parameter
 */
function getDmUrlWithFormat(src, format) {
  try {
    const url = new URL(src);
    url.searchParams.set('fmt', format);
    return url.toString();
  } catch {
    // Fallback for malformed URLs
    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}fmt=${format}`;
  }
}

/**
 * Checks if Dynamic Media image should use <picture> element for format fallbacks.
 * Provides DM-specific recommendations with proper URL parameters.
 *
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if picture is used
 */
export function checkPictureElement(imageData) {
  const {
    src,
    format,
    hasPictureElement,
    fileSize,
    naturalWidth,
    naturalHeight,
  } = imageData;

  // Skip if already using picture element
  if (hasPictureElement) {
    return null;
  }

  // Generate DM URLs for each format
  const avifUrl = getDmUrlWithFormat(src, 'avif');
  const webpUrl = getDmUrlWithFormat(src, 'webp-alpha');
  const fallbackUrl = getDmUrlWithFormat(src, 'jpeg');

  return {
    type: 'missing-picture-element',
    severity: 'medium',
    impact: fileSize > 200000 ? 'high' : 'medium',
    title: 'Use <picture> element for format fallback',
    description: 'The <picture> element enables serving modern formats (AVIF/WebP) with automatic fallback to JPEG for older browsers. This ensures optimal compression while maintaining compatibility.',
    imageUrl: src,
    currentFormat: format,
    currentSize: fileSize,
    dimensions: naturalWidth && naturalHeight ? `${naturalWidth}x${naturalHeight}` : null,
    recommendation: 'Wrap the image in a <picture> element with <source> elements for AVIF and WebP formats. Dynamic Media serves different formats from the same base URL using the fmt parameter.',
    example: `<picture>
  <source type="image/avif" srcset="${avifUrl}">
  <source type="image/webp" srcset="${webpUrl}">
  <img src="${fallbackUrl}" alt="...">
</picture>`,
    dmUrls: {
      avif: avifUrl,
      webp: webpUrl,
      fallback: fallbackUrl,
    },
  };
}
