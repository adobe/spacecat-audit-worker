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

import { fetchScrapedPage } from '../../common/scrape-fetcher.js';

/**
 * Tag length requirements (from src/metatags/constants.js)
 */
const TAG_LENGTHS = {
  title: {
    minLength: 3,
    maxLength: 75,
    idealMinLength: 40,
    idealMaxLength: 60,
  },
  description: {
    minLength: 100,
    maxLength: 175,
    idealMinLength: 140,
    idealMaxLength: 160,
  },
  h1: {
    maxLength: 75,
    idealMaxLength: 70,
  },
};

/**
 * Ensure URL has https:// protocol
 * @param {string} url - URL to normalize
 * @returns {string} URL with https:// protocol
 */
function ensureProtocol(url) {
  if (!url) return url;

  // If URL already has a protocol, return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // Add https:// protocol
  return `https://${url}`;
}

/**
 * Normalize tag value for comparison (trim, lowercase, collapse whitespace)
 * @param {string|Array} value - Tag value to normalize
 * @returns {string} Normalized value
 */
function normalizeTagValue(value) {
  if (!value) return '';

  // Handle arrays (for H1 tags)
  if (Array.isArray(value)) {
    return value.length > 0 ? normalizeTagValue(value[0]) : '';
  }

  return value
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Collapse multiple spaces to single space
}

/**
 * Check if a tag length is within acceptable range for its type
 * @param {string} tagName - Tag name ('title', 'description', 'h1')
 * @param {string} tagValue - Tag value to check
 * @returns {object} Validation result with isValid and reason
 */
function validateTagLength(tagName, tagValue) {
  if (!tagValue) {
    return { isValid: false, reason: 'Tag is empty or missing' };
  }

  const { length } = tagValue;
  const limits = TAG_LENGTHS[tagName];

  if (!limits) {
    return { isValid: true, reason: 'Unknown tag type, assuming valid' };
  }

  // Check for H1 (no minLength defined)
  if (tagName === 'h1') {
    if (length > limits.maxLength) {
      return {
        isValid: false,
        reason: `Too long (${length} chars, max ${limits.maxLength})`,
      };
    }
    if (length > limits.idealMaxLength) {
      return {
        isValid: true, // Within bounds but not ideal
        reason: `Above ideal length (${length} chars, ideal max ${limits.idealMaxLength})`,
        isIdeal: false,
      };
    }
    return { isValid: true, reason: 'Within ideal length', isIdeal: true };
  }

  // Check for title and description
  if (length < limits.minLength) {
    return {
      isValid: false,
      reason: `Too short (${length} chars, min ${limits.minLength})`,
    };
  }

  if (length > limits.maxLength) {
    return {
      isValid: false,
      reason: `Too long (${length} chars, max ${limits.maxLength})`,
    };
  }

  // Within acceptable bounds
  if (length < limits.idealMinLength || length > limits.idealMaxLength) {
    return {
      isValid: true, // Within bounds but not ideal
      reason: `Within acceptable range but outside ideal (${length} chars, ideal ${limits.idealMinLength}-${limits.idealMaxLength})`,
      isIdeal: false,
    };
  }

  return { isValid: true, reason: 'Within ideal length', isIdeal: true };
}

/**
 * Check if two tag values are similar enough to be considered the same
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {boolean} True if strings match
 */
function areTagsSimilar(str1, str2) {
  const normalized1 = normalizeTagValue(str1);
  const normalized2 = normalizeTagValue(str2);

  // Exact match after normalization
  return normalized1 === normalized2;
}

/**
 * Extract tag value from scraped content based on tag name
 * @param {object} scrapeData - Scraped page data
 * @param {string} tagName - Tag name ('title', 'description', 'h1')
 * @returns {string|Array|null} Tag value from scrape
 */
