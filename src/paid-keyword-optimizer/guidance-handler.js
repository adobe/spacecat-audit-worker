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
 * Gets the eviction score for an opportunity. Higher score = higher priority to keep.
 * Uses sumTraffic as the metric for ad-intent-mismatch opportunities.
 * @param {Object} opportunity - The opportunity object
 * @returns {number} The eviction score (higher = more important to keep)
 */
function getEvictionScore(opportunity) {
  return opportunity.getData()?.sumTraffic || 0;
}

/**
 * Finds the opportunity with the lowest eviction score (candidate for removal).
 * @param {Array} opportunities - Array of opportunity objects
 * @returns {Object} The opportunity with the lowest eviction score
 */
function findLowestEvictionCandidate(opportunities) {
  return opportunities.reduce(
    (lowest, current) => (getEvictionScore(current) < getEvictionScore(lowest) ? current : lowest),
    opportunities[0],
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

  // Infer recommendation type from new guidance suggestions
  const newSuggestions = guidanceBody?.suggestions || [];
  const newType = inferRecommendationType(newSuggestions);
  const newTraffic = guidanceBody?.sumTraffic || data?.sumTraffic || 0;

  // Query existing opportunities for eviction check
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const sameTypeOpportunities = existingOpportunities
    .filter((oppty) => oppty.getType() === 'ad-intent-mismatch')
    .filter((oppty) => oppty.getStatus() === 'NEW' && oppty.getUpdatedBy() === 'system');

  // Load suggestions to infer type for existing opportunities
  const inferredTypes = await Promise.all(
    sameTypeOpportunities.map(async (oppty) => {
      const opptySuggestions = await oppty.getSuggestions();
      const existingSuggestionData = opptySuggestions?.[0]?.getData();
      return {
        oppty,
        type: inferRecommendationType(existingSuggestionData?.variations || []),
      };
    }),
  );
  const sameTypeWithInferredType = inferredTypes
    .filter(({ type }) => type === newType)
    .map(({ oppty }) => oppty);

  // Eviction check
  if (sameTypeWithInferredType.length >= MAX_OPPORTUNITIES_PER_TYPE) {
    const lowestCandidate = findLowestEvictionCandidate(sameTypeWithInferredType);
    const lowestTraffic = getEvictionScore(lowestCandidate);

    if (newTraffic > lowestTraffic) {
      // Evict lowest and create new
      lowestCandidate.setStatus('IGNORED');
      await lowestCandidate.save();
      log.info(
        `[ad-intent-mismatch] Evicted opportunity ${lowestCandidate.getId()} `
        + `(traffic: ${lowestTraffic}) for new opportunity (traffic: ${newTraffic}), `
        + `type: ${newType}, site: ${siteId}`,
      );
    } else {
      // Drop new - capacity full
      log.info(
        `[ad-intent-mismatch] Dropped new opportunity (traffic: ${newTraffic}) - `
        + `lowest existing (traffic: ${lowestTraffic}) is higher, `
        + `type: ${newType}, site: ${siteId}`,
      );
      return ok();
    }
  }

  // Create opportunity
  const entity = mapToKeywordOptimizerOpportunity(siteId, audit, message);
  const opportunity = await Opportunity.create(entity);
  paidLog.createdOpportunity(siteId, url, opportunity.getId());

  // Create suggestion for the new opportunity
  const suggestionData = mapToKeywordOptimizerSuggestion(
    context,
    opportunity.getId(),
    message,
  );
  await Suggestion.create(suggestionData);
  paidLog.createdSuggestion(opportunity.getId(), siteId, url, auditId);

  // Mark existing same-URL opportunities as IGNORED (preserve existing logic)
  const existingMatches = sameTypeOpportunities
    .filter((oppty) => oppty.getData()?.url === url)
    .filter((oppty) => oppty.getId() !== opportunity.getId());

  if (existingMatches.length > 0) {
    existingMatches.forEach((oldOppty) => {
      oldOppty.setStatus('IGNORED');
    });
    await Opportunity.saveMany(existingMatches);
    existingMatches.forEach((oldOppty) => {
      paidLog.markedIgnored(oldOppty.getId(), siteId, url, auditId);
    });
  }

  return ok();
}

export {
  inferRecommendationType,
  getEvictionScore,
  findLowestEvictionCandidate,
  MAX_OPPORTUNITIES_PER_TYPE,
};
