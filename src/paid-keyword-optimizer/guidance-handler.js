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
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import {
  mapToKeywordOptimizerOpportunity,
  mapToKeywordOptimizerSuggestion,
  isLowSeverityGuidanceBody,
} from './guidance-opportunity-mapper.js';
import { createPaidLogger } from '../paid/paid-log.js';

const GUIDANCE_TYPE = 'ad-intent-mismatch';
const MAX_OPPORTUNITIES_PER_TYPE = 4;

/**
 * Infers the recommendation type from an array of suggestion objects.
 * - 'audit_required': at least one suggestion has a suggestionText field
 * - 'modify_heading': at least one suggestion has a variationChanges field
 * - 'unknown': neither field is present
 * @param {Array} suggestions - Array of suggestion objects
 * @returns {string} The inferred recommendation type
 */
function inferRecommendationType(suggestions) {
  if (suggestions?.some((s) => s.suggestionText)) return 'audit_required';
  if (suggestions?.some((s) => s.variationChanges)) return 'modify_heading';
  return 'unknown';
}

/**
 * Reconciles audit_required opportunities to stay within the per-site cap.
 * modify_heading opportunities (those with variationChanges) are never removed.
 * When audit_required count exceeds MAX_OPPORTUNITIES_PER_TYPE, the newest
 * excess opportunities and their suggestions are removed.
 * @param {Array} activeOpportunities - Active (NEW, system) ad-intent-mismatch opportunities
 * @param {Object} dataAccess - Data access object with Opportunity and Suggestion
 * @param {Object} log - Logger
 * @param {string} siteId - Site ID for logging
 */
async function reconcileOpportunities(activeOpportunities, dataAccess, log, siteId) {
  const { Opportunity, Suggestion } = dataAccess;

  // Classify each opportunity by loading its suggestions
  const classified = await Promise.all(
    activeOpportunities.map(async (oppty) => {
      const suggestions = await oppty.getSuggestions();
      const suggestionData = suggestions?.[0]?.getData();
      const type = inferRecommendationType(suggestionData?.variations || []);
      return { oppty, type, suggestions };
    }),
  );

  // Only audit_required are capped; modify_heading are protected (never removed)
  const auditRequired = classified.filter(({ type }) => type === 'audit_required');

  if (auditRequired.length <= MAX_OPPORTUNITIES_PER_TYPE) {
    return;
  }

  // Sort oldest first (keep), newest last (remove)
  auditRequired.sort(
    (a, b) => new Date(a.oppty.getUpdatedAt()) - new Date(b.oppty.getUpdatedAt()),
  );

  const excess = auditRequired.slice(MAX_OPPORTUNITIES_PER_TYPE);

  const suggestionIdsToRemove = excess.flatMap(
    ({ suggestions }) => suggestions.map((s) => s.getId()),
  );
  const opptyIdsToRemove = excess.map(({ oppty }) => oppty.getId());

  if (suggestionIdsToRemove.length > 0) {
    await Suggestion.removeByIds(suggestionIdsToRemove);
  }
  await Opportunity.removeByIds(opptyIdsToRemove);

  log.info(
    `[ad-intent-mismatch] Reconciliation: removed ${opptyIdsToRemove.length} excess `
    + `audit_required opportunities for site ${siteId}`,
  );
}

/**
 * Handler for ad intent mismatch guidance responses from mystique.
 *
 * Message format (GuidanceWithBody pattern):
 * {
 *   auditId, siteId,
 *   data: {
 *     url, guidance: [{
 *       insight, rationale, recommendation, type,
 *       body: { issueSeverity, suggestions, cpc, sumTraffic, url }
 *     }],
 *     suggestions: []
 *   }
 * }
 * @param {Object} message - Message from mystique
 * @param {Object} context - Execution context
 * @returns {Promise<Response>} HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { guidance } = data;
  const guidanceBody = guidance?.[0]?.body;
  const url = guidanceBody?.url || data?.url;
  const paidLog = createPaidLogger(log, GUIDANCE_TYPE);

  paidLog.received(siteId, url, auditId);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    paidLog.failed('no audit found', siteId, url, auditId);
    return notFound();
  }

  // Check for empty guidance or low severity and skip if so
  if (!guidance || guidance.length === 0 || isLowSeverityGuidanceBody(guidanceBody)) {
    paidLog.skipping('low issue severity or empty guidance', siteId, url, auditId);
    return ok();
  }

  // Always create opportunity + suggestion first
  const entity = mapToKeywordOptimizerOpportunity(siteId, audit, message);
  const opportunity = await Opportunity.create(entity);
  paidLog.createdOpportunity(siteId, url, opportunity.getId());

  const suggestionData = mapToKeywordOptimizerSuggestion(
    context,
    opportunity.getId(),
    message,
  );
  await Suggestion.create(suggestionData);
  paidLog.createdSuggestion(opportunity.getId(), siteId, url, auditId);

  // Re-read fresh state for same-URL marking and reconciliation
  const newOpportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
  const sameTypeOpportunities = newOpportunities
    .filter((oppty) => oppty.getType() === 'ad-intent-mismatch')
    .filter((oppty) => oppty.getUpdatedBy() === 'system');

  // Mark existing same-URL opportunities as IGNORED
  const existingMatches = sameTypeOpportunities
    .filter((oppty) => oppty.getData()?.url === url)
    .filter((oppty) => oppty.getId() !== opportunity.getId());

  const ignoredIds = new Set();
  if (existingMatches.length > 0) {
    existingMatches.forEach((oldOppty) => {
      oldOppty.setStatus('IGNORED');
      ignoredIds.add(oldOppty.getId());
    });
    await Opportunity.saveMany(existingMatches);
    existingMatches.forEach((oldOppty) => {
      paidLog.markedIgnored(oldOppty.getId(), siteId, url, auditId);
    });
  }

  // Reconcile: enforce cap on audit_required, never touch modify_heading
  const activeOpportunities = sameTypeOpportunities
    .filter((oppty) => !ignoredIds.has(oppty.getId()));
  await reconcileOpportunities(activeOpportunities, dataAccess, log, siteId);

  return ok();
}

export {
  inferRecommendationType,
  reconcileOpportunities,
  MAX_OPPORTUNITIES_PER_TYPE,
};
