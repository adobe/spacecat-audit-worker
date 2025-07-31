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

import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import {
  buildOpportunityDataForErrorType,
  populateSuggestion,
  SUGGESTION_TEMPLATES,
} from './opportunity-data-mapper.js';
import { normalizeUserAgentToProvider } from './constants/user-agent-patterns.js';
import { validateUrlsBatch } from './url-validator.js';
import { processBatchedAiSuggestions, mapAiSuggestionsToErrors } from './ai-batch-processor.js';

/**
 * Categorizes error pages by status code into 404, 403, and 5xx groups
 * @param {Array} errorPages - Raw error page data from Athena
 * @returns {Object} - Object with categorized errors
 */
export function categorizeErrorsByStatusCode(errorPages) {
  const categorized = {
    404: [],
    403: [],
    '5xx': [],
  };

  errorPages.forEach((error) => {
    const statusCode = error.status?.toString();
    if (statusCode === '404') {
      categorized[404].push(error);
    } else if (statusCode === '403') {
      categorized[403].push(error);
    } else if (statusCode && statusCode.startsWith('5')) {
      categorized['5xx'].push(error);
    }
  });

  return categorized;
}

/**
 * Consolidates errors by URL + Normalized UserAgent combination
 * @param {Array} errors - Array of error objects
 * @returns {Array} - Consolidated errors with aggregated data
 */
export function consolidateErrorsByUrl(errors) {
  const urlMap = new Map();

  errors.forEach((error) => {
    // Normalize user agent to clean provider name
    const normalizedUserAgent = normalizeUserAgentToProvider(error.user_agent);
    const key = `${error.url}|${normalizedUserAgent}`;
    if (urlMap.has(key)) {
      const existing = urlMap.get(key);
      existing.totalRequests += parseInt(error.total_requests || 0, 10);
      existing.rawUserAgents.add(error.user_agent); // Track all raw UAs for this provider
    } else {
      urlMap.set(key, {
        url: error.url,
        status: error.status,
        userAgent: normalizedUserAgent, // Clean provider name (e.g., "ChatGPT")
        rawUserAgents: new Set([error.user_agent]), // Raw UA strings
        totalRequests: parseInt(error.total_requests || 0, 10),
      });
    }
  });

  return Array.from(urlMap.values()).map((item) => ({
    ...item,
    rawUserAgents: Array.from(item.rawUserAgents),
  }));
}

/**
 * Sorts consolidated errors by traffic volume (request count) in descending order
 * @param {Array} errors - Array of consolidated error objects
 * @returns {Array} - Sorted errors by traffic volume
 */
export function sortErrorsByTrafficVolume(errors) {
  return errors.sort((a, b) => b.totalRequests - a.totalRequests);
}

/**
 * Creates an opportunity for a specific error category with AI-enhanced suggestions
 * @param {string} errorType - Error type (404, 403, 5xx)
 * @param {Array} enhancedErrors - Errors with AI suggestions
 * @param {string} siteId - Site identifier
 * @param {string} auditId - Audit identifier
 * @param {Object} context - Context object with logger
 * @returns {Promise<void>}
 */
async function createOpportunityForErrorCategory(
  errorType,
  enhancedErrors,
  siteId,
  auditId,
  context,
) {
  const { log } = context;

  if (!enhancedErrors || enhancedErrors.length === 0) {
    log.info(`No validated errors for ${errorType} category - skipping opportunity creation`);
    return;
  }

  log.info(`Creating opportunity for ${errorType} errors with ${enhancedErrors.length} suggestions`);

  // Build opportunity data
  const opportunityData = buildOpportunityDataForErrorType(errorType, enhancedErrors);
  const opportunity = convertToOpportunity({
    siteId,
    auditId,
    ...opportunityData,
  });

  // Create suggestions using syncSuggestions
  await syncSuggestions({
    opportunity,
    newData: enhancedErrors,
    buildKey: (error) => `${error.url}|${error.status}|${error.userAgent}`,
    context,
    mapNewSuggestion: (error, index) => {
      // Use AI suggestion if available, otherwise fallback to template
      let suggestionText;
      let suggestedUrls = [];
      let aiRationale = null;
      let confidenceScore = null;
      let suggestionType = 'TEMPLATE';

      if (error.hasAiSuggestion && error.aiSuggestion) {
        // AI-generated suggestion
        suggestionText = `Fix ${error.status} error for ${error.url} (${error.userAgent} crawler)`;
        suggestedUrls = error.aiSuggestion.suggested_urls || [];
        aiRationale = error.aiSuggestion.aiRationale;
        confidenceScore = error.aiSuggestion.confidence_score;
        suggestionType = error.suggestionType || 'AI_GENERATED';
      } else {
        // Template fallback suggestion
        let template = 'Fix error for {url} - {userAgent} crawler affected';
        if (error.status === '404') {
          template = SUGGESTION_TEMPLATES.NOT_FOUND;
        } else if (error.status === '403') {
          template = SUGGESTION_TEMPLATES.FORBIDDEN;
        } else if (error.status.startsWith('5')) {
          template = SUGGESTION_TEMPLATES.SERVER_ERROR;
        }
        suggestionText = populateSuggestion(template, error.url, error.status, error.userAgent);
      }

      return {
        opportunityId: opportunity.getId(),
        type: 'ERROR_REMEDIATION',
        rank: index + 1,
        status: 'NEW',
        data: {
          url: error.url,
          statusCode: error.status,
          totalRequests: error.totalRequests,
          userAgent: error.userAgent,
          rawUserAgents: error.rawUserAgents,
          suggestion: suggestionText,
          suggestedUrls,
          aiRationale,
          confidenceScore,
          suggestionType,
          validatedAt: error.validatedAt,
          baselineStatus: error.baselineStatus,
          llmStatus: error.llmStatus,
          testUserAgent: error.testUserAgent,
        },
      };
    },
    log,
  });

  log.info(`Created opportunity ${opportunity.getId()} for ${errorType} errors with ${enhancedErrors.length} suggestions`);
}

