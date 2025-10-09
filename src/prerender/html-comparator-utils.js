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

const excludedSelectors = [
  'nav', 'header', 'footer',
  '.nav', '.navigation', '.navbar', '.nav-bar', '.menu', '.main-menu',
  '.header', '.site-header', '.page-header', '.top-header',
  '.footer', '.site-footer', '.page-footer', '.bottom-footer',
  '.breadcrumb', '.breadcrumbs',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  // Common class patterns
  '.navigation-wrapper', '.nav-wrapper', '.header-wrapper', '.footer-wrapper',
  '.site-navigation', '.primary-navigation', '.secondary-navigation',
  '.top-nav', '.bottom-nav', '.sidebar-nav',
  // ID selectors for common navigation/footer elements
  '#nav', '#navigation', '#navbar', '#header', '#footer', '#menu', '#main-menu',
  '#site-header', '#site-footer', '#page-header', '#page-footer',
  '.cc-banner', '.cc-grower', '.consent-banner', '.cookie-banner',
  '.privacy-banner', '.gdpr-banner', '.cookie-consent', '.privacy-consent',
  '.cookie-notice', '.privacy-notice', '.cookie-policy', '.privacy-policy',
  '.cookie-bar', '.privacy-bar', '.consent-bar', '.gdpr-bar',
  '.cookie-popup', '.privacy-popup', '.consent-popup', '.gdpr-popup',
  '.cookie-modal', '.privacy-modal', '.consent-modal', '.gdpr-modal',
  '.cookie-overlay', '.privacy-overlay', '.consent-overlay', '.gdpr-overlay',
  '#cookie-banner', '#privacy-banner', '#consent-banner', '#gdpr-banner',
  '#cookie-notice', '#privacy-notice', '#cookie-consent', '#privacy-consent',
  '#cookie-bar', '#privacy-bar', '#consent-bar', '#gdpr-bar',
  '#cookie-popup', '#privacy-popup', '#consent-popup', '#gdpr-popup', '#cookiemgmt',
  '[role="dialog"][aria-label="Consent Banner"]',
  '[role="dialog"][aria-label*="cookie" i]',
  '[role="dialog"][aria-label*="privacy" i]',
  '[role="dialog"][aria-label*="consent" i]',
  '[role="alertdialog"][aria-label*="cookie" i]',
  '[role="alertdialog"][aria-label*="privacy" i]',
  '[aria-describedby*="cookie" i]',
  '[aria-describedby*="privacy" i]',
];

function stripTagsToText(htmlContent) {
  /* c8 ignore next 1 */
  if (!htmlContent) return '';

  const $ = cheerio.load(htmlContent);

  // Always remove script, style, noscript, template tags
  $('script, style, noscript, template').remove();

  // Remove all media elements (images, videos, audio, etc.) to keep only text
  $('img, video, audio, picture, svg, canvas, embed, object, iframe').remove();

  // Remove excluded selectors
  const allSelectors = excludedSelectors.join(',');
  $(allSelectors).remove();

  // Get text content from document element
  const textContent = $('html').text() || $('body').text() || '';
  // Clean up whitespace
  return textContent.replace(/\s+/g, ' ').trim();
}

/**
 * Tokenizes text into words with intelligent normalization
 *
 * @param {string} text - The input text to tokenize
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
 */
function tokenize(text) {
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

/**
 * Calculates statistics between two HTML contents
 * @param {string} originalHTML - Original HTML (server-side rendered)
 * @param {string} currentHTML - Current HTML (client-side rendered)
 * @returns {Object} - Statistics object
 */
function calculateStats(originalHTML, currentHTML) {
  const originalText = stripTagsToText(originalHTML);
  const currentText = stripTagsToText(currentHTML);

  const originalTokens = tokenize(originalText);
  const currentTokens = tokenize(currentText);
  const wordCountBefore = originalTokens.length;
  const wordCountAfter = currentTokens.length;

  let contentGainRatio;
  if (wordCountBefore > 0) {
    contentGainRatio = Math.round((wordCountAfter / wordCountBefore) * 10) / 10;
  } else if (wordCountAfter > 0) {
    contentGainRatio = wordCountAfter;
  } else {
    contentGainRatio = 1;
  }

  return {
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
