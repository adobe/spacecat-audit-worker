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

  const entity = mapToKeywordOptimizerOpportunity(siteId, audit, message);
  const opportunity = await Opportunity.create(entity);
  paidLog.createdOpportunity(siteId, url, auditId);

  // Create suggestion for the new opportunity
  const suggestionData = mapToKeywordOptimizerSuggestion(
    context,
    opportunity.getId(),
    message,
  );
  await Suggestion.create(suggestionData);
  paidLog.createdSuggestion(opportunity.getId(), siteId, url, auditId);

  // Only after suggestion is successfully created,
  // find and mark existing NEW system opportunities for the SAME URL as IGNORED
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const existingMatches = existingOpportunities
    .filter((oppty) => oppty.getType() === 'ad-intent-mismatch')
    .filter((oppty) => oppty.getStatus() === 'NEW' && oppty.getUpdatedBy() === 'system')
    .filter((oppty) => oppty.getData()?.url === url) // Only match same URL
    .filter((oppty) => oppty.getId() !== opportunity.getId()); // Exclude the newly created one

  if (existingMatches.length > 0) {
    await Promise.all(existingMatches.map(async (oldOppty) => {
      oldOppty.setStatus('IGNORED');
      await oldOppty.save();
      paidLog.markedIgnored(oldOppty.getId(), siteId, url, auditId);
    }));
  }

  return ok();
}