/**
 * Enhanced opportunity generation with URL validation and AI suggestions
 * @param {Object} processedResults - Processed Athena query results
 * @param {Object} message - SQS message object
 * @param {Object} context - Context object with logger and other utilities
 * @returns {Promise<void>}
 */
export async function generateOpportunities(processedResults, message, context) {
  const { log } = context;
  const { siteId, auditId } = message;

  if (!processedResults?.errorPages?.length) {
    log.info('No error pages to process for opportunities');
    return;
  }

  log.info(`Starting enhanced opportunity generation for ${processedResults.errorPages.length} error pages`);

  // Step 1: Categorize errors by status code
  const categorizedErrors = categorizeErrorsByStatusCode(processedResults.errorPages);

  // Step 2: Process each error category
  const categoryPromises = Object.entries(categorizedErrors)
    .filter(([, errors]) => errors.length > 0)
    .map(async ([errorType, errors]) => {
      log.info(`Processing ${errorType} category with ${errors.length} raw errors`);

      try {
        // Step 2a: Consolidate and sort errors
        const consolidatedErrors = consolidateErrorsByUrl(errors);
        const sortedErrors = sortErrorsByTrafficVolume(consolidatedErrors);

        log.info(`Consolidated to ${sortedErrors.length} unique URL+UserAgent combinations for ${errorType}`);

        // Step 2b: Validate URLs
        log.info(`Starting URL validation for ${errorType} category`);
        const validatedUrls = await validateUrlsBatch(sortedErrors, log);

        if (validatedUrls.length === 0) {
          log.info(`No URLs passed validation for ${errorType} category - skipping`);
          return;
        }

        log.info(`${validatedUrls.length}/${sortedErrors.length} URLs passed validation for ${errorType}`);

        // Step 2c: Get AI suggestions for validated URLs
        log.info(`Processing AI suggestions for ${validatedUrls.length} validated URLs (${errorType})`);
        const aiSuggestions = await processBatchedAiSuggestions(validatedUrls, siteId, context);

        // Step 2d: Map AI suggestions back to error objects
        const enhancedErrors = mapAiSuggestionsToErrors(aiSuggestions, validatedUrls);

        const aiGeneratedCount = enhancedErrors.filter(
          (e) => e.hasAiSuggestion && !e.aiSuggestion?.is_fallback,
        ).length;
        const fallbackCount = enhancedErrors.filter(
          (e) => !e.hasAiSuggestion || e.aiSuggestion?.is_fallback,
        ).length;

        log.info(`Enhanced ${enhancedErrors.length} errors for ${errorType}: ${aiGeneratedCount} AI-generated, ${fallbackCount} template fallbacks`);

        // Step 2e: Create opportunity with enhanced suggestions
        await createOpportunityForErrorCategory(
          errorType,
          enhancedErrors,
          siteId,
          auditId,
          context,
        );
      } catch (error) {
        log.error(`Failed to process ${errorType} category: ${error.message}`, error);
        // Continue with other categories even if one fails
      }
    });

  // Step 3: Wait for all categories to complete
  await Promise.allSettled(categoryPromises);

  // Step 4: Log final summary
  const totalValidatedUrls = Object.values(categorizedErrors)
    .filter((errors) => errors.length > 0).length;

  log.info(`Enhanced opportunity generation completed for ${totalValidatedUrls} error categories`);
}
