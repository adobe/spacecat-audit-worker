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

import rs from 'text-readability';
import { load as cheerioLoad } from 'cheerio';
import { franc } from 'franc-min';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../../utils/s3-utils.js';
import {
  calculateReadabilityScore,
  isSupportedLanguage,
  getLanguageName,
} from './multilingual-readability.js';
import {
  TARGET_READABILITY_SCORE,
  MIN_TEXT_LENGTH,
  MAX_CHARACTERS_DISPLAY,
} from './constants.js';
import { getElementSelector } from './selector-utils.js';

/**
 * Categorizes readability issues by severity and traffic impact
 */
function categorizeReadabilityIssue(readabilityScore, traffic) {
  if (readabilityScore < 20 && traffic > 1000) {
    return 'Critical';
  } else if (readabilityScore < 25 && traffic > 500) {
    return 'Important';
  } else if (readabilityScore < 30) {
    return 'Moderate';
  }
  return 'Low';
}

/**
 * Calculates SEO impact based on readability and traffic
 */
function calculateSeoImpact(readabilityScore) {
  if (readabilityScore < 15) {
    return 'High';
  } else if (readabilityScore < 25) {
    return 'Moderate';
  }
  return 'Low';
}

/**
 * Extracts traffic information from S3 object key (if available)
 */
function extractTrafficFromKey() {
  // This would need to be implemented based on how traffic data is stored in the key
  // For now, return 0 as default
  return 0;
}

/**
 * Analyzes readability for a single text block
 */
async function analyzeTextReadability(
  text,
  selector,
  pageUrl,
  traffic,
  detectedLanguages,
  getSupportedLanguage,
  log,
  scrapedAt,
) {
  try {
    // Check if text is in a supported language
    const detectedLanguage = getSupportedLanguage(text);
    if (!detectedLanguage) {
      return null; // Skip unsupported languages
    }

    // Track detected language
    detectedLanguages.add(detectedLanguage);

    // Calculate readability score
    let readabilityScore;
    if (detectedLanguage === 'english') {
      readabilityScore = rs.fleschReadingEase(text.trim());
    } else {
      readabilityScore = await calculateReadabilityScore(text.trim(), detectedLanguage);
    }

    // Check if readability is poor
    if (readabilityScore < TARGET_READABILITY_SCORE) {
      // Truncate text for display
      const displayText = text.length > MAX_CHARACTERS_DISPLAY
        ? `${text.substring(0, MAX_CHARACTERS_DISPLAY)}...`
        : text;

      // Calculate priority rank
      const trafficWeight = traffic || 0;
      const readabilityWeight = TARGET_READABILITY_SCORE - readabilityScore;
      const contentLengthWeight = Math.min(text.length, 1000) / 1000;
      const rank = (readabilityWeight * 0.5) + (trafficWeight * 0.0001)
        + (contentLengthWeight * 0.1);

      return {
        pageUrl,
        scrapedAt,
        selector,
        textContent: text,
        displayText,
        fleschReadingEase: Math.round(readabilityScore * 100) / 100,
        language: detectedLanguage,
        traffic,
        rank: Math.round(rank * 100) / 100,
        category: categorizeReadabilityIssue(readabilityScore, traffic),
        seoImpact: calculateSeoImpact(readabilityScore, traffic),
        seoRecommendation:
          'Improve readability by using shorter sentences, simpler words, and clearer structure',
      };
    }

    return null;
  } catch (error) {
    log.error(`[ReadabilityAnalysis] Error analyzing text readability: ${error.message}`);
    return null;
  }
}

/**
 * Returns an array of meaningful text elements from the provided document.
 * Selects <p>, <blockquote>, and <li> elements, but excludes <li> elements
 * that are descendants of <header> or <footer>.
 * Also filters out elements with insufficient text content length.
 *
 * @param {Cheerio} $ - The Cheerio object to search for text elements.
 * @returns {Element[]} Array of meaningful text elements for readability analysis and enhancement.
 */
