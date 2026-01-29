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

import { readFile } from 'fs/promises';
import { join } from 'path';
import StructuredDataValidator from '@adobe/structured-data-validator';
import { isNonEmptyArray, isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { fetchScrapedPage } from '../../common/scrape-fetcher.js';

/**
 * Parse error title to extract rootType and issue message
 * Error titles are in format: "RootType: Issue message"
 * Example: "Product: Required attribute 'price' is missing"
 *
 * @param {string} errorTitle - The error title string
 * @returns {object} Object with rootType and issueMessage
 */
function parseErrorTitle(errorTitle) {
  if (!errorTitle || typeof errorTitle !== 'string') {
    return { rootType: '', issueMessage: '' };
  }

  const parts = errorTitle.split(':');
  if (parts.length < 2) {
    return { rootType: '', issueMessage: errorTitle.trim() };
  }

  const [rootTypePart, ...rest] = parts;
  const issueMessage = rest.join(':').trim();

  return { rootType: rootTypePart.trim(), issueMessage };
}

/**
 * Check if an error from the suggestion matches a validation issue
 *
 * @param {object} suggestionError - Error from suggestion.data.errors
 * @param {object} validationIssue - Issue from validator
 * @returns {boolean} True if they match
 */
function errorsMatch(suggestionError, validationIssue) {
  const { rootType: suggestedRootType, issueMessage: suggestedMessage } = parseErrorTitle(
    suggestionError.errorTitle,
  );

  // Match by rootType and issueMessage
  return (
    validationIssue.rootType === suggestedRootType
    && validationIssue.issueMessage === suggestedMessage
  );
}

/**
 * Validate structured data from scrape result
 *
 * @param {object} scrapeData - Scrape data from S3
 * @param {object} log - Logger instance
 * @returns {Promise<Array>} Array of validation issues
 */
async function validateStructuredData(scrapeData, log) {
  const structuredData = scrapeData?.scrapeResult?.structuredData;

  // Check if structured data exists and is in the correct format
  if (isNonEmptyArray(structuredData)) {
    log.warn('[Structured-Data] Scrape contains old format of structured data, skipping validation');
    return [];
  }

  if (!isNonEmptyObject(structuredData)) {
    log.debug('[Structured-Data] No structured data found in scrape result');
    return [];
  }

  // Load Schema.org vocabulary for validation
  const schemaOrgPath = join(process.cwd(), 'static', 'schemaorg-current-https.jsonld');
  const schemaOrgJson = JSON.parse(await readFile(schemaOrgPath, 'utf8'));

  const validator = new StructuredDataValidator(schemaOrgJson);

  try {
    const validatorIssues = await validator.validate(structuredData);

    // Filter to only ERROR severity (matching audit behavior)
    return validatorIssues.filter((issue) => issue.severity === 'ERROR');
  } catch (error) {
    log.error('[Structured-Data] Failed to validate structured data:', error);
    return [];
  }
}

/**
 * Check if a structured data suggestion has been fixed
 * Based on src/structured-data/handler.js
 *
 * Detection logic:
 * 1. Check for AI-generated fixes (patches, recommendations)
 * 2. Fetch scraped page content from S3
 * 3. Extract and validate structured data
 * 4. Compare original errors with current validation results
 * 5. Determine if errors are fixed
 *
 * @param {object} suggestion - Suggestion object from data access
 * @param {string} siteId - Site UUID
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Check result
 */
export async function checkStructuredDataFixed(suggestion, siteId, log) {
  const data = suggestion.getData();
  const url = data?.url || data?.pageUrl || '';
  const originalErrors = data?.errors || [];

  // Check if suggestion has been edited by user
  const isEdited = Boolean(data?.isEdited);
  // If edited, use edited errors if available, otherwise use original errors
  const errors = isEdited && data?.errors ? data.errors : originalErrors;

  const suggestionId = suggestion.getId();

  log.info(`[Structured-Data] Checking suggestion ${suggestionId}`);
  log.info(`[Structured-Data]   pageUrl: ${url}`);
  log.info(`[Structured-Data]   isEdited: ${isEdited}`);
  log.info(`[Structured-Data]   ${isEdited ? 'edited' : 'original'} errors: ${errors.length}`);

  // Check for AI-generated fixes first
  const hasPatchContent = Boolean(data?.patchContent);
  const hasCodeChangeAvailable = Boolean(data?.isCodeChangeAvailable);
  const hasStructuredDataFix = Boolean(data?.structuredData || data?.schema);
  const hasAIRecommendation = Boolean(data?.aiRecommendation || data?.recommendation);

  const isFixedViaAI = (hasPatchContent || hasCodeChangeAvailable)
    || (hasStructuredDataFix && hasAIRecommendation);

  if (isFixedViaAI) {
    let reason = '';
    if (hasPatchContent) {
      reason = 'Code fix patch available for structured data';
    } else if (hasCodeChangeAvailable) {
      reason = 'Code change available for structured data';
    } else if (hasStructuredDataFix && hasAIRecommendation) {
      reason = 'AI-generated structured data recommendation available';
    }

    log.info(`[Structured-Data] ✓ FIXED VIA AI: ${reason} (${url})`);

    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: true,
      isFixedManually: false,
      scrapeFailed: false,
      reason,
      checkDetails: {
        hasPatchContent,
        hasCodeChangeAvailable,
        hasStructuredDataFix,
        hasAIRecommendation,
        originalErrorCount: errors.length,
      },
    };
  }

  // If no URL or errors, cannot verify
  if (!url || errors.length === 0) {
    log.warn('[Structured-Data] Missing URL or no errors in suggestion');
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: false,
      reason: 'Missing URL or no errors to check',
      checkDetails: {
        hasUrl: Boolean(url),
        errorCount: errors.length,
      },
    };
  }

  // Fetch the scraped page from S3
  log.debug(`[Structured-Data] Fetching scrape data from S3 for ${url}`);
  let scrapeData;
  try {
    scrapeData = await fetchScrapedPage(url, siteId, log);
  } catch (error) {
    log.error(`[Structured-Data] Failed to fetch scrape for ${url}: ${error.message}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: true,
      reason: `Failed to fetch scrape: ${error.message}`,
      checkDetails: {
        originalErrorCount: errors.length,
      },
    };
  }

  if (!scrapeData) {
    log.warn(`[Structured-Data] No scrape data found for ${url}`);
    return {
      suggestionId,
      opportunityId: suggestion.getOpportunityId(),
      url,
      status: suggestion.getStatus(),
      isFixedViaAI: false,
      isFixedManually: false,
      scrapeFailed: true,
      reason: 'No scrape data found for pageUrl',
      checkDetails: {
        originalErrorCount: errors.length,
      },
    };
  }

  log.debug('[Structured-Data] Scrape data retrieved successfully');

  // Validate structured data from the scraped page
  log.debug('[Structured-Data] Validating structured data');
  const currentIssues = await validateStructuredData(scrapeData, log);

  log.debug(`[Structured-Data] Current validation found ${currentIssues.length} errors`);

  // Check if structured data was removed entirely (not fixed)
  if (currentIssues.length === 0 && errors.length > 0) {
    const structuredData = scrapeData?.scrapeResult?.structuredData;
    if (!isNonEmptyObject(structuredData)) {
      log.warn(`[Structured-Data] Structured data removed from page (not fixed): ${url}`);
      return {
        suggestionId,
        opportunityId: suggestion.getOpportunityId(),
        url,
        status: suggestion.getStatus(),
        isFixedViaAI: false,
        isFixedManually: false,
        scrapeFailed: false,
        reason: 'Structured data removed from page (not considered fixed)',
        checkDetails: {
          isEdited,
          originalErrorCount: originalErrors.length,
          errorCount: errors.length,
          currentIssueCount: 0,
          structuredDataRemoved: true,
        },
      };
    }
  }

  // Compare original errors with current validation issues
  const stillPresentErrors = [];
  const fixedErrors = [];

  for (const originalError of errors) {
    const stillExists = currentIssues.some((issue) => errorsMatch(originalError, issue));

    if (stillExists) {
      stillPresentErrors.push(originalError);
    } else {
      fixedErrors.push(originalError);
    }
  }

  // Determine fix status
  const allErrorsFixed = stillPresentErrors.length === 0 && fixedErrors.length > 0;
  const someErrorsFixed = fixedErrors.length > 0 && stillPresentErrors.length > 0;
  const noErrorsFixed = fixedErrors.length === 0;

  let isFixedManually = false;
  let reason = '';

  if (allErrorsFixed) {
    isFixedManually = true;
    reason = `All ${fixedErrors.length} structured data errors have been fixed`;
    log.info(`[Structured-Data] ✓ FIXED MANUALLY: ${reason} (${url})`);
  } else if (someErrorsFixed) {
    isFixedManually = false;
    reason = `Partially fixed: ${fixedErrors.length} of ${errors.length} errors resolved, ${stillPresentErrors.length} remain`;
    log.info(`[Structured-Data] ⚠ PARTIALLY FIXED: ${reason} (${url})`);
  } else if (noErrorsFixed) {
    isFixedManually = false;
    reason = `Not fixed: All ${errors.length} errors still present`;
    log.info(`[Structured-Data] ✗ NOT FIXED: ${reason} (${url})`);
  }

  return {
    suggestionId,
    opportunityId: suggestion.getOpportunityId(),
    url,
    status: suggestion.getStatus(),
    isFixedViaAI: false,
    isFixedManually,
    scrapeFailed: false,
    reason,
    checkDetails: {
      isEdited,
      originalErrorCount: originalErrors.length,
      errorCount: errors.length,
      currentIssueCount: currentIssues.length,
      fixedErrorCount: fixedErrors.length,
      stillPresentErrorCount: stillPresentErrors.length,
      fixedErrors: fixedErrors.map((e) => e.errorTitle),
      stillPresentErrors: stillPresentErrors.map((e) => e.errorTitle),
    },
  };
}

export default checkStructuredDataFixed;
