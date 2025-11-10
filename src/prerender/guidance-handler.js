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

import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { convertToOpportunity } from '../common/opportunity.js';
import { uploadStatusSummaryToS3 } from './handler.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';

const AUDIT_TYPE = 'prerender';

/**
 * Handles Mystique responses for prerender guidance
 * @param {Object} message - Message from Mystique with AI guidance
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Site, Suggestion } = dataAccess;
  const { siteId, auditId, data } = message;
  const { suggestions } = data || {};

  log.info(`[${AUDIT_TYPE}] Received Mystique guidance for prerender: ${JSON.stringify(message, null, 2)}`);

  // Validate audit exists
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[${AUDIT_TYPE}] No audit found for auditId: ${auditId}`);
    return notFound();
  }

  // Validate site exists
  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[${AUDIT_TYPE}] Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  log.info(`[${AUDIT_TYPE}] Processing AI guidance for site: ${siteId} and auditId: ${auditId}`);

  if (!suggestions || !Array.isArray(suggestions)) {
    log.warn(`[${AUDIT_TYPE}] No suggestions provided in Mystique response for siteId: ${siteId}`);
    return ok();
  }

  try {
    // Create opportunity and persist suggestions with AI summaries
    const opportunity = await convertToOpportunity(
      site.getBaseURL(),
      { siteId, auditId },
      context,
      createOpportunityData,
      AUDIT_TYPE,
      {},
    );

    const mapSuggestionData = (s) => ({
      url: s.url,
      organicTraffic: s.organicTraffic,
      contentGainRatio: s.contentGainRatio,
      wordCountBefore: s.wordCountBefore,
      wordCountAfter: s.wordCountAfter,
      originalHtmlKey: s.originalHtmlKey,
      prerenderedHtmlKey: s.prerenderedHtmlKey,
      aiSummary: s.aiSummary || '',
    });

    await syncSuggestions({
      context,
      opportunity,
      newData: suggestions,
      buildKey: (s) => `${s.url}|${AUDIT_TYPE}`,
      mapNewSuggestion: (s) => ({
        opportunityId: opportunity.getId(),
        type: Suggestion.TYPES.CONFIG_UPDATE,
        rank: s.organicTraffic || 0,
        data: mapSuggestionData(s),
      }),
      mergeDataFunction: (existingData, newDataItem) => ({
        ...existingData,
        ...mapSuggestionData(newDataItem),
      }),
    });

    log.info(`[${AUDIT_TYPE}] Saved ${suggestions.length} suggestions from Mystique for siteId: ${siteId}`);

    // Upload status summary now that suggestions have been created
    try {
      const auditResult = {
        totalUrlsChecked: suggestions.length,
        urlsNeedingPrerender: suggestions.length,
        results: (suggestions || []).map((s) => ({
          url: s.url,
          scrapingStatus: 'success',
          needsPrerender: true,
          wordCountBefore: s.wordCountBefore || 0,
          wordCountAfter: s.wordCountAfter || 0,
          contentGainRatio: s.contentGainRatio || 0,
          organicTraffic: s.organicTraffic || 0,
        })),
        scrapeForbidden: false,
      };

      const auditData = {
        siteId,
        auditId,
        auditedAt: new Date().toISOString(),
        auditType: AUDIT_TYPE,
        auditResult,
      };

      await uploadStatusSummaryToS3(site.getBaseURL(), auditData, context);
      log.info(`[${AUDIT_TYPE}] Uploaded status summary after guidance for siteId: ${siteId}`);
    } catch (e) {
      log.warn(`[${AUDIT_TYPE}] Failed to upload status summary after guidance: ${e.message}`);
    }
    return ok();
  } catch (error) {
    log.error(`[${AUDIT_TYPE}] Error processing Mystique guidance for siteId: ${siteId}:`, error);
    return badRequest(`Error processing guidance: ${error.message}`);
  }
}