const getMeaningfulElementsForReadability = ($) => {
  $('header, footer').remove();
  return $('p, blockquote, li').toArray().filter((el) => {
    const text = $(el).text()?.trim();
    return text && text.length >= MIN_TEXT_LENGTH;
  });
};

/**
 * Analyzes readability for a single page's content
 */
/**
 * Analyzes the readability of HTML page content and returns an array of readability issue objects
 * for text elements with poor readability.
 *
 * - Extracts meaningful text elements from the HTML.
 * - Detects each element's language and filters for supported languages.
 * - Handles elements containing <br> tags as multiple paragraphs.
 * - Uses `analyzeTextReadability` to evaluate readability and collect issues.
 * - Logs summary information about the analysis.
 *
 * @param {string} rawBody - Raw HTML content of the page.
 * @param {string} pageUrl - The URL of the analyzed page.
 * @param {number} traffic - Estimated traffic or popularity metric for the page.
 * @param {object} log - Logger utility (must support .debug and .error).
 * @returns {Promise<Array>} Array of readability issue objects for text elements
 *  with poor readability.
 */
export async function analyzePageContent(rawBody, pageUrl, traffic, log, scrapedAt) {
  const readabilityIssues = [];

  try {
    const $ = cheerioLoad(rawBody);

    // Get all paragraph, div, and list item element selectors (same as preflight)
    const textElements = getMeaningfulElementsForReadability($);

    const detectedLanguages = new Set();

    // Helper function to detect if text is in a supported language
    const getSupportedLanguage = (text) => {
      const detectedLanguageCode = franc(text);
      if (isSupportedLanguage(detectedLanguageCode)) {
        return getLanguageName(detectedLanguageCode);
      }
      return null;
    };

    // Filter and process elements
    const elementsToProcess = textElements
      .map((element) => ({ element }))
      .filter(({ element }) => {
        // Check if element has child elements (avoid duplicate analysis)
        const $el = $(element);
        const children = $el.children().toArray();
        const hasBlockChildren = children.length > 0
          && !children.every((child) => {
            const inlineTags = [
              'strong', 'b', 'em', 'i', 'span', 'a', 'mark',
              'small', 'sub', 'sup', 'u', 'code', 'br',
            ];
            return inlineTags.includes($(child).prop('tagName').toLowerCase());
          });

        return !hasBlockChildren;
      })
      .filter(({ element }) => {
        const textContent = $(element).text()?.trim();
        return textContent && textContent.length >= MIN_TEXT_LENGTH && /\s/.test(textContent);
      });

    // Process each element and collect analysis promises
    const analysisPromises = [];

    elementsToProcess.forEach(({ element }) => {
      const $el = $(element);
      const textContent = $el.text()?.trim();
      const selector = getElementSelector(element);

      // Handle elements with <br> tags (multiple paragraphs)
      if ($el.html().includes('<br')) {
        const paragraphs = $el.html()
          .split(/<br\s*\/?>/gi)
          .map((p) => {
            const tempDiv = cheerioLoad(`<div>${p}</div>`)('div');
            return tempDiv.text();
          })
          .map((p) => p.trim())
          .filter((p) => p.length >= MIN_TEXT_LENGTH && /\s/.test(p));

        paragraphs.forEach((paragraph) => {
          const analysisPromise = analyzeTextReadability(
            paragraph,
            selector,
            pageUrl,
            traffic,
            detectedLanguages,
            getSupportedLanguage,
            log,
            scrapedAt,
          );
          analysisPromises.push(analysisPromise);
        });
      } else {
        const analysisPromise = analyzeTextReadability(
          textContent,
          selector,
          pageUrl,
          traffic,
          detectedLanguages,
          getSupportedLanguage,
          log,
          scrapedAt,
        );
        analysisPromises.push(analysisPromise);
      }
    });

    // Execute all analyses in parallel
    const analysisResults = await Promise.all(analysisPromises);

    // Filter out null results and add to issues
    analysisResults.forEach((result) => {
      if (result) {
        readabilityIssues.push(result);
      }
    });

    const detectedLanguagesList = detectedLanguages.size > 0
      ? Array.from(detectedLanguages).join(', ')
      : 'none detected';

    log.debug(
      `[ReadabilityAnalysis] Processed ${elementsToProcess.length} text elements on ${pageUrl}, `
      + `found ${readabilityIssues.length} with poor readability (detected languages: ${detectedLanguagesList})`,
    );
  } catch (error) {
    log.error(`[ReadabilityAnalysis] Error analyzing page content for ${pageUrl}: ${error.message}`);
  }

  return readabilityIssues;
}

