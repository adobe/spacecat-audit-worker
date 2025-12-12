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
 * Checks if JPEG is used for icons/logos (should use PNG or SVG instead)
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if file type is appropriate
 */
export function checkWrongFileType(imageData) {
  const {
    src,
    format,
    alt,
    naturalWidth,
    naturalHeight,
    fileSize,
  } = imageData;

  // Heuristics to detect if image is likely an icon or logo
  const isLikelyIcon = (
    (naturalWidth <= 64 && naturalHeight <= 64) // Small size
    || (alt && (alt.toLowerCase().includes('icon') || alt.toLowerCase().includes('logo')))
    || (src && (src.toLowerCase().includes('icon') || src.toLowerCase().includes('logo')))
  );

  // JPEG used for icon/logo
  if ((format === 'jpeg' || format === 'jpg') && isLikelyIcon) {
    return {
      type: 'wrong-file-type',
      severity: 'low',
      impact: 'low',
      title: 'JPEG used for icon/logo',
      description: 'JPEG is for photographs. Icons/logos should use PNG or SVG for crisp edges',
      imageUrl: src,
      currentFormat: 'jpeg',
      recommendedFormat: 'png or svg',
      currentSize: fileSize,
      recommendation: 'Convert to PNG for raster icons or SVG for vector graphics',
    };
  }

  return null;
}
