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

  log.info(`[paid-audit] Received paid-keyword-optimizer message for site: ${siteId}, url: ${url}, audit: ${auditId}`);
  log.debug(`[paid-audit] Full message payload: ${JSON.stringify(message, null, 2)}`);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`[paid-audit] Failed paid-keyword-optimizer: no audit found for site: ${siteId}, url: ${url}, audit: ${auditId}`);
    return notFound();
  }
  log.debug(`[paid-audit] Found audit: ${auditId}, type: ${audit.getAuditType()}`);

  // Check for low severity and skip if so
  if (isLowSeverityGuidanceBody(body)) {
    log.info(`[paid-audit] Skipping paid-keyword-optimizer opportunity creation for site: ${siteId}, url: ${url}, audit: ${auditId} due to low issue severity`);
    return ok();
  }

  const entity = mapToKeywordOptimizerOpportunity(siteId, audit, message);
  log.debug(`[paid-audit] Creating opportunity entity: ${JSON.stringify(entity, null, 2)}`);

  const opportunity = await Opportunity.create(entity);
  log.info(`[paid-audit] Created paid-keyword-optimizer opportunity for site: ${siteId}, url: ${url}, audit: ${auditId}`);

  // Create suggestion for the new opportunity
  const suggestionData = mapToKeywordOptimizerSuggestion(
    context,
    opportunity.getId(),
    message,
  );
  log.debug(`[paid-audit] Creating suggestion: ${JSON.stringify(suggestionData, null, 2)}`);
  await Suggestion.create(suggestionData);
  log.debug(`[paid-audit] Created suggestion for opportunity ${opportunity.getId()}`);

  // Only after suggestion is successfully created,
  // find and mark existing NEW system opportunities for the SAME URL as IGNORED
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const existingMatches = existingOpportunities
    .filter((oppty) => oppty.getType() === 'ad-intent-mismatch')
    .filter((oppty) => oppty.getStatus() === 'NEW' && oppty.getUpdatedBy() === 'system')
    .filter((oppty) => oppty.getData()?.url === url) // Only match same URL
    .filter((oppty) => oppty.getId() !== opportunity.getId()); // Exclude the newly created one

  log.debug(`[paid-audit] Found ${existingMatches.length} existing NEW system opportunities for url ${url} to mark as IGNORED`);

  if (existingMatches.length > 0) {
    await Promise.all(existingMatches.map(async (oldOppty) => {
      oldOppty.setStatus('IGNORED');
      await oldOppty.save();
      log.debug(`[paid-audit] Marked opportunity ${oldOppty.getId()} as IGNORED`);
    }));
  }

  log.debug(`[paid-audit] Handler completed successfully for site: ${siteId}, audit: ${auditId}, opportunityId: ${opportunity.getId()}, url: ${url}`);

  return ok();
}
