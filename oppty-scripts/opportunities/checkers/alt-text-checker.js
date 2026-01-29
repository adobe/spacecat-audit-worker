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

import { load } from 'cheerio';
import { fetchScrapedPage } from '../../common/scrape-fetcher.js';

/**
 * Normalize URL for comparison (remove trailing slashes, query params, fragments)
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
/* eslint-disable-next-line no-unused-vars */
function normalizeImageUrl(url) {
  if (!url) return '';

  let normalized = url.trim();

  // Remove query parameters and fragments for comparison
  const parts = normalized.split('?');
  [normalized] = parts;
  const hashParts = normalized.split('#');
  [normalized] = hashParts;

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Remove ./ from URLs (e.g., https://example.com/./image.png -> https://example.com/image.png)
  normalized = normalized.replace(/\/\.\//g, '/');

  // Also handle cases where URL ends with /. (without trailing slash after dot)
  normalized = normalized.replace(/\/\.(?=\/|$)/g, '');

  return normalized.toLowerCase();
}

/**
 * Extract filename (asset fingerprint) from a URL
 * @param {string} url - URL to extract filename from
 * @returns {string} Filename or empty string if not found
 */
function extractFilename(url) {
  if (!url) return '';

  // Remove query parameters and fragments
  const urlWithoutParams = url.split('?')[0].split('#')[0];

  // Extract the last part of the path (filename)
  const parts = urlWithoutParams.split('/').filter((part) => part.length > 0);
  const [filename] = parts.slice(-1);

  return (filename || '').toLowerCase();
}

/**
 * Check if two image URLs match by comparing only the asset fingerprint (filename)
 * @param {string} url1 - First image URL
 * @param {string} url2 - Second image URL
 * @param {string} _baseUrl - Base URL (unused, kept for API compatibility)
 * @returns {boolean} True if filenames match
 */
/* eslint-disable-next-line no-unused-vars */
function imageUrlsMatch(url1, url2, _baseUrl) {
  if (!url1 || !url2) return false;

  // Extract and compare only the filename (asset fingerprint)
  const filename1 = extractFilename(url1);
  const filename2 = extractFilename(url2);

  return filename1 === filename2 && filename1 !== '';
}

/**
 * Check if an element matches the given XPath
 * Note: Cheerio doesn't support XPath directly, so we use a heuristic approach
 * based on tag name, attributes, and position
 *
 * @param {object} element - Cheerio element
 * @param {string} xpath - XPath string
 * @returns {boolean} True if element likely matches the XPath
 */
function elementMatchesXPath(element, xpath) {
  if (!xpath) return false;

  // Extract tag name from XPath (e.g., "//img[@id='hero']" -> "img")
  const tagMatch = xpath.match(/\/\/(\w+)/);
  if (tagMatch && tagMatch[1]) {
    const expectedTag = tagMatch[1].toLowerCase();
    const actualTag = element[0]?.name?.toLowerCase();

    if (actualTag !== expectedTag) {
      return false;
    }
  }

  // Extract attributes from XPath (e.g., [@id='hero'] or [@class='banner'])
  const attrMatches = xpath.matchAll(/@(\w+)=['"]([^'"]+)['"]/g);
  for (const match of attrMatches) {
    const attrName = match[1];
    const attrValue = match[2];
    const actualValue = element.attr(attrName);

    if (!actualValue || actualValue !== attrValue) {
      return false;
    }
  }

  return true;
}

/**
 * Validate that alt text is non-empty and meaningful
 * @param {string} altText - Alt text to validate
 * @returns {object} Validation result with isValid and reason
 */
function validateAltText(altText) {
  // Check if alt attribute exists and is not undefined
  if (altText === undefined || altText === null) {
    return {
      isValid: false,
      reason: 'Alt attribute is missing',
    };
  }

  // Trim whitespace
  const trimmed = altText.trim();

  // Check for empty string
  if (trimmed === '') {
    return {
      isValid: false,
      reason: 'Alt text is empty or whitespace-only',
    };
  }

  // Valid non-empty alt text found
  return {
    isValid: true,
    reason: 'Valid alt text found',
    altText: trimmed,
  };
}

/**
 * Find image element in HTML that matches the suggestion criteria
 * @param {object} $ - Cheerio instance
 * @param {object} recommendation - Recommendation data from suggestion
 * @param {string} pageUrl - Current page URL
 * @returns {object|null} Matched element info or null
 */
function findMatchingImage($, recommendation, pageUrl) {
  const { imageUrl, xpath } = recommendation;

  // Find all img elements
  const images = $('img');

  for (let i = 0; i < images.length; i += 1) {
    const img = images.eq(i);
    const src = img.attr('src');

    // Check if image URL matches
    const urlMatches = imageUrlsMatch(src, imageUrl, pageUrl);

    // Check if XPath matches (if provided)
    const xpathMatches = xpath ? elementMatchesXPath(img, xpath) : true;

    // If both match, this is likely our image
    if (urlMatches && xpathMatches) {
      return {
        element: img,
        src,
        index: i,
      };
    }
  }

  // If no exact match, try URL-only match as fallback
  for (let i = 0; i < images.length; i += 1) {
    const img = images.eq(i);
    const src = img.attr('src');

    if (imageUrlsMatch(src, imageUrl, pageUrl)) {
      return {
        element: img,
        src,
        index: i,
        matchType: 'url-only',
      };
    }
  }

  return null;
}

/**
 * Check if an alt-text suggestion has been fixed on the live page
 *
 * Detection logic:
 * 1. Fetch scraped page content from S3
 * 2. Find the image element using imageUrl and xpath
 * 3. Verify the image has non-empty alt text
 * 4. Handle edge cases (missing alt, empty alt, whitespace-only)
 *
 * @param {object} suggestion - Suggestion object from data access
 * @param {string} siteId - Site UUID
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Check result
 */
export async function checkAltTextFixed(suggestion, siteId, log) {
  const data = suggestion.getData();
  const recommendations = data?.recommendations;
  let recommendation = null;
  if (recommendations && recommendations.length > 0) {
    [recommendation] = recommendations;
  }

  if (!recommendation) {
    log.warn('[Alt-Text] No recommendation data found in suggestion');
    return {
      suggestionId: suggestion.getId(),
      opportunityId: suggestion.getOpportunityId(),
      url: data?.pageUrl || '',
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: 'No recommendation data found',
      fixDetails: {},
      checkDetails: {},
    };
  }

  const {
    pageUrl,
    imageUrl,
    xpath,
    isDecorative,
    isAppropriate,
    altText: suggestedAltText,
    language,
    id: recommendationId,
  } = recommendation;
  const suggestionId = suggestion.getId();

  // Check if suggestion has been edited by user
  // Schema: edited value stored at data.recommendations[].altText
  const isEdited = Boolean(data?.isEdited);
  // If edited, use the edited altText from recommendation, otherwise use original
  // suggestedAltText. Note: When edited, recommendation.altText contains the user's
  // edited value
  const expectedAltText = isEdited && recommendation.altText
    ? recommendation.altText : suggestedAltText;

  log.info(`[Alt-Text] Checking suggestion ${suggestionId}`);
  log.info(`[Alt-Text]   pageUrl: ${pageUrl}`);
  log.info(`[Alt-Text]   imageUrl: ${imageUrl}`);
  log.info(`[Alt-Text]   xpath: ${xpath || 'not provided'}`);
  log.info(`[Alt-Text]   isDecorative: ${isDecorative}`);
  log.info(`[Alt-Text]   isAppropriate: ${isAppropriate}`);
  log.info(`[Alt-Text]   isEdited: ${isEdited}`);
  log.info(`[Alt-Text]   suggestedAltText: ${suggestedAltText || 'none'}`);
  if (isEdited) {
    log.info(`[Alt-Text]   editedAltText: ${expectedAltText || 'none'}`);
  }

  if (!pageUrl || !imageUrl) {
    log.warn('[Alt-Text] Missing pageUrl or imageUrl');
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url: pageUrl || '',
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: 'Missing pageUrl or imageUrl',
      fixDetails: {
        imageUrl: imageUrl || null,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
      },
      checkDetails: {
        pageUrl: pageUrl || null,
        imageUrl: imageUrl || null,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
      },
    };
  }

  // Fetch the scraped page from S3
  log.debug(`[Alt-Text] Fetching scrape data from S3 for ${pageUrl}`);
  let scrapeData;
  try {
    scrapeData = await fetchScrapedPage(pageUrl, siteId, log);
  } catch (error) {
    log.error(`[Alt-Text] Failed to fetch scrape for ${pageUrl}: ${error.message}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url: pageUrl,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: true,
      reason: `Failed to fetch scrape: ${error.message}`,
      fixDetails: {
        imageUrl,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
      },
      checkDetails: {
        pageUrl,
        imageUrl,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
      },
    };
  }

  if (!scrapeData) {
    log.warn(`[Alt-Text] No scrape data found for ${pageUrl}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url: pageUrl,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: true,
      reason: 'No scrape data found for pageUrl',
      fixDetails: {
        imageUrl,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
      },
      checkDetails: {
        pageUrl,
        imageUrl,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
      },
    };
  }

  log.debug(`[Alt-Text] Scrape data retrieved successfully for ${pageUrl}`);

  // Get HTML content from scrapeResult.rawBody (primary location)
  const html = scrapeData.scrapeResult?.rawBody
    || scrapeData.scrapeResult?.content
    || scrapeData.html
    || '';

  if (!html) {
    log.error(`[Alt-Text] No HTML content found in scrape data for ${pageUrl}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url: pageUrl,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: true,
      reason: 'No HTML content in scrape data',
      fixDetails: {
        imageUrl,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
        hasRawBody: Boolean(scrapeData.scrapeResult?.rawBody),
      },
      checkDetails: {
        pageUrl,
        imageUrl,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
        hasRawBody: Boolean(scrapeData.scrapeResult?.rawBody),
        scrapeDataKeys: Object.keys(scrapeData),
        scrapeResultKeys: scrapeData.scrapeResult ? Object.keys(scrapeData.scrapeResult) : [],
      },
    };
  }

  log.debug(`[Alt-Text] HTML content found (${html.length} characters)`);

  const $ = load(html);

  // Find the matching image element
  log.debug('[Alt-Text] Searching for matching image element');
  const matchedImage = findMatchingImage($, recommendation, pageUrl);

  if (!matchedImage) {
    log.info(`[Alt-Text] ✗ NOT FIXED: Image element not found on page (${pageUrl} → ${imageUrl})`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url: pageUrl,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: 'Image element not found on page',
      fixDetails: {
        imageUrl,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
        searchedImages: $('img').length,
      },
      checkDetails: {
        pageUrl,
        imageUrl,
        xpath,
        isDecorative,
        isAppropriate,
        suggestedAltText,
        searchedImages: $('img').length,
      },
    };
  }

  log.debug(`[Alt-Text] Found matching image (match type: ${matchedImage.matchType || 'full'})`);

  // Check if image has alt attribute
  const altText = matchedImage.element.attr('alt');
  const validation = validateAltText(altText);

  // Check for AI-generated alt text matching actual data
  const hasImprovedText = Boolean(data?.improvedText);
  const hasAISuggestion = Boolean(data?.aiSuggestion);
  let isFixedViaAI = false;

  if (hasImprovedText || hasAISuggestion) {
    const aiText = (data.improvedText || data.aiSuggestion || '').trim();
    const actualAltText = validation.isValid ? validation.altText : '';

    if (aiText && actualAltText && aiText === actualAltText) {
      isFixedViaAI = true;
      log.info(`[Alt-Text] ✓ FIXED VIA AI: AI-generated alt text matches actual data "${actualAltText}" (${pageUrl} → ${imageUrl})`);
    }
  }

  // Build check details
  const checkDetails = {
    pageUrl,
    imageUrl,
    imageSrc: matchedImage.src,
    xpath,
    matchType: matchedImage.matchType || 'full',
    altAttributeExists: altText !== undefined,
    altText: validation.altText || altText,
    suggestedAltText,
    isEdited,
    expectedAltText: isEdited ? expectedAltText : undefined,
    isDecorative,
    isAppropriate,
    language,
    recommendationId,
    improvedText: data?.improvedText,
    aiSuggestion: data?.aiSuggestion,
    aiRationale: data?.aiRationale,
  };

  // Determine if fixed manually
  let isFixedManually = false;
  let reason = '';

  if (isFixedViaAI) {
    reason = `AI-generated alt text matches actual data: "${validation.altText}"`;
  } else if (validation.isValid) {
    // If suggestion was edited, check if current alt text matches the edited value
    if (isEdited && expectedAltText) {
      const currentAltTextTrimmed = validation.altText;
      const expectedAltTextTrimmed = expectedAltText.trim();

      if (currentAltTextTrimmed === expectedAltTextTrimmed) {
        // Matches edited value - fixed via user edit
        isFixedManually = true;
        reason = `Image has alt text matching edited value: "${currentAltTextTrimmed}"`;
        log.info(`[Alt-Text] ✓ FIXED MANUALLY: Image alt text matches edited value "${currentAltTextTrimmed}" (${pageUrl} → ${imageUrl})`);
      } else {
        // Has alt text but doesn't match edited value
        reason = `Image has alt text "${currentAltTextTrimmed}" but doesn't match edited value "${expectedAltTextTrimmed}"`;
        log.info(`[Alt-Text] ✗ NOT FIXED: ${reason} (${pageUrl} → ${imageUrl})`);
      }
    } else {
      // Not fixed - alt text exists but doesn't match AI suggestion or edited value
      reason = validation.reason;
      log.info(`[Alt-Text] ✗ NOT FIXED: ${reason} (${pageUrl} → ${imageUrl})`);
    }
  } else {
    // Not fixed
    reason = validation.reason;
    log.info(`[Alt-Text] ✗ NOT FIXED: ${reason} (${pageUrl} → ${imageUrl})`);
  }

  return {
    suggestionId,
    opportunityId: suggestion.getOpportunityId(),
    url: pageUrl,
    status: suggestion.getStatus(),
    isFixedViaAI,
    isFixedManually,
    scrapeFailed: false,
    reason,
    fixDetails: {
      // Image-specific details
      imageUrl,
      imageSrc: matchedImage.src,
      xpath,
      matchType: matchedImage.matchType || 'full',

      // Alt text details
      altAttributeExists: altText !== undefined,
      altText: validation.altText || altText,
      suggestedAltText,
      isEdited,
      expectedAltText: isEdited ? expectedAltText : undefined,

      // Image properties
      isDecorative,
      isAppropriate,
      language,
      recommendationId,

      // AI-generated details
      improvedText: data?.improvedText,
      aiSuggestion: data?.aiSuggestion,
      aiRationale: data?.aiRationale,

      // Additional context (empty for now, can be populated if needed)
      linkText: '',
      parentTag: '',
      parentClass: '',
      parentId: '',
      elementContext: `Image at index ${matchedImage.index}, match type: ${matchedImage.matchType || 'full'}`,
    },
    checkDetails,
  };
}

export default checkAltTextFixed;