/**
/**
 * Analyzes readability for all scraped pages from S3.
 *
 * Fetches all scraped page objects for the specified site from S3, analyzes the readability
 * of each page's content, and returns the combined list of readability issues found as well
 * as the number of processed URLs.
 *
 * @param {AWS.S3} s3Client - The AWS S3 client instance.
 * @param {string} bucketName - The name of the S3 bucket containing scraped pages.
 * @param {string} siteId - The site ID whose pages should be analyzed.
 * @param {Object} log - Logger instance for info, warn, and error messages.
 * @returns {Promise<Object>} The analysis result.
 */
export async function analyzePageReadability(s3Client, bucketName, siteId, log) {
  try {
    const prefix = `scrapes/${siteId}/`;
    const objectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, prefix, log);

    if (!objectKeys || objectKeys.length === 0) {
      return {
        success: false,
        message: 'No scraped content found for readability analysis',
        readabilityIssues: [],
        urlsProcessed: 0,
      };
    }

    log.info(`[ReadabilityAnalysis] Found ${objectKeys.length} scraped objects for analysis`);

    // Process each scraped page and collect promises
    const pageAnalysisPromises = objectKeys.map(async (key) => {
      try {
        const scrapedData = await getObjectFromKey(s3Client, bucketName, key, log);

        if (!scrapedData?.scrapeResult?.rawBody) {
          log.warn(`[ReadabilityAnalysis] No rawBody found in scraped data for key: ${key}`);
          return { issues: [], processed: false };
        }

        const { finalUrl, scrapeResult: { rawBody }, scrapedAt } = scrapedData;

        // Extract page traffic data if available
        const traffic = extractTrafficFromKey(key) || 0;

        const pageIssues = await analyzePageContent(rawBody, finalUrl, traffic, log, scrapedAt);

        return {
          issues: pageIssues,
          processed: pageIssues.length > 0,
        };
      } catch (error) {
        log.error(`[ReadabilityAnalysis] Error processing scraped data for key ${key}: ${error.message}`);
        return { issues: [], processed: false };
      }
    });

    // Execute all page analyses in parallel
    const pageResults = await Promise.all(pageAnalysisPromises);

    // Collect all issues and count processed URLs
    const allReadabilityIssues = [];
    let urlsProcessed = 0;

    pageResults.forEach((result) => {
      allReadabilityIssues.push(...result.issues);
      if (result.processed) {
        urlsProcessed += 1;
      }
    });

    // Sort issues by priority (rank descending)
    allReadabilityIssues.sort((a, b) => b.rank - a.rank);

    // Limit to top 50 issues to avoid overwhelming users
    const limitedIssues = allReadabilityIssues.slice(0, 50);

    log.info(`[ReadabilityAnalysis] Found ${limitedIssues.length} readability issues across ${urlsProcessed} pages`);

    return {
      success: limitedIssues.length > 0,
      message: limitedIssues.length > 0
        ? `Found ${limitedIssues.length} readability issues`
        : 'No readability issues found',
      readabilityIssues: limitedIssues,
      urlsProcessed,
    };
  } catch (error) {
    log.error(`[ReadabilityAnalysis] Error analyzing readability: ${error.message}`, error);
    return {
      success: false,
      message: `Analysis failed: ${error.message}`,
      readabilityIssues: [],
      urlsProcessed: 0,
    };
  }
}

// Re-export the async-mystique function for consistency
export { sendReadabilityToMystique } from './async-mystique.js';