function extractTagFromScrape(scrapeData, tagName) {
  const tags = scrapeData?.scrapeResult?.tags;
  if (!tags) return null;

  const tagValue = tags[tagName];

  // Return null if missing or empty
  if (tagValue === undefined || tagValue === null) {
    return null;
  }

  // Handle arrays (H1)
  if (Array.isArray(tagValue)) {
    return tagValue.length > 0 ? tagValue : null;
  }

  // Handle strings (title, description)
  const trimmed = tagValue.toString().trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Check if a meta tags suggestion has been fixed
 * Based on src/metatags/handler.js
 *
 * A meta tags suggestion is fixed if:
 * 1. Missing/Empty Tags: Tag now exists AND matches the AI suggestion (aiSuggestion field)
 * 2. Length Issues: Tag was modified AND now matches the AI suggestion
 * 3. Duplicate Tags: Tag was modified AND now matches the AI suggestion (made unique)
 *
 * @param {object} suggestion - Suggestion object from data access
 * @param {string} siteId - Site UUID
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Check result
 */
export async function checkMetaTagsFixed(suggestion, siteId, log) {
  const data = suggestion.getData();
  let url = data?.url;
  const tagName = data?.tagName; // 'title', 'description', 'h1'
  const issue = data?.issue; // e.g., 'Missing Title', 'Title too short', 'Duplicate Title'
  const originalTagContent = data?.tagContent; // Original problematic content
  const aiSuggestion = data?.aiSuggestion; // AI-suggested fix
  const aiRationale = data?.aiRationale; // AI rationale for suggestion
  const suggestionId = suggestion.getId();

  // Check if suggestion has been edited by user
  // Note: Schema uses is_edited (with underscore) for metadata
  const isEdited = Boolean(data?.is_edited || data?.isEdited);
  // If edited, use editedSuggestion field, otherwise use original tagContent
  const expectedTagContent = isEdited && data?.editedSuggestion
    ? data.editedSuggestion : originalTagContent;

  // Ensure URL has https:// protocol
  url = ensureProtocol(url);

  log.info(`[Meta Tags] Checking suggestion ${suggestionId}`);
  log.info(`[Meta Tags]   URL: ${url}`);
  log.info(`[Meta Tags]   Tag: ${tagName}`);
  log.info(`[Meta Tags]   Issue: ${issue}`);
  log.info(`[Meta Tags]   isEdited: ${isEdited}`);
  log.info(`[Meta Tags]   Has AI Suggestion: ${Boolean(aiSuggestion)}`);
  if (isEdited) {
    log.info(`[Meta Tags]   editedTagContent: ${expectedTagContent || 'none'}`);
  }

  if (!url || !tagName || !issue) {
    log.warn(`[Meta Tags] Missing required fields for suggestion ${suggestionId}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: 'Missing required fields (url, tagName, or issue)',
      fixDetails: {},
    };
  }

  // Fetch the scraped page from S3
  log.debug(`[Meta Tags] Fetching scrape data from S3 for ${url}`);
  let scrapeData;
  try {
    scrapeData = await fetchScrapedPage(url, siteId, log);
  } catch (error) {
    log.error(`[Meta Tags] Failed to fetch scrape for ${url}: ${error.message}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: true,
      reason: `Failed to fetch scrape: ${error.message}`,
      fixDetails: { url, tagName, issue },
    };
  }

  if (!scrapeData) {
    log.warn(`[Meta Tags] No scrape data found for ${url}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: true,
      reason: 'No scrape data found',
      fixDetails: { url, tagName, issue },
    };
  }

  log.debug(`[Meta Tags] Scrape data retrieved successfully for ${url}`);

  // Extract current tag value from scrape
  const currentTagValue = extractTagFromScrape(scrapeData, tagName);
  log.debug(`[Meta Tags] Current ${tagName} value: ${currentTagValue ? JSON.stringify(currentTagValue) : 'null'}`);

  // Log comparison details if AI suggestion exists
  if (aiSuggestion) {
    const currentDisplay = Array.isArray(currentTagValue)
      ? currentTagValue.join(' | ')
      : (currentTagValue || '(missing)');
    log.info('[Meta Tags] Comparison:');
    log.info(`[Meta Tags]   Current: "${currentDisplay}"`);
    log.info(`[Meta Tags]   AI Suggested: "${aiSuggestion}"`);
    if (currentTagValue) {
      const normalizedCurrent = normalizeTagValue(currentTagValue);
      const normalizedAI = normalizeTagValue(aiSuggestion);
      const matches = normalizedCurrent === normalizedAI;
      log.info(`[Meta Tags]   Match: ${matches ? 'YES' : 'NO'}`);
      if (!matches) {
        log.info(`[Meta Tags]   Normalized Current: "${normalizedCurrent}"`);
        log.info(`[Meta Tags]   Normalized AI: "${normalizedAI}"`);
      }
    }
  }

  // Check 1: Is the issue a "Missing" issue?
  const isMissingIssue = issue.toLowerCase().includes('missing') || issue.toLowerCase().includes('empty');

  if (isMissingIssue) {
    // For missing/empty issues, check if the tag now exists
    if (currentTagValue) {
      // If edited, check if current value matches edited value
      if (isEdited && expectedTagContent) {
        if (areTagsSimilar(currentTagValue, expectedTagContent)) {
          log.info(`[Meta Tags] ✓ FIXED MANUALLY: ${tagName} matches edited value (${url})`);
          return {
            suggestionId,
            opportunityId: suggestion.getOpportunityId(),
            url,
            status: suggestion.getStatus(),
            isFixedViaAI: false,
            isFixedManually: true,
            scrapeFailed: false,
            reason: `Manual fix: ${tagName} matches edited value`,
            fixDetails: {
              tagName,
              issue,
              currentValue: currentTagValue,
              editedTagContent: expectedTagContent,
              aiSuggestion,
            },
          };
        }
      }

      // Tag now exists - check if it matches AI suggestion
      if (aiSuggestion) {
        const currentDisplay = Array.isArray(currentTagValue) ? currentTagValue.join(' | ') : currentTagValue;
        log.info(`[Meta Tags] Comparing current "${currentDisplay}" with AI suggestion "${aiSuggestion}"`);
      }
      if (aiSuggestion && areTagsSimilar(currentTagValue, aiSuggestion)) {
        log.info(`[Meta Tags] ✓ FIXED VIA AI: ${tagName} now matches AI suggestion (${url})`);
        return {
          suggestionId,
          opportunityId: suggestion.getOpportunityId(),
          url,
          status: suggestion.getStatus(),
          isFixedViaAI: true,
          isFixedManually: false,
          scrapeFailed: false,
          reason: `AI suggestion implemented: ${tagName} now matches AI recommendation`,
          fixDetails: {
            tagName,
            issue,
            aiSuggestion,
            currentValue: currentTagValue,
            aiRationale,
            isEdited,
          },
        };
      }
      // Tag exists but doesn't match AI suggestion - not fixed
      if (aiSuggestion) {
        const currentDisplay = Array.isArray(currentTagValue) ? currentTagValue.join(' | ') : currentTagValue;
        log.info(`[Meta Tags] Current "${currentDisplay}" does not match AI suggestion "${aiSuggestion}"`);
      }
      log.info(`[Meta Tags] ✗ NOT FIXED: ${tagName} exists but doesn't match AI suggestion (${url})`);
      return {
        suggestionId,
        opportunityId: suggestion.getOpportunityId(),
        url,
        status: suggestion.getStatus(),
        isFixedViaAI: false,
        isFixedManually: false,
        scrapeFailed: false,
        reason: `${tagName} tag exists but doesn't match AI suggestion`,
        fixDetails: {
          tagName,
          issue,
          currentValue: currentTagValue,
          aiSuggestion,
          isEdited,
        },
      };
    }
    // Tag still missing
    log.info(`[Meta Tags] ✗ NOT FIXED: ${tagName} still missing (${url})`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: `${tagName} tag still missing`,
      fixDetails: {
        tagName,
        issue,
        aiSuggestion,
      },
    };
  }

  // Check 2: Is the issue about length (too short/too long)?
  const isLengthIssue = issue.toLowerCase().includes('too short')
    || issue.toLowerCase().includes('too long')
    || issue.toLowerCase().includes('above ideal');

  if (isLengthIssue) {
    if (!currentTagValue) {
      // Tag is now missing - different issue
      log.info(`[Meta Tags] ✗ NEW ISSUE: ${tagName} is now missing (${url})`);
      return {
        suggestionId,
        opportunityId: suggestion.getOpportunityId(),
        url,
        status: suggestion.getStatus(),
        isFixedViaAI: false,
        isFixedManually: false,
        scrapeFailed: false,
        reason: `${tagName} tag is now missing (different issue)`,
        fixDetails: {
          tagName,
          issue,
          originalContent: originalTagContent,
          aiSuggestion,
        },
      };
    }

    // Check if tag was changed (AI or manual)
    // If edited, compare against edited value; otherwise compare against original
    const comparisonValue = isEdited && expectedTagContent
      ? expectedTagContent : originalTagContent;
    const tagChanged = !areTagsSimilar(currentTagValue, comparisonValue);

    if (tagChanged) {
      // Validate that the new tag length is acceptable
      const lengthValidation = validateTagLength(tagName, currentTagValue);

      // If edited, check if current value matches edited value
      if (isEdited && expectedTagContent && areTagsSimilar(currentTagValue, expectedTagContent)) {
        if (lengthValidation.isValid) {
          log.info(`[Meta Tags] ✓ FIXED MANUALLY: ${tagName} matches edited value and length is valid (${url})`);
          return {
            suggestionId,
            opportunityId: suggestion.getOpportunityId(),
            url,
            status: suggestion.getStatus(),
            isFixedViaAI: false,
            isFixedManually: true,
            scrapeFailed: false,
            reason: `Manual fix: ${tagName} matches edited value and length issue resolved`,
            fixDetails: {
              tagName,
              issue,
              originalContent: originalTagContent,
              editedTagContent: expectedTagContent,
              currentValue: currentTagValue,
              currentLength: currentTagValue.length,
              lengthValidation,
              aiSuggestion,
            },
          };
        }
      }

      // Tag was modified - check if it matches AI suggestion
      if (aiSuggestion) {
        const currentDisplay = Array.isArray(currentTagValue) ? currentTagValue.join(' | ') : currentTagValue;
        log.info(`[Meta Tags] Comparing current "${currentDisplay}" with AI suggestion "${aiSuggestion}"`);
      }
      if (aiSuggestion && areTagsSimilar(currentTagValue, aiSuggestion)) {
        log.info(`[Meta Tags] ✓ FIXED VIA AI: ${tagName} now matches AI suggestion (${url})`);
        return {
          suggestionId,
          opportunityId: suggestion.getOpportunityId(),
          url,
          status: suggestion.getStatus(),
          isFixedViaAI: true,
          isFixedManually: false,
          scrapeFailed: false,
          reason: `AI suggestion implemented: ${tagName} length corrected with AI recommendation`,
          fixDetails: {
            tagName,
            issue,
            originalContent: originalTagContent,
            aiSuggestion,
            currentValue: currentTagValue,
            currentLength: currentTagValue.length,
            lengthValidation,
            aiRationale,
          },
        };
      }
      // Tag changed but doesn't match AI suggestion - not fixed
      if (aiSuggestion) {
        const currentDisplay = Array.isArray(currentTagValue) ? currentTagValue.join(' | ') : currentTagValue;
        log.info(`[Meta Tags] Current "${currentDisplay}" does not match AI suggestion "${aiSuggestion}"`);
      }
      log.info(`[Meta Tags] ✗ NOT FIXED: ${tagName} was modified but doesn't match AI suggestion (${url})`);
      return {
        suggestionId,
        opportunityId: suggestion.getOpportunityId(),
        url,
        status: suggestion.getStatus(),
        isFixedViaAI: false,
        isFixedManually: false,
        scrapeFailed: false,
        reason: `${tagName} was modified but doesn't match AI suggestion`,
        fixDetails: {
          tagName,
          issue,
          originalContent: originalTagContent,
          currentValue: currentTagValue,
          currentLength: currentTagValue.length,
          lengthValidation,
          aiSuggestion,
        },
      };
    }

    // Tag unchanged
    log.info(`[Meta Tags] ✗ NOT FIXED: ${tagName} unchanged (${url})`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: `${tagName} tag unchanged, length issue persists`,
      fixDetails: {
        tagName,
        issue,
        originalContent: originalTagContent,
        currentValue: currentTagValue,
        currentLength: currentTagValue.length,
        aiSuggestion,
      },
    };
  }

  // Check 3: Is the issue about duplicates?
  const isDuplicateIssue = issue.toLowerCase().includes('duplicate');

  if (isDuplicateIssue) {
    if (!currentTagValue) {
      // Tag removed - not fixed (doesn't match AI suggestion)
      log.info(`[Meta Tags] ✗ NOT FIXED: ${tagName} removed but doesn't match AI suggestion (${url})`);
      return {
        suggestionId,
        opportunityId: suggestion.getOpportunityId(),
        url,
        status: suggestion.getStatus(),
        isFixedViaAI: false,
        isFixedManually: false,
        scrapeFailed: false,
        reason: `${tagName} removed but doesn't match AI suggestion`,
        fixDetails: {
          tagName,
          issue,
          originalContent: originalTagContent,
          aiSuggestion,
        },
      };
    }

    // Check if tag was changed to be unique
    // If edited, compare against edited value; otherwise compare against original
    const comparisonValue = isEdited && expectedTagContent
      ? expectedTagContent : originalTagContent;
    const tagChanged = !areTagsSimilar(currentTagValue, comparisonValue);

    if (tagChanged) {
      // If edited, check if current value matches edited value
      if (isEdited && expectedTagContent && areTagsSimilar(currentTagValue, expectedTagContent)) {
        log.info(`[Meta Tags] ✓ FIXED MANUALLY: ${tagName} matches edited value (${url})`);
        return {
          suggestionId,
          opportunityId: suggestion.getOpportunityId(),
          url,
          status: suggestion.getStatus(),
          isFixedViaAI: false,
          isFixedManually: true,
          scrapeFailed: false,
          reason: `Manual fix: ${tagName} matches edited value`,
          fixDetails: {
            tagName,
            issue,
            originalContent: originalTagContent,
            editedTagContent: expectedTagContent,
            currentValue: currentTagValue,
            aiSuggestion,
          },
        };
      }

      // Tag was modified - check if it matches AI suggestion
      if (aiSuggestion) {
        const currentDisplay = Array.isArray(currentTagValue) ? currentTagValue.join(' | ') : currentTagValue;
        log.info(`[Meta Tags] Comparing current "${currentDisplay}" with AI suggestion "${aiSuggestion}"`);
      }
      if (aiSuggestion && areTagsSimilar(currentTagValue, aiSuggestion)) {
        log.info(`[Meta Tags] ✓ FIXED VIA AI: ${tagName} now matches AI suggestion (${url})`);
        return {
          suggestionId,
          opportunityId: suggestion.getOpportunityId(),
          url,
          status: suggestion.getStatus(),
          isFixedViaAI: true,
          isFixedManually: false,
          scrapeFailed: false,
          reason: `AI suggestion implemented: ${tagName} made unique with AI recommendation`,
          fixDetails: {
            tagName,
            issue,
            originalContent: originalTagContent,
            aiSuggestion,
            currentValue: currentTagValue,
            aiRationale,
          },
        };
      }
      // Tag changed but doesn't match AI suggestion - not fixed
      if (aiSuggestion) {
        const currentDisplay = Array.isArray(currentTagValue) ? currentTagValue.join(' | ') : currentTagValue;
        log.info(`[Meta Tags] Current "${currentDisplay}" does not match AI suggestion "${aiSuggestion}"`);
      }
      log.info(`[Meta Tags] ✗ NOT FIXED: ${tagName} was modified but doesn't match AI suggestion (${url})`);
      return {
        suggestionId,
        opportunityId: suggestion.getOpportunityId(),
        url,
        status: suggestion.getStatus(),
        isFixedViaAI: false,
        isFixedManually: false,
        scrapeFailed: false,
        reason: `${tagName} was modified but doesn't match AI suggestion`,
        fixDetails: {
          tagName,
          issue,
          originalContent: originalTagContent,
          currentValue: currentTagValue,
          aiSuggestion,
        },
      };
    }

    // Tag unchanged - duplicate issue may still exist (need to check other pages)
    log.info(`[Meta Tags] ✗ UNCERTAIN: ${tagName} unchanged, duplicate status unclear (${url})`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: `${tagName} unchanged, duplicate issue may still exist`,
      fixDetails: {
        tagName,
        issue,
        originalContent: originalTagContent,
        currentValue: currentTagValue,
        aiSuggestion,
      },
    };
  }

  // Unknown issue type - do basic comparison
  log.info(`[Meta Tags] ✗ UNKNOWN ISSUE TYPE: ${issue} (${url})`);

  // If edited, check if current value matches edited value
  if (isEdited && expectedTagContent && currentTagValue
    && areTagsSimilar(currentTagValue, expectedTagContent)) {
    log.info(`[Meta Tags] ✓ FIXED MANUALLY: ${tagName} matches edited value (${url})`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: true,
      scrapeFailed: false,
      reason: `Manual fix: ${tagName} matches edited value`,
      fixDetails: {
        tagName,
        issue,
        originalContent: originalTagContent,
        editedTagContent: expectedTagContent,
        currentValue: currentTagValue,
        aiSuggestion,
      },
    };
  }

  // Check if tag matches AI suggestion
  if (aiSuggestion && currentTagValue) {
    const currentDisplay = Array.isArray(currentTagValue) ? currentTagValue.join(' | ') : currentTagValue;
    log.info(`[Meta Tags] Comparing current "${currentDisplay}" with AI suggestion "${aiSuggestion}"`);
  }
  if (aiSuggestion && currentTagValue && areTagsSimilar(currentTagValue, aiSuggestion)) {
    log.info(`[Meta Tags] ✓ FIXED VIA AI: ${tagName} matches AI suggestion (${url})`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: true,
      isFixedManually: false,
      scrapeFailed: false,
      reason: `AI suggestion implemented: ${tagName} matches AI recommendation`,
      fixDetails: {
        tagName,
        issue,
        originalContent: originalTagContent,
        aiSuggestion,
        currentValue: currentTagValue,
        aiRationale,
      },
    };
  }

  return {
    suggestionId,
    opportunityId: suggestion.getOpportunityId(),
    url,
    status: suggestion.getStatus(),
    isFixedViaAI: false,
    isFixedManually: false,
    scrapeFailed: false,
    reason: `Unable to determine fix status for issue type: ${issue}`,
    fixDetails: {
      tagName,
      issue,
      originalContent: originalTagContent,
      currentValue: currentTagValue,
      aiSuggestion,
    },
  };
}

export default checkMetaTagsFixed;
