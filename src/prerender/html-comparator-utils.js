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

import * as cheerio from 'cheerio';

function filterHtmlContent(htmlContent, ignoreNavFooter = true, returnText = true) {
  /** Filter HTML content by removing unwanted elements, optionally return HTML or text */
  if (!htmlContent) return '';

  // For browser environment (Chrome extension)
  if (typeof document !== 'undefined' && typeof globalThis.DOMParser !== 'undefined') {
    const parser = new globalThis.DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Get the body element, if it doesn't exist, use the entire document
    const bodyElement = doc.body || doc.documentElement;

    // Always remove script, style, noscript, template elements
    bodyElement.querySelectorAll('script,style,noscript,template').forEach((n) => n.remove());

    // Remove all media elements (images, videos, audio, etc.) to keep only text
    bodyElement.querySelectorAll('img,video,audio,picture,svg,canvas,embed,object,iframe').forEach((n) => n.remove());

    // Conditionally remove navigation and footer elements
    if (ignoreNavFooter) {
      // Note: filterNavigationAndFooter function not available in this context
      // This is a placeholder for browser environment
    }

    if (returnText) {
      return (bodyElement && bodyElement.textContent) ? bodyElement.textContent : '';
    } else {
      return bodyElement.outerHTML;
    }
  }

  // For Node.js environment (main.js)
  const $ = cheerio.load(htmlContent);

  // Always remove script, style, noscript, template tags
  $('script, style, noscript, template').remove();

  // Remove all media elements (images, videos, audio, etc.) to keep only text
  $('img, video, audio, picture, svg, canvas, embed, object, iframe').remove();

  // Conditionally remove navigation and footer elements
  if (ignoreNavFooter) {
    // Note: filterNavigationAndFooterCheerio function not available in this context
    // This is a placeholder for Node.js environment
  }

  if (returnText) {
    // Get text content from document element
    const textContent = $('html').text() || $('body').text() || '';
    // Clean up whitespace
    return textContent.replace(/\s+/g, ' ').trim();
  } else {
    return $.html();
  }
}

function stripTagsToText(htmlContent, ignoreNavFooter = true) {
  /** Backward compatibility wrapper for filterHtmlContent */
  return filterHtmlContent(htmlContent, ignoreNavFooter, true);
}

/**
 * Tokenizes text into words or lines with intelligent normalization
 *
 * @param {string} text - The input text to tokenize
 * @param {string} [mode="word"] - Tokenization mode: "word" or "line"
 *
 * @returns {string[]} Array of normalized tokens
 *
 * @description
 * Word mode features:
 * - Normalizes whitespace (collapses multiple spaces, removes leading/trailing)
 * - Standardizes punctuation spacing (e.g., "hello , world" → "hello, world")
 * - Preserves URLs, emails, and structured data as single tokens
 * - Uses robust placeholder system with private Unicode characters
 * - Protects: https://, www., .com/.org/.net/.edu/.gov, email@domain.ext
 *
 * Line mode features:
 * - Normalizes line endings to consistent format
 * - Collapses horizontal whitespace within lines
 * - Removes empty lines and excessive line breaks
 *
 * @example
 * // Word tokenization with punctuation normalization
 * tokenize("Hello , world !")
 * // → ["Hello,", "world!"]
 *
 * @example
 * // URL preservation
 * tokenize("Visit https://example.com , please")
 * // → ["Visit", "https://example.com,", "please"]
 *
 * @example
 * // Line tokenization
 * tokenize("Line 1\n\nLine 2\n   Line 3", "line")
 * // → ["Line 1", "Line 2", "Line 3"]
 */
function tokenize(text, mode = 'word') {
  if (mode === 'line') {
    // For line mode: normalize whitespace first, then split by lines and filter out empty lines
    const normalized = text
      .replace(/\r\n?|\n/g, '\n') // Normalize line endings
      .replace(/[ \t]+/g, ' ') // Collapse horizontal whitespace to single space
      .replace(/\n\s*\n/g, '\n') // Collapse multiple empty lines to single
      .trim();
    return normalized.split(/\n/).filter((line) => line.length > 0);
  } else {
    // For word mode: normalize all whitespace thoroughly before tokenizing
    let clean = text
      .replace(/\r\n?|\n/g, ' ') // Convert newlines to spaces
      .replace(/\s+/g, ' ') // Collapse multiple whitespace to single space
      .replace(/^\s+|\s+$/g, ''); // Remove leading/trailing whitespace more explicitly

    // Protect URLs/links by temporarily replacing them with unique placeholders
    const urlPattern = /\S*(?:https?:\/\/|www\.|\.com|\.org|\.net|\.edu|\.gov|@\S+\.\S+)\S*/gi;
    const urlMap = new Map();
    const uniqueId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    clean = clean.replace(urlPattern, (match) => {
      const placeholder = `\u{E000}${uniqueId}_${urlMap.size}\u{E001}`; // Using private use Unicode chars
      urlMap.set(placeholder, match);
      return placeholder;
    });

    // Now normalize punctuation spacing on the text without URLs
    clean = clean
      .replace(/\s*([,.!?;:])\s*/g, '$1 ') // Normalize punctuation spacing
      .replace(/\s+/g, ' '); // Final collapse of any remaining multi-spaces

    // Restore URLs
    for (const [placeholder, originalUrl] of urlMap) {
      clean = clean.replace(placeholder, originalUrl);
    }

    // Split by whitespace and filter out empty tokens
    return clean.split(/\s+/).filter((token) => token.length > 0);
  }
}

/**
 * Calculates statistics between two HTML contents
 * @param {string} originalHTML - Original HTML (server-side rendered)
 * @param {string} currentHTML - Current HTML (client-side rendered)
 * @returns {Object} - Statistics object
 */
function calculateStats(originalHTML, currentHTML) {
  const originalText = stripTagsToText(originalHTML, true);
  const currentText = stripTagsToText(currentHTML, true);

  const originalTokens = tokenize(originalText, 'word');
  const currentTokens = tokenize(currentText, 'word');
  const wordCountBefore = originalTokens.length;
  const wordCountAfter = currentTokens.length;
  const wordDiff = Math.abs(wordCountAfter - wordCountBefore);

  let contentGainRatio;
  if (wordCountBefore > 0) {
    contentGainRatio = wordCountAfter / wordCountBefore;
  } else if (wordCountAfter > 0) {
    contentGainRatio = wordCountAfter;
  } else {
    contentGainRatio = 1;
  }

  return {
    wordDiff,
    contentGainRatio,
    wordCountBefore,
    wordCountAfter,
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
    };
  }

  try {
    const stats = calculateStats(directHtml, scrapedHtml);
    const needsPrerender = typeof stats.contentGainRatio === 'number' && stats.contentGainRatio >= threshold;

    return {
      needsPrerender,
      ...stats,
    };
  } catch (error) {
    return {
      error: `HTML analysis failed: ${error.message}`,
      needsPrerender: false,
    };
  }
}

export {
  analyzeHtmlForPrerender,
};
