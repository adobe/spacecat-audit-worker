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
import { postMessageOptional, buildAnalysisVisibilityMessage } from '../utils/slack-utils.js';
import { resolveBrandResultForSite, applyScopeToOpportunity } from '../utils/brand-resolver.js';
import { fetchAnalysisFromPresignedUrl } from '../utils/analysis-fetch.js';
import { buildOffsiteTimingLines } from '../utils/offsite-audit-utils.js';
import {
  isValidOffsiteAnalysis,
  persistOffsiteOpportunity,
  resolveEvergreenOffsiteOpportunity,
  isSuppressedRun,
} from '../common/offsite-refresh.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.REDDIT_ANALYSIS;
const LOG_PREFIX = '[Reddit]';

/**
 * Handles Mystique response for Reddit analysis
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

  log.info(`${LOG_PREFIX} Received Reddit analysis guidance for siteId: ${siteId}, auditId: ${auditId}`);

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
    log.error('[Reddit] No analysis data provided in message');
    return badRequest('Analysis data is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[Reddit] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      log.error(`[Reddit] Audit not found for auditId: ${auditId}`);
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

    // Use the handler-owned type; the payload may only confirm it.
    const auditType = AUDIT_TYPE;
    const incomingStatus = opportunityData.status || 'NEW';

    // Validate before mutating the evergreen opportunity.
    if (!isValidOffsiteAnalysis(analysisData, auditType)) {
      log.error(`${LOG_PREFIX} Malformed analysis payload for siteId: ${siteId}; skipping update`);
      return badRequest('Malformed analysis payload');
    }

    const evergreenOpportunity = await resolveEvergreenOffsiteOpportunity({
      dataAccess, siteId, auditType, log,
    });

    // Suppressed runs create a hidden record; surfaced runs reuse the evergreen record.
    const opportunity = await persistOffsiteOpportunity(
      baseUrl,
      {
        siteId,
        auditId,
        id: auditId,
      },
      context,
      createOpportunityData,
      auditType,
      {
        opportunityData,
        existingOpportunity: isSuppressedRun(incomingStatus)
          ? null
          : evergreenOpportunity,
      },
    );

    // Save the scoped opportunity before syncing its suggestions.
    applyScopeToOpportunity(opportunity, brandResult, log, LOG_PREFIX);
    opportunity.setStatus(incomingStatus);
    // The raw analysis payload is intentionally NOT persisted on the opportunity:
    // persistOffsiteOpportunity already stores the dashboard data the UI renders and
    // suggestions are synced below as their own records. Duplicating the full
    // (localized, larger) analysis here only bloats the item.
    await opportunity.save();

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

    log.info(`${LOG_PREFIX} Successfully processed Reddit analysis for site: ${siteId}, company: ${companyName}, ${suggestions.length} suggestions`);

    if (auditId) {
      const auditRecord = await AuditModel.findById(auditId);
      const auditResultData = auditRecord?.getAuditResult();
      const slackContext = auditResultData?.slackContext;
      if (slackContext) {
        const { channelId, threadTs } = slackContext;

        // Visibility is the QA gate's decision, carried on the opportunity status
        // (NEW = customer-visible, IGNORED = suppressed).
        const slackMessage = buildAnalysisVisibilityMessage({
          analysisName: 'reddit-analysis',
          baseUrl,
          suggestionsCount: suggestions.length,
          isVisible: incomingStatus !== 'IGNORED',
          verdict: opportunityData.qaVerdict,
        });

        // Append DRS / Mystique / total phase timings (from anchors on the audit result).
        const timingLines = buildOffsiteTimingLines(auditResultData?.timings);
        const fullMessage = timingLines ? `${slackMessage}\n${timingLines}` : slackMessage;

        await postMessageOptional(context, channelId, fullMessage, { threadTs });
      }
    }

    return ok();
  } catch (error) {
    log.error(`[Reddit] Error processing Reddit analysis: ${error.message}`, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
