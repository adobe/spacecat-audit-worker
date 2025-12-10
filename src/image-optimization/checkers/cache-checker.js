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
 * Parses Cache-Control max-age value
 * @param {string} cacheControl - Cache-Control header value
 * @returns {number} max-age in seconds, or 0 if not found
 */
function parseCacheMaxAge(cacheControl) {
  if (!cacheControl) return 0;

  const match = cacheControl.match(/max-age=(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Checks if image has proper cache control headers
 * @param {Object} imageData - Image data from scraper
 * @returns {Object|null} Suggestion object or null if caching is properly configured
 */
export function checkCacheControlHeaders(imageData) {
  const {
    src,
    responseHeaders,
    fileSize,
  } = imageData;

  if (!responseHeaders) {
    return null; // No header data available
  }

  const cacheControl = responseHeaders['cache-control'] || responseHeaders['Cache-Control'];
  const expires = responseHeaders.expires || responseHeaders.Expires;

  // Parse max-age
  const maxAge = parseCacheMaxAge(cacheControl);

  // Check for no-cache or no-store directives
  const hasNoCache = cacheControl && (
    cacheControl.includes('no-cache')
    || cacheControl.includes('no-store')
    || cacheControl.includes('must-revalidate')
  );

  // Recommended cache duration for images: at least 1 week (604800 seconds)
  const recommendedMaxAge = 604800; // 7 days
  const optimalMaxAge = 31536000; // 1 year

  // Skip if properly cached
  if (maxAge >= recommendedMaxAge && !hasNoCache) {
    return null;
  }

  // Determine severity
  let severity = 'low';
  let issue = '';

  if (hasNoCache) {
    severity = 'high';
    issue = 'Image is marked as non-cacheable';
  } else if (maxAge === 0 && !expires) {
    severity = 'high';
    issue = 'No caching headers present';
  } else if (maxAge < 3600) {
    severity = 'medium';
    issue = `Cache duration too short (${Math.round(maxAge / 60)} minutes)`;
  } else if (maxAge < recommendedMaxAge) {
    severity = 'low';
    issue = `Cache duration below recommended (${Math.round(maxAge / 86400)} days)`;
  }

  return {
    type: 'insufficient-caching',
    severity,
    impact: fileSize > 100000 ? 'high' : 'medium',
    title: 'Insufficient cache duration',
    description: issue,
    imageUrl: src,
    currentCacheControl: cacheControl || 'none',
    currentMaxAge: maxAge,
    currentMaxAgeDays: Math.round(maxAge / 86400),
    recommendedMaxAge,
    recommendedMaxAgeDays: Math.round(recommendedMaxAge / 86400),
    recommendation: `Set Cache-Control: public, max-age=${optimalMaxAge}, immutable`,
    benefits: [
      'Reduces repeat downloads',
      'Improves page load times for returning visitors',
      'Reduces bandwidth costs',
    ],
  };
}
