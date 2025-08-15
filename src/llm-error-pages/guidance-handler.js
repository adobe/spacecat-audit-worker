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

import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';

/**
 * Handles Mystique responses for LLM error pages and updates suggestions with AI data
 * @param {Object} message - Message from Mystique with AI suggestions
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Audit, Suggestion, Site, Opportunity,
  } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    suggestedUrls, aiRationale, confidenceScore, opportunityId,
    brokenUrl, userAgent, statusCode, totalRequests,
  } = data;

  log.info(`Message received in LLM error pages guidance handler: ${JSON.stringify(message, null, 2)}`);

  // Validate site exists
  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound('Audit not found');
  }

  // Validate opportunity exists
  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity) {
    log.error(`[LLMErrorPagesGuidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[LLMErrorPagesGuidance] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  // Create suggestion from Mystique response
  const suggestionData = {
    opportunityId,
    type: 'ERROR_REMEDIATION',
    rank: confidenceScore || 1, // Use AI confidence score for ranking
    status: 'NEW',
    data: {
      url: brokenUrl,
      statusCode,
      userAgent,
      totalRequests,
      suggestion: `Fix 404 error for ${brokenUrl} (${userAgent} crawler)`,
      suggestedUrls: suggestedUrls || [],
      aiRationale: aiRationale || '',
      confidenceScore: confidenceScore || 0,
      suggestionType: 'REDIRECT_URLS',
      aiProcessedAt: new Date().toISOString(),
    },
  };

  const newSuggestion = await Suggestion.create(suggestionData);
  log.info(`[LLMErrorPagesGuidance] Created new suggestion ${newSuggestion.getId()} for ${brokenUrl}: ${suggestedUrls?.length || 0} suggested URLs, confidence: ${confidenceScore}`);

  return ok();
}
