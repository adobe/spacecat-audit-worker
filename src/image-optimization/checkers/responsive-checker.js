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
 * Generates DM URL with specific width parameter
 * @param {string} src - Original DM image URL
 * @param {number} width - Desired width
 * @returns {string} URL with width parameter
 */
function getDmUrlWithWidth(src, width) {
  try {
    const url = new URL(src);
    url.searchParams.set('wid', width.toString());
    return url.toString();
  } catch {
    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}wid=${width}`;
  }
}

/**
 * Generates DM-specific srcset example
 * @param {string} src - Original DM image URL
 * @returns {object} Object with srcset string and individual URLs
 */
function generateDmSrcset(src) {
  const widths = [320, 640, 1024, 1920];
  const urls = widths.map((w) => ({
    width: w,
    url: getDmUrlWithWidth(src, w),
  }));

  const srcsetString = urls.map((u) => `${u.url} ${u.width}w`).join(',\n       ');

  return { urls, srcsetString };
}

/**
 * Checks if DM image is missing responsive srcset and sizes attributes.
 * Provides DM-specific recommendations with proper URL parameters.
 *
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
  } = imageData;

  // Check for missing sizes when srcset exists
  if (srcset && srcset.length > 0 && !sizes) {
    return {
      type: 'missing-sizes-attribute',
      severity: 'medium',
      impact: position?.isAboveFold ? 'high' : 'medium',
      title: 'Missing sizes attribute',
      description: 'srcset is present but sizes attribute is missing. Without sizes, the browser cannot determine which image size to download.',
      imageUrl: src,
      currentDimensions: `${naturalWidth}x${naturalHeight}`,
      hasSrcset: true,
      hasSizes: false,
      recommendation: 'Add sizes attribute to tell the browser which image size to use at different viewport widths',
      example: `<img src="${src}"
     srcset="..."
     sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 1920px">`,
    };
  }

  // Skip if already using srcset with sizes
  if (srcset && srcset.length > 0) {
    return null;
  }

  // Skip very small images (< 200px wide)
  if (naturalWidth < 200) {
    return null;
  }

  // Only suggest for content images (significant size)
  if (!fileSize || fileSize < 10000) {
    return null;
  }

  // Generate DM-specific srcset
  const dmSrcset = generateDmSrcset(src);

  return {
    type: 'missing-responsive-images',
    severity: fileSize > 100000 ? 'high' : 'medium',
    impact: position?.isAboveFold ? 'high' : 'medium',
    title: 'Missing responsive image srcset',
    description: 'Image serves one size for all devices, wasting bandwidth on mobile. Use srcset to serve appropriately sized images.',
    imageUrl: src,
    currentDimensions: `${naturalWidth}x${naturalHeight}`,
    currentSize: fileSize,
    isAboveFold: position?.isAboveFold || false,
    hasSrcset: false,
    hasSizes: !!sizes,
    recommendation: 'Add srcset attribute with multiple image sizes. Dynamic Media serves different sizes using the wid parameter.',
    example: `<img src="${getDmUrlWithWidth(src, 1920)}"
     srcset="${dmSrcset.srcsetString}"
     sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 1920px"
     alt="...">`,
    dmUrls: dmSrcset.urls,
  };
}
