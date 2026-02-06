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

/**
 * Handler for paid keyword optimizer guidance responses from mystique
 * Message format:
 * {
 *   auditId, siteId, insight, rationale, recommendation,
 *   body: { issueSeverity, data: { url, suggestions, cpc, sum_traffic } }
 * }
 * @param {Object} message - Message from mystique
 * @param {Object} context - Execution context
 * @returns {Promise<Response>} HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, body } = message;
  const url = body?.data?.url;

  log.info(`[paid-keyword-optimizer-guidance] Received message from Mystique for site: ${siteId}, auditId: ${auditId}, url: ${url}`);
  log.debug(`[paid-keyword-optimizer-guidance] Full message payload: ${JSON.stringify(message, null, 2)}`);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[paid-keyword-optimizer-guidance] No audit found for auditId: ${auditId}`);
    return notFound();
  }
  log.info(`[paid-keyword-optimizer-guidance] Found audit: ${auditId}, type: ${audit.getAuditType()}`);

  // Check for low severity and skip if so
  if (isLowSeverityGuidanceBody(body)) {
    log.info(`[paid-keyword-optimizer-guidance] Skipping opportunity creation - low issue severity. Site: ${siteId}, auditId: ${auditId}, url: ${url}`);
    return ok();
  }

  const entity = mapToKeywordOptimizerOpportunity(siteId, audit, message);
  log.debug(`[paid-keyword-optimizer-guidance] Creating opportunity entity: ${JSON.stringify(entity, null, 2)}`);

  const opportunity = await Opportunity.create(entity);
  log.info(`[paid-keyword-optimizer-guidance] Created opportunity: ${opportunity.getId()} for url: ${url}`);

  // Create suggestion for the new opportunity
  const suggestionData = mapToKeywordOptimizerSuggestion(
    context,
    opportunity.getId(),
    message,
  );
  log.debug(`[paid-keyword-optimizer-guidance] Creating suggestion: ${JSON.stringify(suggestionData, null, 2)}`);
  await Suggestion.create(suggestionData);
  log.info(`[paid-keyword-optimizer-guidance] Created suggestion for opportunity ${opportunity.getId()}`);

  // Only after suggestion is successfully created,
  // find and mark existing NEW system opportunities for the SAME URL as IGNORED
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const existingMatches = existingOpportunities
    .filter((oppty) => oppty.getType() === 'ad-intent-mismatch')
    .filter((oppty) => oppty.getStatus() === 'NEW' && oppty.getUpdatedBy() === 'system')
    .filter((oppty) => oppty.getData()?.url === url) // Only match same URL
    .filter((oppty) => oppty.getId() !== opportunity.getId()); // Exclude the newly created one

  log.info(`[paid-keyword-optimizer-guidance] Found ${existingMatches.length} existing NEW system opportunities for url ${url} to mark as IGNORED`);

  if (existingMatches.length > 0) {
    await Promise.all(existingMatches.map(async (oldOppty) => {
      oldOppty.setStatus('IGNORED');
      await oldOppty.save();
      log.info(`[paid-keyword-optimizer-guidance] Marked opportunity ${oldOppty.getId()} as IGNORED`);
    }));
  }

  log.info(`[paid-keyword-optimizer-guidance] Handler completed successfully for site: ${siteId}, auditId: ${auditId}, opportunityId: ${opportunity.getId()}, url: ${url}`);

  return ok();
}
