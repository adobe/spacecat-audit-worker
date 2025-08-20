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
import { buildOpportunityDataForErrorType } from './opportunity-data-mapper.js';
import { normalizeUserAgentToProvider, validateUrlsBatch } from './utils.js';

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

export async function createOpportunityForErrorCategory(
  errorType,
  enhancedErrors,
  siteId,
  auditId,
  context,
) {
  const {
    log, sqs, env, site,
  } = context;

  if (!enhancedErrors || enhancedErrors.length === 0) {
    log.info(`No validated errors for ${errorType} category - skipping opportunity creation`);
    /* c8 ignore next */
    return;
  }

  log.info(`Creating opportunity for ${errorType} errors with ${enhancedErrors.length} suggestions`);

  // Build opportunity data
  const opportunityData = buildOpportunityDataForErrorType(errorType, enhancedErrors);

  // Debug: Log the parameters being passed to convertToOpportunity
  const siteIdFromSite = site.getId();
  log.info(`Creating opportunity with siteId: ${siteIdFromSite}, auditId: ${auditId}`);

  const opportunity = await convertToOpportunity(
    site.getBaseURL?.() || 'unknown',
    { siteId: siteIdFromSite, id: auditId },
    context,
    () => opportunityData,
    /* TODO: replace with Audit.AUDIT_TYPES.LLM_ERROR_PAGES once constant is available
     * in shared library */
    'llm-error-pages',
  );

  // Create suggestions based on error type
  if (errorType === '404') {
    // Create placeholder suggestions so Mystique can later update the same records
    await syncSuggestions({
      opportunity,
      newData: enhancedErrors,
      buildKey: (error) => `${error.url}|${error.userAgent}`,
      context,
      mapNewSuggestion: (error, index) => {
        const suggestionId = `llm-${error.url}-${error.userAgent}`;
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
            suggestedUrls: [], // Mystique will fill
            aiRationale: null,
            confidenceScore: null,
            suggestionType: 'REDIRECT_UPDATE',
            suggestionId,
            suggestion: `Placeholder for ${error.url}`,
            validatedAt: error.validatedAt,
          },
        };
      },
      log,
    });

    log.info(`Created opportunity ${opportunity.getId()} for ${errorType} errors with ${enhancedErrors.length} placeholder suggestions (awaiting Mystique)`);
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
          template = 'Fix error for {url} - {userAgent} crawler affected';
        } else if (error.status.startsWith('5')) {
          template = 'Fix error for {url} - {userAgent} crawler affected';
        }
        const suggestionText = template.replace('{url}', error.url).replace('{userAgent}', error.userAgent);

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

  // Send SQS messages to Mystique for 404 errors only
  if (errorType === '404' && sqs && env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    const baseURL = site?.getBaseURL?.() || '';

    const messages = enhancedErrors.map((error) => ({
      type: 'guidance:broken-links',
      siteId,
      auditId: opportunity.auditId || auditId || 'unknown',
      deliveryType: site?.getDeliveryType?.() || 'aem_edge',
      time: new Date().toISOString(),
      data: {
        brokenLinks: [{
          urlFrom: error.userAgent, // Use user agent as "from" context
          urlTo: baseURL ? `${baseURL}${error.url}` : error.url,
          suggestionId: `llm-${error.url}-${error.userAgent}`,
        }],
        alternativeUrls: [], // Will be populated by Mystique from site analysis
        opportunityId: opportunity.getId(),
      },
    }));

    await Promise.allSettled(
      messages.map((msg) => sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, msg)),
    );

    log.info(`Queued ${messages.length} validated 404 URLs to Mystique for AI processing`);
  }
}

/**
 * Processes a single error category end-to-end and may throw on failure.
 */
export async function processCategory(errorType, errors, siteId, auditId, context, site) {
  const { log } = context;
  log.info(`Processing ${errorType} category with ${errors.length} raw errors`);
  const consolidatedErrors = consolidateErrorsByUrl(errors);
  const sortedErrors = sortErrorsByTrafficVolume(consolidatedErrors);
  log.info(`Consolidated to ${sortedErrors.length} unique URL+UserAgent combinations for ${errorType}`);
  log.info(`Starting URL validation for ${errorType} category`);
  const validatedUrls = await validateUrlsBatch(sortedErrors, log);
  if (validatedUrls.length === 0) {
    log.info(`No URLs passed validation for ${errorType} category - skipping`);
    return;
  }
  log.info(`${validatedUrls.length}/${sortedErrors.length} URLs passed validation for ${errorType}`);
  const enhancedErrors = validatedUrls;
  if (errorType === '404') {
    log.info(`Prepared ${validatedUrls.length} validated 404 URLs for Mystique AI processing`);
  } else {
    log.info(`Prepared ${validatedUrls.length} validated ${errorType} URLs for template suggestions`);
  }
  await createOpportunityForErrorCategory(
    errorType,
    enhancedErrors,
    siteId,
    auditId,
    { ...context, site },
  );
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
    // Continue without SQS - will create opportunities but not send to Mystique
  }

  const { siteId: messageSiteId, auditId } = message;
  let effectiveAuditId = auditId;
  if (!effectiveAuditId) {
    // generate stable id per run
    effectiveAuditId = `llm-${Date.now()}`;
  }
  let { site } = context;
  let siteId = messageSiteId;

  // Try to find site if not in context
  if (!site && messageSiteId) {
    site = await dataAccess.Site.findById(messageSiteId);
  }

  // Ensure we have a valid site
  if (!site) {
    const errorMessage = messageSiteId
      ? `Site not found for siteId: ${messageSiteId}`
      : 'No site provided in context or message';

    log.error(`Site not found. siteId in message: ${messageSiteId}`);
    throw new Error(errorMessage);
  }

  siteId = site.getId();
  if (!processedResults?.errorPages?.length) {
    log.info('No LLM error pages found, skipping opportunity generation');
    return { status: 'skipped', reason: 'No error pages to process' };
  }

  log.info(`Processing ${processedResults.totalErrors || processedResults.errorPages.length} LLM error pages for opportunity generation`);

  const categorizedErrors = categorizeErrorsByStatusCode(processedResults.errorPages);

  // Process categories sequentially to prevent race-conditions on the same Opportunity record.
  // TODO: revisit if we ever split into one-opportunity-per-category.
  for (const [errorType, errors] of Object.entries(categorizedErrors)) {
    if (errors.length > 0) {
      try {
        await processCategory(errorType, errors, siteId, effectiveAuditId, context, site);
      } catch (error) {
        log.error(`Failed to process ${errorType} category: ${error.message}`, error);
      }
    }
  }

  const totalProcessedUrls = Object.values(categorizedErrors)
    .reduce((sum, errors) => sum + errors.length, 0);

  log.info(`Enhanced opportunity generation completed for ${totalProcessedUrls} total error URLs`);

  return {
    status: 'completed',
    processedUrls: totalProcessedUrls,
    categorizedErrors,
  };
}
