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
 * Converts HTML to clean text by stripping tags and normalizing whitespace
 * @param {string} html - HTML content
 * @returns {string} - Clean text content
 */
function stripTagsToText(html) {
  return html
    .replace(/<[^>]*>/g, ' ') // Convert newlines to spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim(); // Remove leading/trailing whitespace
}

/**
 * Extracts word count from HTML content
 * @param {string} html - HTML content
 * @returns {Object} - Object with word_count property
 */
function extractWordCount(html) {
  const text = stripTagsToText(html);
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  return { word_count: words.length };
}

/**
 * Calculates statistics between two HTML contents
 * @param {string} originalHTML - Original HTML (server-side rendered)
 * @param {string} currentHTML - Current HTML (client-side rendered)
 * @param {boolean} ignoreNavFooter - Whether to ignore navigation/footer
 * @returns {Object} - Statistics object
 */
function calculateStats(originalHTML, currentHTML) {
  const initialWords = extractWordCount(originalHTML).word_count;
  const finalWords = extractWordCount(currentHTML).word_count;
  const wordDiff = Math.abs(finalWords - initialWords);
  let contentGainRatio = 'N/A';

  if (initialWords > 0) {
    contentGainRatio = parseFloat((finalWords / initialWords).toFixed(1));
  } else if (finalWords > 0) {
    contentGainRatio = finalWords; // When starting from 0, any content is infinite gain
  }

  return {
    wordDiff,
    contentGainRatio,
    initialWords,
    finalWords,
  };
}

/**
 * Analyzes HTML content to determine if prerendering is needed
 * @param {string} directHtml - Direct fetch HTML (server-side rendered)
 * @param {string} scrapedHtml - Scraped HTML (client-side rendered)
 * @param {number} threshold - Content increase threshold (default: 1.2)
 * @returns {Object} - Analysis result with needsPrerender, stats, and recommendation
 */
function analyzeHtmlForPrerender(directHtml, scrapedHtml, threshold = 1.2) {
  if (!directHtml || !scrapedHtml) {
    return {
      error: 'Missing HTML content for comparison',
      needsPrerender: false,
      stats: null,
    };
  }

  try {
    const stats = calculateStats(directHtml, scrapedHtml, true); // ignore nav/footer
    const needsPrerender = typeof stats.contentGainRatio === 'number' && stats.contentGainRatio >= threshold;

    return {
      needsPrerender,
      stats,
      recommendation: needsPrerender
        ? `Content increased ${stats.contentGainRatio}x after JS execution (${stats.initialWords} → ${stats.finalWords} words) - consider implementing prerendering`
        : `No significant client-side content increase detected (gain ratio: ${stats.contentGainRatio})`,
    };
  } catch (error) {
    return {
      error: `HTML analysis failed: ${error.message}`,
      needsPrerender: false,
      stats: null,
    };
  }
}

export {
  analyzeHtmlForPrerender,
};
