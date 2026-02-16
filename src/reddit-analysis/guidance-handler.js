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

import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';

const AUDIT_TYPE = 'reddit-analysis';

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
 * Handles Mystique response for Reddit analysis
 * @param {Object} message - Message from Mystique with analysis results
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site, Audit: AuditModel } = dataAccess;
  const { siteId, auditId, data } = message;

  log.info(`[Reddit] Received Reddit analysis guidance for siteId: ${siteId}, auditId: ${auditId}`);

  let analysisData = data?.analysis;

  if (data?.presignedUrl) {
    try {
      log.info(`[Reddit] Fetching analysis data from presigned URL: ${data.presignedUrl}`);
      const response = await fetch(data.presignedUrl);

      if (!response.ok) {
        log.error(`[Reddit] Failed to fetch analysis data: ${response.status} ${response.statusText}`);
        return badRequest(`Failed to fetch analysis data: ${response.statusText}`);
      }

      analysisData = await response.json();
    } catch (error) {
      log.error(`[Reddit] Error fetching from presigned URL: ${error.message}`);
      return badRequest(`Error fetching analysis data: ${error.message}`);
    }
  }

  if (!analysisData) {
    log.error('[Reddit] No analysis data provided in message');
    return badRequest('Analysis data is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[Reddit] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const baseUrl = site.getBaseURL();

  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      log.error(`[Reddit] Audit not found for auditId: ${auditId}`);
      return notFound('Audit not found');
    }
  }

  try {
    const { suggestions = [], company, industryAnalysis } = analysisData;

    if (suggestions.length === 0) {
      log.info('[Reddit] No suggestions found in analysis');
      return noContent();
    }

    log.info(`[Reddit] Processing ${suggestions.length} suggestions for ${company}`);

    const guidance = {
      insight: `Reddit analysis identified ${suggestions.length} improvement opportunities for ${company}`,
      rationale: industryAnalysis
        ? `Based on comparison with ${industryAnalysis.industry} competitors`
        : 'Based on Reddit community and sentiment best practices',
      recommendation: 'Review and implement the suggested improvements to enhance Reddit presence',
      type: 'CONTENT_UPDATE',
    };

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

    await syncSuggestions({
      context,
      opportunity,
      newData: suggestions,
      buildKey: (suggestion) => `reddit::${suggestion.id}`,
      mapNewSuggestion: (suggestion) => ({
        opportunityId: opportunity.getId(),
        type: 'CONTENT_UPDATE',
        rank: getRankFromPriority(suggestion.priority),
        data: suggestion,
      }),
    });

    opportunity.setData({
      ...opportunity.getData(),
      fullAnalysis: analysisData,
    });
    await opportunity.save();

    log.info(`[Reddit] Successfully processed Reddit analysis for site: ${siteId}, company: ${company}, ${suggestions.length} suggestions`);
    return ok();
  } catch (error) {
    log.error(`[Reddit] Error processing Reddit analysis: ${error.message}`, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
