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
 * Checks if below-the-fold images are missing lazy loading
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if lazy loading is present or not needed
 */
export function checkLazyLoading(imageData) {
  const {
    src,
    hasLazyLoading,
    position,
    fileSize,
    naturalWidth,
  } = imageData;

  // Skip if already has lazy loading
  if (hasLazyLoading) {
    return null;
  }

  // Only suggest for below-the-fold images
  if (!position || position.isAboveFold) {
    return null;
  }

  // Skip small images
  if (!fileSize || fileSize < 10000 || naturalWidth < 100) {
    return null;
  }

  return {
    type: 'missing-lazy-loading',
    severity: fileSize > 100000 ? 'medium' : 'low',
    impact: 'medium',
    title: 'Missing lazy loading attribute',
    description: 'Below-the-fold image loads eagerly, wasting bandwidth and slowing page load',
    imageUrl: src,
    currentSize: fileSize,
    isAboveFold: false,
    isVisible: position?.isVisible || false,
    recommendation: 'Add loading="lazy" attribute to defer loading until image is near viewport',
    example: `<img src="${src.split('/').pop()}" loading="lazy" alt="...">`,
  };
}
