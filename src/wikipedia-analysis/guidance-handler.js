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
  badRequest, notFound, ok, noContent,
} from '@adobe/spacecat-shared-http-utils';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';

import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.WIKIPEDIA_ANALYSIS;

/**
 * Creates an opportunity for Wikipedia analysis
 * @param {string} siteId - The site ID
 * @param {string} auditId - The audit ID
 * @param {string} baseUrl - The base URL
 * @param {Array} guidance - The guidance array
 * @param {Object} context - The context
 * @returns {Promise<Object>} The opportunity
 */
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
    AUDIT_TYPE,
    { guidance },
  );
  return opportunity;
}

/**
 * Gets rank based on priority
 * @param {string} priority - The priority level
 * @returns {number} The rank
 */
function getRankFromPriority(priority) {
  const priorityRanks = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };
  return priorityRanks[priority] ?? 4;
}

/**
 * Handles Mystique response for Wikipedia analysis
 * @param {Object} message - Message from Mystique with analysis results
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site, Audit: AuditModel } = dataAccess;
  const { siteId, auditId, data } = message;

  log.info(`[Wikipedia] Received Wikipedia analysis guidance for siteId: ${siteId}, auditId: ${auditId}`);

  // Handle presigned URL (large response) or direct analysis data
  let analysisData = data?.analysis;

  // If presigned URL is provided, fetch the data
  if (data?.presignedUrl) {
    try {
      log.info(`[Wikipedia] Fetching analysis data from presigned URL: ${data.presignedUrl}`);
      const response = await fetch(data.presignedUrl);

      if (!response.ok) {
        log.error(`[Wikipedia] Failed to fetch analysis data: ${response.status} ${response.statusText}`);
        return badRequest(`Failed to fetch analysis data: ${response.statusText}`);
      }

      analysisData = await response.json();
    } catch (error) {
      log.error(`[Wikipedia] Error fetching from presigned URL: ${error.message}`);
      return badRequest(`Error fetching analysis data: ${error.message}`);
    }
  }

  // Validate analysis data
  if (!analysisData) {
    log.error('[Wikipedia] No analysis data provided in message');
    return badRequest('Analysis data is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[Wikipedia] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const baseUrl = site.getBaseURL();

  // Check if audit exists
  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      log.error(`[Wikipedia] Audit not found for auditId: ${auditId}`);
      return notFound('Audit not found');
    }
  }

  try {
    const { suggestions = [], company, industryAnalysis } = analysisData;

    // If no suggestions, return early
    if (suggestions.length === 0) {
      log.info('[Wikipedia] No suggestions found in analysis');
      return noContent();
    }

    log.info(`[Wikipedia] Processing ${suggestions.length} suggestions for ${company}`);

    // Create guidance object (must be an object, not an array, per Opportunity schema)
    const guidance = {
      insight: `Wikipedia analysis identified ${suggestions.length} improvement opportunities for ${company}`,
      rationale: industryAnalysis
        ? `Based on comparison with ${industryAnalysis.industry} competitors`
        : 'Based on Wikipedia best practices analysis',
      recommendation: 'Review and implement the suggested improvements to enhance Wikipedia presence and LLM citability',
      type: 'CONTENT_UPDATE',
    };

    // Create opportunity
    const opportunity = await createOpportunity(
      siteId,
      auditId,
      baseUrl,
      guidance,
      context,
    );

    await syncSuggestions({
      context,
      opportunity,
      newData: suggestions,
      buildKey: (suggestion) => `wikipedia::${suggestion.id}`,
      mapNewSuggestion: (suggestion) => ({
        opportunityId: opportunity.getId(),
        type: 'CONTENT_UPDATE',
        rank: getRankFromPriority(suggestion.priority),
        data: suggestion,
      }),
    });

    // Store the full analysis in the opportunity data
    opportunity.setData({
      ...opportunity.getData(),
      fullAnalysis: analysisData,
    });
    await opportunity.save();

    log.info(`[Wikipedia] Successfully processed Wikipedia analysis for site: ${siteId}, company: ${company}, ${suggestions.length} suggestions`);
    return ok();
  } catch (error) {
    log.error(`[Wikipedia] Error processing Wikipedia analysis: ${error.message}`, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
