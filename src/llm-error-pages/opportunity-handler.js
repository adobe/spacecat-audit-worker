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

/* eslint-disable no-await-in-loop */

import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import {
  buildOpportunityDataForErrorType,
  populateSuggestion,
  SUGGESTION_TEMPLATES,
} from './opportunity-data-mapper.js';
import { normalizeUserAgentToProvider } from './constants/user-agent-patterns.js';
import { validateUrlsBatch } from './url-validator.js';

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

export async function sendWithRetry(error, context, opportunity, maxRetries = 3) {
  const {
    sqs, env, site,
  } = context;

  const message = {
    type: 'guidance:llm-error-pages',
    siteId: site.getId?.() || 'unknown',
    auditId: opportunity.auditId || 'unknown',
    deliveryType: site?.getDeliveryType?.() || 'aem_edge',
    time: new Date().toISOString(),
    data: {
      brokenUrl: `${site.getBaseURL()}${error.url}`,
      userAgent: error.userAgent,
      statusCode: error.status,
      totalRequests: error.totalRequests,
      opportunityId: opportunity.getId(),
      rawUserAgents: error.rawUserAgents,
      validatedAt: error.validatedAt,
    },
  };

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      return { success: true, error: null };
    } catch (sqsError) {
      /* c8 ignore next 3 */
      if (attempt === maxRetries) {
        return { success: false, error: sqsError };
      }
      /* c8 ignore next */
      await new Promise((resolve) => {
        setTimeout(resolve, 1000 * attempt);
      });
    }
  }
  /* c8 ignore next */
  return { success: false, error: new Error('Max retries exceeded') };
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
export async function createOpportunityForErrorCategory(
  errorType,
  enhancedErrors,
  siteId,
  auditId,
  context,
) {
  const { log, sqs, env } = context;

  if (!enhancedErrors || enhancedErrors.length === 0) {
    log.info(`No validated errors for ${errorType} category - skipping opportunity creation`);
    /* c8 ignore next */
    return;
  }

  log.info(`Creating opportunity for ${errorType} errors with ${enhancedErrors.length} suggestions`);

  // Build opportunity data
  const opportunityData = buildOpportunityDataForErrorType(errorType, enhancedErrors);
  const opportunity = await convertToOpportunity({
    siteId,
    auditId,
    ...opportunityData,
  });

  // Create suggestions based on error type
  if (errorType === '404') {
    log.info(`Created opportunity ${opportunity.getId()} for ${errorType} errors - suggestions will be created by Mystique`);
  } else {
    // Create informational template suggestions for 403/5xx errors
    await syncSuggestions({
      opportunity,
      newData: enhancedErrors,
      buildKey: (error) => `${error.url}|${error.status}|${error.userAgent}`,
      context,
      mapNewSuggestion: (error, index) => {
        // Template suggestion for 403/5xx errors
        let template = 'Fix error for {url} - {userAgent} crawler affected';
        if (error.status === '403') {
          template = SUGGESTION_TEMPLATES.FORBIDDEN;
        } else if (error.status.startsWith('5')) {
          template = SUGGESTION_TEMPLATES.SERVER_ERROR;
        }
        const suggestionText = populateSuggestion(
          template,
          error.url,
          error.status,
          error.userAgent,
        );

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
            suggestedUrls: [], // No alternatives for 403/5xx
            aiRationale: null,
            confidenceScore: null,
            suggestionType: 'INFORMATIONAL',
            validatedAt: error.validatedAt,
          },
        };
      },
      log,
    });

    log.info(`Created opportunity ${opportunity.getId()} for ${errorType} errors with ${enhancedErrors.length} informational suggestions`);
  }

  // Send SQS messages to Mystique for 404 errors only with enhanced error handling
  if (errorType === '404' && sqs && env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.info(`Sending ${enhancedErrors.length} 404 URLs to Mystique for AI processing`);

    // Enhanced error handling with retry logic and partial failure reporting
    const stats = {
      total: enhancedErrors.length,
      successful: 0,
      failed: 0,
      failedUrls: [],
    };

    // Process all URLs with batch error handling - FIX: Pass all required parameters
    const results = await Promise.allSettled(
      enhancedErrors.map((error) => sendWithRetry(error, context, opportunity, 3)),
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        /* c8 ignore next */
        stats.successful += 1;
      } else {
        stats.failed += 1;
        stats.failedUrls.push(enhancedErrors[index].url);
        const errorMsg = result.status === 'fulfilled'
          ? result.value.error.message
          : result.reason;
        log.error(`Failed to send 404 URL to Mystique for ${enhancedErrors[index].url}: ${errorMsg}`);
      }
    });

    log.info(`Completed sending 404 URLs to Mystique: ${stats.successful}/${stats.total} successful, ${stats.failed} failed`);
    if (stats.failed > 0) {
      log.warn(`Failed URLs: ${stats.failedUrls.join(', ')}`);
    }
  }
}

/**
 * Enhanced opportunity generation with URL validation and AI suggestions
 * @param {Object} processedResults - Processed Athena query results
 * @param {Object} message - SQS message object
 * @param {Object} context - Context object with logger and other utilities
 * @returns {Promise<void>}
 */
export async function generateOpportunities(processedResults, message, context) {
  const { log, dataAccess, env } = context;

  if (!message) {
    log.error('Missing required message data');
    return { status: 'error', reason: 'Missing required message data' };
  }

  if (!env || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.info('Missing required SQS queue configuration');
    return { status: 'skipped', reason: 'Missing SQS configuration' };
  }

  const { siteId, auditId } = message;
  const { Site } = dataAccess;

  const site = await Site.findById(siteId);

  if (!processedResults?.errorPages?.length) {
    log.info('No LLM error pages found, skipping opportunity generation');
    return { status: 'skipped', reason: 'No error pages to process' };
  }

  log.info(`Processing ${processedResults.totalErrors || processedResults.errorPages.length} LLM error pages for opportunity generation`);

  const categorizedErrors = categorizeErrorsByStatusCode(processedResults.errorPages);

  const categoryPromises = Object.entries(categorizedErrors)
    .filter(([, errors]) => errors.length > 0)
    .map(async ([errorType, errors]) => {
      log.info(`Processing ${errorType} category with ${errors.length} raw errors`);

      try {
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

        let enhancedErrors;

        if (errorType === '404') {
          log.info(`Prepared ${validatedUrls.length} validated 404 URLs for Mystique AI processing`);

          enhancedErrors = validatedUrls;
        } else {
          log.info(`Prepared ${validatedUrls.length} validated ${errorType} URLs for template suggestions`);

          enhancedErrors = validatedUrls;
        }

        await createOpportunityForErrorCategory(
          errorType,
          enhancedErrors,
          siteId,
          auditId,
          { ...context, site },
        );
      } catch (error) {
        log.error(`Failed to process ${errorType} category: ${error.message}`, error);
        // Continue with other categories even if one fails
      }
    });

  await Promise.allSettled(categoryPromises);

  const totalProcessedUrls = Object.values(categorizedErrors)
    .reduce((sum, errors) => sum + errors.length, 0);

  log.info(`Enhanced opportunity generation completed for ${totalProcessedUrls} total error URLs`);

  return {
    status: 'completed',
    processedUrls: totalProcessedUrls,
    categorizedErrors,
  };
}
