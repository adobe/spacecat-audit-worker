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
import { JSDOM } from 'jsdom';
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
  pageUrl,
  traffic,
  detectedLanguages,
  getSupportedLanguage,
  log,
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
 * Analyzes readability for a single page's content
 */
export async function analyzePageContent(rawBody, pageUrl, traffic, log) {
  const readabilityIssues = [];

  try {
    const doc = new JSDOM(rawBody).window.document;

    // Get all paragraph, div, and list item elements (same as preflight)
    const textElements = Array.from(doc.querySelectorAll('p, div, li'));

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
        const hasBlockChildren = element.children.length > 0
          && !Array.from(element.children).every((child) => {
            const inlineTags = [
              'strong', 'b', 'em', 'i', 'span', 'a', 'mark',
              'small', 'sub', 'sup', 'u', 'code', 'br',
            ];
            return inlineTags.includes(child.tagName.toLowerCase());
          });

        return !hasBlockChildren;
      })
      .filter(({ element }) => {
        const textContent = element.textContent?.trim();
        return textContent && textContent.length >= MIN_TEXT_LENGTH;
      });

    // Process each element and collect analysis promises
    const analysisPromises = [];

    elementsToProcess.forEach(({ element }) => {
      const textContent = element.textContent?.trim();

      // Handle elements with <br> tags (multiple paragraphs)
      if (element.innerHTML.includes('<br')) {
        const paragraphs = element.innerHTML
          .split(/<br\s*\/?>/gi)
          .map((p) => {
            const tempDiv = doc.createElement('div');
            tempDiv.innerHTML = p;
            return tempDiv.textContent;
          })
          .map((p) => p.trim())
          .filter((p) => p.length >= MIN_TEXT_LENGTH);

        paragraphs.forEach((paragraph) => {
          const analysisPromise = analyzeTextReadability(
            paragraph,
            pageUrl,
            traffic,
            detectedLanguages,
            getSupportedLanguage,
            log,
          );
          analysisPromises.push(analysisPromise);
        });
      } else {
        const analysisPromise = analyzeTextReadability(
          textContent,
          pageUrl,
          traffic,
          detectedLanguages,
          getSupportedLanguage,
          log,
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
 * Analyzes readability for all scraped pages from S3
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

        const { finalUrl, scrapeResult: { rawBody } } = scrapedData;

        // Extract page traffic data if available
        const traffic = extractTrafficFromKey(key) || 0;

        const pageIssues = await analyzePageContent(rawBody, finalUrl, traffic, log);

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
