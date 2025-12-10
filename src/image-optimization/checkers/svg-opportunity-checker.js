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
 * Checks if image could be replaced with SVG (logos, icons, simple graphics)
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if SVG is not applicable
 */
export function checkSvgOpportunity(imageData) {
  const {
    src,
    format,
    alt,
    naturalWidth,
    naturalHeight,
    fileSize,
  } = imageData;

  // Already SVG
  if (format === 'svg') {
    return null;
  }

  // Detect if this is likely a logo or icon
  const isLikelyLogo = (
    (alt && (
      alt.toLowerCase().includes('logo')
      || alt.toLowerCase().includes('brand')
      || alt.toLowerCase().includes('company')
    ))
    || (src && (
      src.toLowerCase().includes('logo')
      || src.toLowerCase().includes('brand')
    ))
  );

  const isLikelyIcon = (
    (naturalWidth <= 128 && naturalHeight <= 128) // Icon size
    || (alt && alt.toLowerCase().includes('icon'))
    || (src && src.toLowerCase().includes('icon'))
  );

  const isSimpleGraphic = (
    (naturalWidth <= 200 && naturalHeight <= 200) // Small graphic
    && (alt && (
      alt.toLowerCase().includes('badge')
      || alt.toLowerCase().includes('button')
      || alt.toLowerCase().includes('arrow')
    ))
  );

  if (!isLikelyLogo && !isLikelyIcon && !isSimpleGraphic) {
    return null;
  }

  return {
    type: 'svg-opportunity',
    severity: 'low',
    impact: isLikelyLogo ? 'medium' : 'low',
    title: `${isLikelyLogo ? 'Logo' : 'Icon'} could be SVG`,
    description: 'SVG is resolution-independent, scales perfectly, and often smaller than raster formats',
    imageUrl: src,
    currentFormat: format,
    recommendedFormat: 'svg',
    currentSize: fileSize,
    currentDimensions: `${naturalWidth}x${naturalHeight}`,
    benefits: [
      'Scalable to any size without quality loss',
      'Often smaller file size',
      'Can be styled with CSS',
      'Better for high-DPI displays',
    ],
    recommendation: `Convert ${isLikelyLogo ? 'logo' : 'icon'} to SVG format`,
  };
}
