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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { postMessageOptional } from '../utils/slack-utils.js';
import { resolveBrandResultForSite, applyScopeToOpportunity } from '../utils/brand-resolver.js';
import { fetchAnalysisFromPresignedUrl } from '../utils/analysis-fetch.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.WIKIPEDIA_ANALYSIS;
const LOG_PREFIX = '[Wikipedia]';

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
  // Note: any inbound `brandId` from Mystique is informational only. Scope is
  // re-resolved server-side via resolveBrandResultForSite; trusting the inbound
  // value would let a tampered message re-attribute the opportunity.
  const { siteId, auditId, data } = message;

  log.info(`${LOG_PREFIX} Received Wikipedia analysis guidance for siteId: ${siteId}, auditId: ${auditId}`);

  // Handle presigned URL (large response) or direct analysis data
  let analysisData = data?.analysis;

  // If presigned URL is provided, fetch the data
  if (data?.presignedUrl) {
    try {
      analysisData = await fetchAnalysisFromPresignedUrl(data.presignedUrl, {
        log,
        prefix: LOG_PREFIX,
      });
    } catch (error) {
      log.error(`${LOG_PREFIX} Error fetching from presigned URL: ${error.message}`);
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

  // Check if audit exists
  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      log.error(`[Wikipedia] Audit not found for auditId: ${auditId}`);
      return notFound('Audit not found');
    }
  }

  try {
    const brandResult = await resolveBrandResultForSite(context, site);
    const baseUrl = site.getBaseURL();
    const { suggestions = [], company, industryAnalysis } = analysisData;

    // If no suggestions, return early
    if (suggestions.length === 0) {
      log.info(`${LOG_PREFIX} No suggestions found in analysis`);
      return noContent();
    }

    log.info(`${LOG_PREFIX} Processing ${suggestions.length} suggestions for ${company}`);

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

    // Persist the opportunity (with scope) BEFORE syncing suggestions; see
    // cited-analysis/guidance-handler.js for the same reordering rationale.
    applyScopeToOpportunity(opportunity, brandResult, log, LOG_PREFIX);
    opportunity.setData({
      ...opportunity.getData(),
      fullAnalysis: analysisData,
    });
    await opportunity.save();

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

    log.info(`${LOG_PREFIX} Successfully processed Wikipedia analysis for site: ${siteId}, company: ${company}, ${suggestions.length} suggestions`);

    if (auditId) {
      const auditRecord = await AuditModel.findById(auditId);
      const slackContext = auditRecord?.getAuditResult()?.slackContext;
      if (slackContext) {
        const { channelId, threadTs } = slackContext;
        await postMessageOptional(
          context,
          channelId,
          `:white_check_mark: *wikipedia-analysis* audit finished for *${baseUrl}*\n`
          + `• ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} processed`,
          { threadTs },
        );
      }
    }

    return ok();
  } catch (error) {
    log.error(`[Wikipedia] Error processing Wikipedia analysis: ${error.message}`, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
