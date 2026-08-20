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
import { buildOffsiteTimingLines, logOffsiteLlmUsage, buildOffsiteLlmUsageLine } from '../utils/offsite-audit-utils.js';
import {
  isValidOffsiteAnalysis,
  persistOffsiteOpportunity,
  resolveEvergreenOffsiteOpportunity,
  isSuppressedRun,
} from '../common/offsite-refresh.js';
import {
  prepareSuppressedRunSnapshot,
  prepareSupersededRunSnapshot,
} from '../common/offsite-snapshot.js';
import {
  createOffsiteLogger, errorField, AUDIT, PEER,
} from '../utils/offsite-logging.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.REDDIT_ANALYSIS;
// Human prefix for the two shared, untouched utils that still log via a passed-in prefix
// string (logOffsiteLlmUsage + applyScopeToOpportunity). All other logging in this file goes
// through the bound offsite logger (createOffsiteLogger), which emits the same prefix.
const HUMAN_PREFIX = `[offsite:${AUDIT.REDDIT}]`;

/**
 * Classifies a presigned-analysis-fetch failure for the `analysis_fetch` reason token:
 * URL/SSRF/shape and body-shape rejections are `validation`; network / non-2xx / timeout
 * failures are `fetch`. The messages come from analysis-fetch.js / assertPresignedUrl.
 *
 * @param {Error} error
 * @returns {'validation'|'fetch'}
 */
function classifyFetchFailure(error) {
  return /presignedUrl|not JSON|too large|content-type/i.test(error.message)
    ? 'validation'
    : 'fetch';
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
  // Note: any inbound `brandId` from Mystique is informational only. Scope is
  // re-resolved server-side via resolveBrandResultForSite; trusting the inbound
  // value would let a tampered message re-attribute the opportunity.
  const { siteId, auditId, data } = message;

  const olog = createOffsiteLogger(log, { audit: AUDIT.REDDIT, siteId, auditId });

  olog.start('guidance_receive', `Received Reddit analysis guidance for siteId: ${siteId}, auditId: ${auditId}`, {
    peer: PEER.MYSTIQUE, direction: 'inbound',
  });

  if (data?.error) {
    olog.failure('guidance_receive', `Mystique returned an error for siteId: ${siteId}, auditId: ${auditId}`, {
      peer: PEER.MYSTIQUE, direction: 'inbound', reason: 'mystique_error', mystiqueError: data.errorMessage,
    });
    return noContent();
  }

  let analysisData;
  const { companyName, presignedUrl } = data || {};

  if (presignedUrl) {
    try {
      analysisData = await fetchAnalysisFromPresignedUrl(presignedUrl, {
        log,
        prefix: HUMAN_PREFIX,
      });
      olog.success('analysis_fetch', 'Fetched analysis from presigned URL', {
        peer: PEER.S3, direction: 'inbound',
      });
    } catch (error) {
      olog.failure('analysis_fetch', 'Error fetching from presigned URL', {
        peer: PEER.S3, direction: 'inbound', reason: classifyFetchFailure(error), ...errorField(error),
      });
      return badRequest(`Error fetching analysis data: ${error.message}`);
    }
  } else if (data?.analysis) {
    analysisData = data.analysis;
  }

  if (!analysisData) {
    olog.failure('guidance_complete', 'No analysis data provided in message', { reason: 'no_analysis_data' });
    return badRequest('Analysis data is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    olog.failure('guidance_complete', `Site not found for siteId: ${siteId}`, { reason: 'site_not_found' });
    return notFound('Site not found');
  }

  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      olog.failure('guidance_complete', `Audit not found for auditId: ${auditId}`, { reason: 'audit_not_found' });
      return notFound('Audit not found');
    }
  }

  try {
    const brandResult = await resolveBrandResultForSite(context, site);
    const baseUrl = site.getBaseURL();
    const suggestions = analysisData.suggestions || [];
    const opportunityData = analysisData.opportunity || {};

    if (suggestions.length === 0) {
      olog.skip('guidance_complete', 'No suggestions found in analysis', { reason: 'no_suggestions' });
      return noContent();
    }

    olog.debug('guidance_receive', `Processing ${suggestions.length} suggestions`, {
      count: suggestions.length, companyName,
    });

    // Use the handler-owned type; the payload may only confirm it.
    const auditType = AUDIT_TYPE;
    const incomingStatus = opportunityData.status || 'NEW';

    // Validate before mutating the evergreen opportunity.
    if (!isValidOffsiteAnalysis(analysisData, auditType)) {
      olog.failure('guidance_complete', `Malformed analysis payload for siteId: ${siteId}; skipping update`, { reason: 'malformed_payload' });
      return badRequest('Malformed analysis payload');
    }

    const evergreenOpportunity = await resolveEvergreenOffsiteOpportunity({
      dataAccess, siteId, auditType, log,
    });
    const preparedOpportunityPersistence = isSuppressedRun(incomingStatus)
      ? await prepareSuppressedRunSnapshot({
        dataAccess,
        siteId,
        auditType,
        triggerAuditId: auditId,
        opportunityData,
        evergreenOpportunity,
        log,
      })
      : await prepareSupersededRunSnapshot({
        dataAccess,
        siteId,
        auditType,
        triggerAuditId: auditId,
        opportunityData,
        evergreenOpportunity,
        log,
      });

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
      preparedOpportunityPersistence,
    );

    const ologOpp = olog.with({ opportunityId: opportunity.getId() });

    // Save the scoped opportunity before syncing its suggestions.
    applyScopeToOpportunity(opportunity, brandResult, log, HUMAN_PREFIX);
    opportunity.setStatus(incomingStatus);
    opportunity.setData({
      ...opportunity.getData(),
      fullAnalysis: analysisData,
    });
    await opportunity.save();

    try {
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
      ologOpp.success('suggestion_sync', `Synced ${suggestions.length} suggestions`, {
        peer: PEER.POSTGRES, direction: 'outbound', count: suggestions.length,
      });
    } catch (error) {
      ologOpp.failure('suggestion_sync', 'Failed to sync suggestions', {
        peer: PEER.POSTGRES, direction: 'outbound', ...errorField(error),
      });
      throw error;
    }

    ologOpp.success('guidance_complete', `Successfully processed Reddit analysis for site: ${siteId}, company: ${companyName}, ${suggestions.length} suggestions`, {
      count: suggestions.length,
    });
    logOffsiteLlmUsage(log, HUMAN_PREFIX, siteId, opportunityData.llmUsage);

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

        // Append DRS / Mystique / total phase timings and the LLM cost Mystique reported.
        // Each is omitted when its data is absent (no timing anchors / no llmUsage stamp).
        const timingLines = buildOffsiteTimingLines(auditResultData?.timings);
        const llmUsageLine = buildOffsiteLlmUsageLine(opportunityData.llmUsage);
        const extraLines = [timingLines, llmUsageLine].filter(Boolean);
        const fullMessage = extraLines.length
          ? `${slackMessage}\n${extraLines.join('\n')}`
          : slackMessage;

        await postMessageOptional(context, channelId, fullMessage, { threadTs });
      }
    }

    return ok();
  } catch (error) {
    // Intentional drill-down: a failure already logged by an inner event (e.g. suggestion_sync)
    // will also surface here as guidance_complete outcome=failure — the terminal, per-run marker.
    olog.failure('guidance_complete', 'Error processing Reddit analysis', { ...errorField(error) }, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
