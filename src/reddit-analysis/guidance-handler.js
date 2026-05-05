/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { postMessageOptional } from '../utils/slack-utils.js';
import { resolveBrandForSite, applyScopeToOpportunity } from '../utils/brand-resolver.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.REDDIT_ANALYSIS;

/**
 * Handles Mystique response for Reddit analysis
 * @param {Object} message - Message from Mystique with analysis results
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site, Audit: AuditModel } = dataAccess;
  const {
    siteId, auditId, brandId, data,
  } = message;

  log.info(`[Reddit] Received Reddit analysis guidance for siteId: ${siteId}, auditId: ${auditId}${brandId ? `, brandId: ${brandId}` : ''}`);

  if (data?.error) {
    log.error(`[Reddit] Mystique returned an error for siteId: ${siteId}, auditId: ${auditId}: ${data.errorMessage}`);
    return noContent();
  }

  let analysisData;
  const { companyName, presignedUrl } = data || {};

  if (presignedUrl) {
    try {
      log.info(`[Reddit] Fetching analysis data from presigned URL: ${presignedUrl}`);
      const response = await fetch(presignedUrl);

      if (!response.ok) {
        log.error(`[Reddit] Failed to fetch analysis data: ${response.status} ${response.statusText}`);
        return badRequest(`Failed to fetch analysis data: ${response.statusText}`);
      }

      analysisData = await response.json();
    } catch (error) {
      log.error(`[Reddit] Error fetching from presigned URL: ${error.message}`);
      return badRequest(`Error fetching analysis data: ${error.message}`);
    }
  } else if (data?.analysis) {
    analysisData = data.analysis;
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

  const brand = await resolveBrandForSite(context, site);
  const baseUrl = site.getBaseURL();

  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      log.error(`[Reddit] Audit not found for auditId: ${auditId}`);
      return notFound('Audit not found');
    }
  }

  try {
    const suggestions = analysisData.suggestions || [];
    const opportunityData = analysisData.opportunity || {};

    if (suggestions.length === 0) {
      log.info('[Reddit] No suggestions found in analysis');
      return noContent();
    }

    log.info(`[Reddit] Processing ${suggestions.length} suggestions for ${companyName}`);

    const auditType = opportunityData.type || AUDIT_TYPE;

    const opportunity = await convertToOpportunity(
      baseUrl,
      {
        siteId,
        auditId,
        id: auditId,
      },
      context,
      createOpportunityData,
      auditType,
      { opportunityData },
      (oppty) => oppty.getAuditId() === auditId,
    );

    await syncSuggestions({
      context,
      opportunity,
      newData: suggestions,
      buildKey: (suggestion) => `reddit::${suggestion.id}`,
      mapNewSuggestion: (suggestion) => ({
        opportunityId: opportunity.getId(),
        type: suggestion.type || 'CONTENT_UPDATE',
        rank: suggestion.rank,
        data: suggestion.data,
      }),
    });

    applyScopeToOpportunity(opportunity, brand, log, '[Reddit]');
    const status = opportunityData.status || 'NEW';
    opportunity.setStatus(status);
    opportunity.setData({
      ...opportunity.getData(),
      fullAnalysis: analysisData,
    });
    await opportunity.save();

    log.info(`[Reddit] Successfully processed Reddit analysis for site: ${siteId}, company: ${companyName}, ${suggestions.length} suggestions`);

    if (auditId) {
      const auditRecord = await AuditModel.findById(auditId);
      const slackContext = auditRecord?.getAuditResult()?.slackContext;
      if (slackContext) {
        const { channelId, threadTs } = slackContext;
        await postMessageOptional(
          context,
          channelId,
          `:white_check_mark: *reddit-analysis* audit finished for *${site.getBaseURL()}*\n`
          + `• ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} processed`,
          { threadTs },
        );
      }
    }

    return ok();
  } catch (error) {
    log.error(`[Reddit] Error processing Reddit analysis: ${error.message}`, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
