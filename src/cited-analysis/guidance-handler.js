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
import { Audit } from '@adobe/spacecat-shared-data-access';

import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { postMessageOptional } from '../utils/slack-utils.js';
import { resolveBrandResultForSite, applyScopeToOpportunity } from '../utils/brand-resolver.js';
import { fetchAnalysisFromPresignedUrl } from '../utils/analysis-fetch.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.CITED_ANALYSIS;
const LOG_PREFIX = '[Cited]';

/**
 * Handles Mystique response for Cited analysis
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

  log.info(`${LOG_PREFIX} Received cited analysis guidance for siteId: ${siteId}, auditId: ${auditId}`);

  if (data?.error) {
    log.error(`${LOG_PREFIX} Mystique returned an error for siteId: ${siteId}, auditId: ${auditId}: ${data.errorMessage}`);
    return noContent();
  }

  let analysisData;
  const { companyName, presignedUrl } = data || {};

  if (presignedUrl) {
    try {
      analysisData = await fetchAnalysisFromPresignedUrl(presignedUrl, {
        log,
        prefix: LOG_PREFIX,
      });
    } catch (error) {
      log.error(`${LOG_PREFIX} Error fetching from presigned URL: ${error.message}`);
      return badRequest(`Error fetching analysis data: ${error.message}`);
    }
  } else if (data?.analysis) {
    analysisData = data.analysis;
  }

  if (!analysisData) {
    log.error('[Cited] No analysis data provided in message');
    return badRequest('Analysis data is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[Cited] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      log.error(`[Cited] Audit not found for auditId: ${auditId}`);
      return notFound('Audit not found');
    }
  }

  try {
    const brandResult = await resolveBrandResultForSite(context, site);
    const baseUrl = site.getBaseURL();
    const suggestions = analysisData.suggestions || [];
    const opportunityData = analysisData.opportunity || {};

    if (suggestions.length === 0) {
      log.info(`${LOG_PREFIX} No suggestions found in analysis`);
      return noContent();
    }

    log.info(`${LOG_PREFIX} Processing ${suggestions.length} suggestions for ${companyName}`);

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

    // Persist the opportunity (with scope) BEFORE syncing suggestions. Reversed
    // ordering avoids the partial-write window where syncSuggestions succeeds
    // but opportunity.save() throws — that previously left suggestions orphaned
    // against an unsaved opportunity, which re-runs would observe in an
    // unrecoverable state.
    applyScopeToOpportunity(opportunity, brandResult, log, LOG_PREFIX);
    const status = opportunityData.status || 'NEW';
    opportunity.setStatus(status);
    opportunity.setData({
      ...opportunity.getData(),
      fullAnalysis: analysisData,
    });
    await opportunity.save();

    await syncSuggestions({
      context,
      opportunity,
      newData: suggestions,
      buildKey: (suggestion) => `cited::${suggestion.id}`,
      mapNewSuggestion: (suggestion) => ({
        opportunityId: opportunity.getId(),
        type: suggestion.type || 'CONTENT_UPDATE',
        rank: suggestion.rank,
        data: suggestion.data,
      }),
    });

    log.info(`${LOG_PREFIX} Successfully processed cited analysis for site: ${siteId}, company: ${companyName}, ${suggestions.length} suggestions`);

    if (auditId) {
      const auditRecord = await AuditModel.findById(auditId);
      const slackContext = auditRecord?.getAuditResult()?.slackContext;
      if (slackContext) {
        const { channelId, threadTs } = slackContext;
        await postMessageOptional(
          context,
          channelId,
          `:white_check_mark: *cited-analysis* audit finished for *${site.getBaseURL()}*\n`
          + `• ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} processed`,
          { threadTs },
        );
      }
    }

    return ok();
  } catch (error) {
    log.error(`[Cited] Error processing cited analysis: ${error.message}`, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
