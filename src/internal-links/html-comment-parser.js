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
 * Parses HTML comments to extract broken internal links information.
 * Specifically looks for comments with the format:
 * <!-- BROKEN_INTERNAL_LINK: url="/path/to/page.html" validity="INVALID" -->
 * Additional attributes may include: source, timestamp, and request_uri
 *
 * @param {string} html - Raw HTML content to parse
 * @param {string} pageUrl - URL of the page containing the HTML (used as urlFrom)
 * @param {object} log - Logger instance
 * @returns {Array<Object>} Array of broken link objects with urlFrom, urlTo,
 *   and trafficDomain properties
 */
export function parseBrokenLinkComments(html, pageUrl, log = console) {
  if (!html || typeof html !== 'string') {
    log.warn('Invalid HTML provided to parseBrokenLinkComments');
    return [];
  }

  const brokenLinks = [];

  // Regular expression to find HTML comments
  const commentRegex = /<!--([\s\S]*?)-->/g;

  // Extract all comments from HTML
  let commentMatch;
  const matches = [];

  // Collect all matches
  commentMatch = commentRegex.exec(html);
  while (commentMatch !== null) {
    matches.push(commentMatch);
    commentMatch = commentRegex.exec(html);
  }

  // Process each match
  for (const match of matches) {
    const commentContent = match[1].trim();

    // Check if this is a broken internal link comment
    if (commentContent.startsWith('BROKEN_INTERNAL_LINK:')) {
      try {
        // Extract attributes using regex
        const urlMatch = commentContent.match(/url="([^"]+)"/);
        const validityMatch = commentContent.match(/validity="([^"]+)"/);
        const sourceMatch = commentContent.match(/source="([^"]+)"/);
        const requestUriMatch = commentContent.match(/request_uri="([^"]+)"/);
        const timestampMatch = commentContent.match(/timestamp="([^"]+)"/);

        // Only process if we have the minimum required information
        if (urlMatch && urlMatch[1]) {
          const urlTo = urlMatch[1];
          const validity = validityMatch && validityMatch[1];

          // Only include links explicitly marked as INVALID
          if (validity === 'INVALID') {
            brokenLinks.push({
              urlFrom: pageUrl,
              urlTo,
              // Default traffic value for HTML comment-detected links
              trafficDomain: 1,
              // Include additional metadata that might be useful
              source: sourceMatch ? sourceMatch[1] : null,
              requestUri: requestUriMatch ? requestUriMatch[1] : null,
              timestamp: timestampMatch ? timestampMatch[1] : null,
              detectedVia: 'html-comment',
            });
          }
        }
      } catch (error) {
        log.error(`Error parsing broken link comment: ${error.message}`);
      }
    }
  }

  return brokenLinks;
}

/**
 * Alternative parser that handles multiple formats of broken link comments.
 * This is a more flexible approach that can be extended to support additional formats.
 *
 * @param {string} html - Raw HTML content to parse
 * @param {string} pageUrl - URL of the page containing the HTML
 * @param {object} log - Logger instance
 * @returns {Array<Object>} Array of broken link objects
 */
export function parseAllBrokenLinkFormats(html, pageUrl, log = console) {
  if (!html || typeof html !== 'string') {
    log.warn('Invalid HTML provided to parseAllBrokenLinkFormats');
    return [];
  }

  const brokenLinks = [];

  // Parse standard format (the one provided in the example)
  brokenLinks.push(...parseBrokenLinkComments(html, pageUrl, log));

  // Additional formats could be added here
  // For example, a simpler format like: <!-- BROKEN_LINK: /path/to/broken/page.html -->
  const simpleBrokenLinkRegex = /<!--\s*BROKEN_LINK:\s*([^>]+?)\s*-->/g;

  // Collect matches
  let simpleMatch;
  const simpleMatches = [];

  simpleMatch = simpleBrokenLinkRegex.exec(html);
  while (simpleMatch !== null) {
    simpleMatches.push(simpleMatch);
    simpleMatch = simpleBrokenLinkRegex.exec(html);
  }

  // Process each match
  for (const match of simpleMatches) {
    const brokenUrl = match[1].trim();
    if (brokenUrl) {
      brokenLinks.push({
        urlFrom: pageUrl,
        urlTo: brokenUrl,
        trafficDomain: 1,
        detectedVia: 'html-comment-simple',
      });
    }
  }

  return brokenLinks;
}
