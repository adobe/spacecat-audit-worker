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
import { Audit } from '@adobe/spacecat-shared-data-access';
import {
  badRequest, notFound, ok, noContent,
} from '@adobe/spacecat-shared-http-utils';
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
  createOffsiteLogger, errorField, AUDIT, PEER, OUTCOME,
} from '../utils/offsite-logging.js';
import {
  deleteExpiredSnapshots,
  deleteExpiredOutdatedSuggestions,
} from '../common/offsite-retention.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.YOUTUBE_ANALYSIS;
// Human prefix for the two shared, untouched utils that still log via a passed-in prefix
// string (logOffsiteLlmUsage + applyScopeToOpportunity). All other logging in this file goes
// through the bound offsite logger (createOffsiteLogger), which emits the same prefix.
const HUMAN_PREFIX = `[offsite:${AUDIT.YOUTUBE}]`;

/**
 * Classifies a presigned-analysis-fetch failure for the `audit_persistence_mystique_payload_read`
 * event's reason token:
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
 * Handles Mystique response for YouTube analysis
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

  const olog = createOffsiteLogger(log, { audit: AUDIT.YOUTUBE, siteId, auditId });

  olog.start('audit_analysis_end', 'Guidance received', {
    peer: PEER.MYSTIQUE, direction: 'inbound',
  });

  olog.start('audit_persistence_start', 'Persistence started', {});

  if (data?.error) {
    olog.failure('audit_analysis_end', 'Mystique returned an error', {
      peer: PEER.MYSTIQUE, direction: 'inbound', reason: 'mystique_error', mystiqueError: data.errorMessage,
    });
    return noContent();
  }

  let analysisData = data?.analysis;
  const { companyName, presignedUrl } = data || {};

  if (presignedUrl) {
    try {
      analysisData = await fetchAnalysisFromPresignedUrl(presignedUrl, {
        log,
        prefix: HUMAN_PREFIX,
      });
      olog.success('audit_persistence_mystique_payload_read', 'Fetched analysis from presigned URL', {
        peer: PEER.S3, direction: 'inbound',
      });
    } catch (error) {
      olog.failure('audit_persistence_mystique_payload_read', 'Error fetching from presigned URL', {
        peer: PEER.S3, direction: 'inbound', reason: classifyFetchFailure(error), ...errorField(error),
      });
      return badRequest(`Error fetching analysis data: ${error.message}`);
    }
  } else if (data?.analysis) {
    analysisData = data.analysis;
  }

  if (!analysisData) {
    olog.failure('audit_persistence_end', 'No analysis data provided in message', { reason: 'no_analysis_data' });
    return badRequest('Analysis data is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    olog.failure('audit_persistence_end', 'Site not found', { reason: 'site_not_found_at_persist' });
    return notFound('Site not found');
  }

  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      olog.failure('audit_persistence_end', 'Audit not found', { reason: 'audit_not_found' });
      return notFound('Audit not found');
    }
  }

  try {
    const brandResult = await resolveBrandResultForSite(context, site);
    const baseUrl = site.getBaseURL();
    const suggestions = analysisData.suggestions || [];
    const opportunityData = analysisData.opportunity || {};

    if (suggestions.length === 0) {
      olog.warn('audit_persistence_end', 'No suggestions found in analysis', { outcome: OUTCOME.SKIP, reason: 'no_suggestions' });
      return noContent();
    }

    olog.success('audit_analysis_end', 'Processing suggestions', {
      count: suggestions.length, companyName,
    });

    // Use the handler-owned type; the payload may only confirm it.
    const auditType = AUDIT_TYPE;
    const incomingStatus = opportunityData.status || 'NEW';

    // Validate before mutating the evergreen opportunity.
    if (!isValidOffsiteAnalysis(analysisData, auditType)) {
      olog.failure('audit_persistence_end', 'Malformed analysis payload; skipping update', { reason: 'malformed_payload' });
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
        buildKey: (suggestion) => `youtube::${suggestion.id}`,
        mapNewSuggestion: (suggestion) => ({
          opportunityId: opportunity.getId(),
          type: suggestion.type || 'CONTENT_UPDATE',
          rank: suggestion.rank,
          data: suggestion.data,
        }),
      });
      ologOpp.success('audit_persistence_evergreen_opportunity_write', `Synced ${suggestions.length} suggestions`, {
        peer: PEER.POSTGRES, direction: 'outbound', count: suggestions.length, writeAction: 'suggestions_synced',
      });
    } catch (error) {
      ologOpp.failure('audit_persistence_evergreen_opportunity_write', 'Failed to sync suggestions', {
        peer: PEER.POSTGRES, direction: 'outbound', reason: 'suggestions_write_failed', writeAction: 'suggestions_synced', ...errorField(error),
      });
      throw error;
    }

    ologOpp.success('audit_persistence_end', 'Run processed successfully', {
      count: suggestions.length, companyName,
    });
    logOffsiteLlmUsage(log, HUMAN_PREFIX, siteId, opportunityData.llmUsage);

    ologOpp.start('audit_housekeeping_start', 'Housekeeping started', {});

    // Expired suggestion deletion must not fail an otherwise successful refresh.
    try {
      await deleteExpiredOutdatedSuggestions({
        dataAccess, opportunity, siteId, auditType, log,
      });
    } catch (error) {
      ologOpp.warn('audit_housekeeping_outdated_suggestions_deleted', 'OUTDATED suggestion deletion failed', {
        peer: PEER.POSTGRES, direction: 'outbound', auditType, outcome: OUTCOME.DEGRADED, ...errorField(error),
      });
    }

    // Expired snapshot deletion must not fail an otherwise successful refresh.
    try {
      await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });
    } catch (error) {
      ologOpp.warn('audit_housekeeping_outdated_opportunities_deleted', 'Snapshot retention failed', {
        peer: PEER.POSTGRES, direction: 'outbound', auditType, outcome: OUTCOME.DEGRADED, ...errorField(error),
      });
    }

    if (auditId) {
      const audit = await AuditModel.findById(auditId);
      const auditResultData = audit?.getAuditResult();
      const slackContext = auditResultData?.slackContext;
      if (slackContext) {
        const { channelId, threadTs } = slackContext;

        // Visibility is the QA gate's decision, carried on the opportunity status
        // (NEW = customer-visible, IGNORED = suppressed).
        const slackMessage = buildAnalysisVisibilityMessage({
          analysisName: 'youtube-analysis',
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

        try {
          await postMessageOptional(context, channelId, fullMessage, { threadTs });
        } catch (error) {
          ologOpp.warn('slack_notify', 'Failed to post outcome to Slack', {
            peer: PEER.SLACK, outcome: OUTCOME.DEGRADED, ...errorField(error),
          });
        }
      }
    }

    return ok();
  } catch (error) {
    // Intentional drill-down: a failure already logged by an inner event (e.g.
    // audit_persistence_evergreen_opportunity_write) will also surface here as
    // audit_persistence_end outcome=failure — the terminal, per-run marker.
    olog.failure('audit_persistence_end', 'Error processing analysis', { reason: 'unexpected_error', ...errorField(error) }, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
