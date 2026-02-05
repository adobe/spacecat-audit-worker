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
 * Normalizes a URL for consistent comparison and storage.
 * Handles encoding issues, trailing slashes, and www prefix.
 * @param {string} url - The URL to normalize
 * @returns {string} Normalized URL
 */
export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);

    // Remove www prefix for consistency
    parsed.hostname = parsed.hostname.replace(/^www\./, '');

    // Decode and clean up pathname
    // Handle spaces and other problematic characters
    let pathname = decodeURIComponent(parsed.pathname);

    // Replace URL-encoded spaces with hyphens (common pattern in slugs)
    // e.g., "sage-green-colour-%20combination" -> "sage-green-colour-combination"
    pathname = pathname.replace(/%20/g, '-').replace(/\s+/g, '-');

    // Remove duplicate hyphens
    pathname = pathname.replace(/-+/g, '-');

    // Remove trailing slashes (except for root path)
    if (pathname !== '/' && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    parsed.pathname = pathname;

    // Sort query parameters for consistent ordering
    parsed.searchParams.sort();

    // Remove hash/fragment for link checking purposes
    parsed.hash = '';

    return parsed.toString();
  } catch (error) {
    // If URL parsing fails, return original URL
    return url;
  }
}
