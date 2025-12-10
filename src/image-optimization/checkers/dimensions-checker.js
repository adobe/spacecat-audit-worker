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
 * Checks if image is missing width and height attributes (causes layout shift)
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if dimensions are present
 */
export function checkMissingDimensions(imageData) {
  const {
    src,
    hasWidthAttribute,
    hasHeightAttribute,
    naturalWidth,
    naturalHeight,
    position,
  } = imageData;

  // Skip if both attributes are present
  if (hasWidthAttribute && hasHeightAttribute) {
    return null;
  }

  // Skip very small images
  if (naturalWidth < 50 || naturalHeight < 50) {
    return null;
  }

  const missingAttributes = [];
  if (!hasWidthAttribute) missingAttributes.push('width');
  if (!hasHeightAttribute) missingAttributes.push('height');

  return {
    type: 'missing-dimensions',
    severity: position?.isAboveFold ? 'high' : 'medium',
    impact: 'medium',
    title: `Missing ${missingAttributes.join(' and ')} attribute${missingAttributes.length > 1 ? 's' : ''}`,
    description: 'Missing dimensions cause Cumulative Layout Shift (CLS), hurting Core Web Vitals',
    imageUrl: src,
    missingAttributes,
    naturalDimensions: `${naturalWidth}x${naturalHeight}`,
    isAboveFold: position?.isAboveFold || false,
    recommendation: `Add ${missingAttributes.join(' and ')} attribute${missingAttributes.length > 1 ? 's' : ''} to prevent layout shift`,
    example: `<img src="${src.split('/').pop()}" width="${naturalWidth}" height="${naturalHeight}" alt="...">`,
  };
}
