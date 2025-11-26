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

import {
  badRequest, noContent, notFound, ok,
} from '@adobe/spacecat-shared-http-utils';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { getJsonSummarySuggestion } from './utils.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';

async function createOpportunity(siteId, auditId, baseUrl, guidance, context) {
  const opportunity = await convertToOpportunity(
    baseUrl,
    {
      siteId,
      auditId,
      id: auditId,
    },
    context,
    createOpportunityData,
    'summarization',
    { guidance },
  );
  return opportunity;
}

async function addSuggestions(
  opportunity,
  suggestions,
  context,
) {
  const suggestionValues = getJsonSummarySuggestion(suggestions);

  await syncSuggestions({
    context,
    opportunity,
    newData: suggestionValues,
    buildKey: (suggestion) => `${suggestion.url}-${suggestion.transformRules.selector}`,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: 10,
      data: suggestion,
    }),
  });
}

/**
 * Handles Mystique response for summarization and updates pages with AI suggestions
 * @param {Object} message - Message from Mystique with presigned URL
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const {
    Audit,
    Site,
  } = dataAccess;
  const { siteId, data, auditId } = message;
  const { presignedUrl } = data;

  log.info(`[Summarization] Message received in summarization guidance handler: ${JSON.stringify(message, null, 2)}`);

  // Validate presigned URL
  if (!presignedUrl) {
    log.error('[Summarization] No presigned URL provided in message data');
    return badRequest('Presigned URL is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[Summarization] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const baseUrl = site.getBaseURL();

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[Summarization] No audit found for auditId: ${auditId}`);
    return notFound();
  }

  try {
    // Fetch summarization data from presigned URL
    log.info(`[Summarization] Fetching summarization data from presigned URL: ${presignedUrl}`);
    const response = await fetch(presignedUrl);

    if (!response.ok) {
      log.error(`[Summarization] Failed to fetch summarization data: ${response.status} ${response.statusText}`);
      return badRequest(`Failed to fetch summarization data: ${response.statusText}`);
    }

    const summarizationData = await response.json();
    const { guidance, suggestions } = summarizationData;

    // Validate the fetched data
    if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
      log.info('[Summarization] No suggestions found in the response');
      return noContent();
    }
    log.info(`[Summarization] Received summarization data with ${suggestions.length} suggestions`);

    const opportunity = await createOpportunity(
      siteId,
      auditId,
      baseUrl,
      guidance,
      context,
    );

    try {
      await addSuggestions(opportunity, suggestions, context);
    } catch (e) {
      log.error(`[Summarization] Failed to save summarization opportunity on Mystique callback: ${e.message}`);
      return badRequest('Failed to persist summarization opportunity');
    }

    log.info(`[Summarization] Successfully processed ${suggestions.length} summarization suggestions for site: ${siteId}`);
    return ok();
  } catch (error) {
    log.error(`[Summarization] Error processing summarization guidance: ${error.message}`, error);
    return badRequest(`Error processing summarization guidance: ${error.message}`);
  }
}
