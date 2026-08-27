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
import {
  createOffsiteLogger, errorField, AUDIT, PEER, OUTCOME,
} from '../utils/offsite-logging.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.WIKIPEDIA_ANALYSIS;
// Human prefix for the two shared, untouched utils that still log via a passed-in prefix
// string (applyScopeToOpportunity + fetchAnalysisFromPresignedUrl). All other logging in this
// file goes through the bound offsite logger (createOffsiteLogger), which emits the same prefix.
const HUMAN_PREFIX = `[offsite:${AUDIT.WIKIPEDIA}]`;

/**
 * Classifies a presigned-analysis-fetch failure for the
 * `audit_persistence_mystique_payload_s3_read` event's reason token:
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
 * Posts an audit-outcome message to the Slack thread the audit was triggered from,
 * if a slackContext was captured on the audit. No-op when there is no auditId,
 * no audit record, or no slackContext (e.g. a non-Slack-triggered run).
 * @param {Object} context - Context object with data access
 * @param {string} auditId - The audit ID
 * @param {string} text - The message text to post
 * @returns {Promise<void>}
 */
async function postWikipediaOutcomeToSlack(context, auditId, text) {
  if (!auditId) {
    return;
  }
  const { log, dataAccess } = context;
  // Posting is a best-effort side-effect: a DB/lookup failure here must never crash
  // the primary handler (this runs on graceful noContent paths, some outside the
  // main try/catch). postMessageOptional already swallows Slack API errors; guard
  // the preceding findById the same way.
  try {
    const auditRecord = await dataAccess.Audit.findById(auditId);
    const slackContext = auditRecord?.getAuditResult()?.slackContext;
    if (!slackContext) {
      return;
    }
    const { channelId, threadTs } = slackContext;
    await postMessageOptional(context, channelId, text, { threadTs });
  } catch (e) {
    createOffsiteLogger(log, { audit: AUDIT.WIKIPEDIA, auditId })
      .warn('slack_notify', 'Failed to post outcome to Slack', { peer: PEER.SLACK, ...errorField(e) });
  }
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

  const olog = createOffsiteLogger(log, { audit: AUDIT.WIKIPEDIA, siteId, auditId });

  olog.start('audit_analysis_mystique_response_received', 'Guidance received', {
    peer: PEER.MYSTIQUE, direction: 'inbound',
  });

  olog.start('audit_persistence_start', 'Persistence started', {});

  const site = await Site.findById(siteId);
  if (!site) {
    olog.failure('audit_persistence_end', 'Site not found', { reason: 'site_not_found_at_persist' });
    return notFound('Site not found');
  }
  const baseUrl = site.getBaseURL();

  // Mystique couldn't complete the analysis (e.g. an upstream producer/service
  // failure). Report it to the Slack thread instead of failing silently, then stop.
  if (data?.error) {
    olog.failure('audit_analysis_mystique_response_received', 'Mystique returned an error', {
      peer: PEER.MYSTIQUE, direction: 'inbound', reason: 'mystique_error', mystiqueError: data.errorMessage,
    });
    await postWikipediaOutcomeToSlack(
      context,
      auditId,
      `:warning: *wikipedia-analysis* audit for *${baseUrl}* couldn't run — the analysis failed${data.errorMessage ? ` (${data.errorMessage})` : ''}.`,
    );
    return noContent();
  }

  // Handle presigned URL (large response) or direct analysis data
  let analysisData = data?.analysis;

  // If presigned URL is provided, fetch the data
  if (data?.presignedUrl) {
    try {
      analysisData = await fetchAnalysisFromPresignedUrl(data.presignedUrl, {
        log,
        prefix: HUMAN_PREFIX,
      });
      olog.success('audit_persistence_mystique_payload_s3_read', 'Fetched analysis from presigned URL', {
        peer: PEER.S3, direction: 'inbound',
      });
    } catch (error) {
      olog.failure('audit_persistence_mystique_payload_s3_read', 'Error fetching from presigned URL', {
        peer: PEER.S3, direction: 'inbound', reason: classifyFetchFailure(error), ...errorField(error),
      });
      return badRequest(`Error fetching analysis data: ${error.message}`);
    }
  }

  // Validate analysis data
  if (!analysisData) {
    olog.failure('audit_persistence_end', 'No analysis data provided in message', { reason: 'no_analysis_data' });
    return badRequest('Analysis data is required');
  }

  // Check if audit exists
  if (auditId) {
    const audit = await AuditModel.findById(auditId);
    if (!audit) {
      olog.failure('audit_persistence_end', 'Audit not found', { reason: 'audit_not_found' });
      return notFound('Audit not found');
    }
  }

  try {
    const brandResult = await resolveBrandResultForSite(context, site);
    const {
      suggestions = [], company: companyName, industryAnalysis, wikipediaUrl,
    } = analysisData;

    // No suggestions means either no Wikipedia page exists to analyze, or the page
    // was analyzed but had nothing to improve. Report the outcome to Slack — this
    // path used to return silently, so a Slack-triggered run showed only the trigger.
    if (suggestions.length === 0) {
      olog.warn('audit_persistence_end', 'No suggestions found in analysis', { outcome: OUTCOME.SKIP, reason: 'no_suggestions' });
      const outcomeMessage = wikipediaUrl
        ? `:white_check_mark: *wikipedia-analysis* audit finished for *${baseUrl}*\n`
          + '• Wikipedia page analyzed — no improvement suggestions found'
        : `:warning: *wikipedia-analysis* audit for *${baseUrl}* couldn't run — no Wikipedia page was found to analyze`;
      await postWikipediaOutcomeToSlack(context, auditId, outcomeMessage);
      return noContent();
    }

    olog.success('audit_analysis_mystique_response_received', 'Processing suggestions', {
      count: suggestions.length, companyName,
    });

    // Create guidance object (must be an object, not an array, per Opportunity schema)
    const guidance = {
      insight: `Wikipedia analysis identified ${suggestions.length} improvement opportunities for ${companyName}`,
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

    const ologOpp = olog.with({ opportunityId: opportunity.getId() });

    // Persist the opportunity (with scope) BEFORE syncing suggestions; see
    // cited-analysis/guidance-handler.js for the same reordering rationale.
    applyScopeToOpportunity(opportunity, brandResult, log, HUMAN_PREFIX);
    opportunity.setData({
      ...opportunity.getData(),
      fullAnalysis: analysisData,
    });
    await opportunity.save();
    ologOpp.success('audit_persistence_evergreen_opportunity_write', 'Opportunity persisted', {
      peer: PEER.POSTGRES, direction: 'outbound', writeAction: 'created',
    });

    try {
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

    await postWikipediaOutcomeToSlack(
      context,
      auditId,
      `:white_check_mark: *wikipedia-analysis* audit finished for *${baseUrl}*\n`
      + `• ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} processed`,
    );

    return ok();
  } catch (error) {
    // Intentional drill-down: a failure already logged by an inner event (e.g.
    // audit_persistence_evergreen_opportunity_write) will also surface here as
    // audit_persistence_end outcome=failure — the terminal, per-run marker.
    olog.failure('audit_persistence_end', 'Error processing analysis', { reason: 'unexpected_error', ...errorField(error) }, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
