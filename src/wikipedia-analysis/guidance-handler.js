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
    log.warn(`${LOG_PREFIX} Failed to post outcome to Slack: ${e.message}`);
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

  log.info(`${LOG_PREFIX} Received Wikipedia analysis guidance for siteId: ${siteId}, auditId: ${auditId}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[Wikipedia] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }
  const baseUrl = site.getBaseURL();

  // Mystique couldn't complete the analysis (e.g. an upstream producer/service
  // failure). Report it to the Slack thread instead of failing silently, then stop.
  if (data?.error) {
    log.error(`${LOG_PREFIX} Mystique returned an error for siteId: ${siteId}, auditId: ${auditId}: ${data.errorMessage}`);
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
    const {
      suggestions = [], company, industryAnalysis, wikipediaUrl,
    } = analysisData;

    // No suggestions means either no Wikipedia page exists to analyze, or the page
    // was analyzed but had nothing to improve. Report the outcome to Slack — this
    // path used to return silently, so a Slack-triggered run showed only the trigger.
    if (suggestions.length === 0) {
      log.info(`${LOG_PREFIX} No suggestions found in analysis`);
      const outcomeMessage = wikipediaUrl
        ? `:white_check_mark: *wikipedia-analysis* audit finished for *${baseUrl}*\n`
          + '• Wikipedia page analyzed — no improvement suggestions found'
        : `:warning: *wikipedia-analysis* audit for *${baseUrl}* couldn't run — no Wikipedia page was found to analyze`;
      await postWikipediaOutcomeToSlack(context, auditId, outcomeMessage);
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

    await postWikipediaOutcomeToSlack(
      context,
      auditId,
      `:white_check_mark: *wikipedia-analysis* audit finished for *${baseUrl}*\n`
      + `• ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} processed`,
    );

    return ok();
  } catch (error) {
    log.error(`[Wikipedia] Error processing Wikipedia analysis: ${error.message}`, error);
    return badRequest(`Error processing analysis: ${error.message}`);
  }
}
