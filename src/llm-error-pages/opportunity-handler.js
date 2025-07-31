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

function categorizeErrorsByStatusCode(errorPages) {
  const groups = { 404: [], 403: [], '5xx': [] };

  errorPages.forEach((error) => {
    const { status } = error;
    if (status === '404') {
      groups['404'].push(error);
    } else if (status === '403') {
      groups['403'].push(error);
    } else if (status.startsWith('5')) {
      groups['5xx'].push(error);
    }
  });

  return groups;
}

function consolidateErrorsByUrl(errors) {
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

function sortErrorsByTrafficVolume(errors) {
  return errors.sort((a, b) => b.totalRequests - a.totalRequests);
}

/**
 * Creates an opportunity for a specific error type
 * @param {string} errorType - Error type (404, 403, 5xx)
 * @param {Array} aggregatedErrors - Processed error data
 * @param {string} siteId - Site identifier
 * @param {string} auditId - Audit identifier
 * @param {Object} context - Audit context
 * @returns {Object} Created opportunity
 */
async function createOpportunityForErrorCategory(
  errorType,
  aggregatedErrors,
  siteId,
  auditId,
  context,
) {
  const { log } = context;

  log.info(`Creating opportunity for ${errorType} errors: ${aggregatedErrors.length} URLs`);

  // Create opportunity using the existing pattern
  const opportunity = await convertToOpportunity(
    null, // No specific URL for this audit type
    { siteId, id: auditId },
    context,
    () => buildOpportunityDataForErrorType(errorType, aggregatedErrors),
    'LLM_ERROR_PAGES',
  );

  // Build suggestions data
  const buildKey = (error) => `${error.url}|${error.status}|${error.userAgent}`;

  await syncSuggestions({
    opportunity,
    newData: aggregatedErrors,
    buildKey,
    context,
    mapNewSuggestion: (error, index) => {
      // Select template based on status code
      let template = 'Fix error for {url} - {userAgent} crawler affected'; // Default template
      if (error.status === '404') {
        template = SUGGESTION_TEMPLATES.NOT_FOUND;
      } else if (error.status === '403') {
        template = SUGGESTION_TEMPLATES.FORBIDDEN;
      } else if (error.status.startsWith('5')) {
        template = SUGGESTION_TEMPLATES.SERVER_ERROR;
      }

      const suggestionText = populateSuggestion(template, error.url, error.status, error.userAgent);

      return {
        opportunityId: opportunity.getId(),
        type: 'ERROR_REMEDIATION',
        rank: index + 1, // Rank based on position (already sorted by request count)
        status: 'NEW',
        data: {
          url: error.url,
          statusCode: error.status,
          totalRequests: error.totalRequests,
          userAgent: error.userAgent,
          rawUserAgents: error.rawUserAgents,
          suggestion: suggestionText,
        },
      };
    },
    log,
  });

  log.info(`Created opportunity ${opportunity.getId()} with ${aggregatedErrors.length} suggestions for ${errorType} errors`);
  return opportunity;
}

/**
 * Main function to process LLM error pages and create opportunities
 * @param {Object} processedResults - Results from processLlmErrorPagesResults
 * @param {Object} message - Original audit message
 * @param {Object} context - Audit context
 */
export async function generateOpportunities(processedResults, message, context) {
  const { log } = context;
  const { siteId, auditId } = message;

  log.info(`Processing LLM error pages opportunities for site ${siteId}`);

  if (!processedResults.errorPages || processedResults.errorPages.length === 0) {
    log.info('No error pages found, skipping opportunity creation');
    return;
  }

  try {
    // Step 1: Group by status code categories
    const groupedErrors = categorizeErrorsByStatusCode(processedResults.errorPages);
    log.info(`Grouped errors: 404=${groupedErrors['404'].length}, 403=${groupedErrors['403'].length}, 5xx=${groupedErrors['5xx'].length}`);

    // Step 2: Process each error type
    const errorTypesWithData = Object.entries(groupedErrors)
      .filter(([, errors]) => errors.length > 0);

    // Process all error types in parallel
    const opportunityPromises = errorTypesWithData.map(async ([errorType, errors]) => {
      log.info(`Processing ${errorType} errors: ${errors.length} raw errors`);

      // Step 3: Aggregate by URL within each group
      const aggregatedErrors = consolidateErrorsByUrl(errors);
      log.info(`Aggregated ${errorType} errors: ${aggregatedErrors.length} unique URLs`);

      // Step 4: Rank suggestions by request count
      const rankedErrors = sortErrorsByTrafficVolume(aggregatedErrors);

      // Step 5: Create opportunity for this error type
      return createOpportunityForErrorCategory(
        errorType,
        rankedErrors,
        siteId,
        auditId,
        context,
      );
    });

    const createdOpportunities = await Promise.all(opportunityPromises);

    log.info(`Successfully created ${createdOpportunities.length} opportunities for LLM error pages`);
  } catch (error) {
    log.error(`Failed to process LLM error pages opportunities: ${error.message}`, error);
    throw error;
  }
}
