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
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { mapToPaidOpportunity, mapToPaidSuggestion, isLowSeverityGuidanceBody } from './guidance-opportunity-mapper.js';
import { getAuditData } from './audit-data-provider.js';

function getGuidanceObj(guidance) {
  const body = guidance && guidance[0] && guidance[0].body;

  return {
    ...guidance[0],
    body,
  };
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site, Opportunity, Suggestion } = dataAccess;
  const { siteId, auditId, data } = message;
  const { url, guidance } = data;

  log.debug(`Message received for guidance:paid-cookie-consent handler site: ${siteId} url: ${url} message: ${JSON.stringify(message)}`);

  // Get site to retrieve baseURL for Athena queries
  const site = await Site.findById(siteId);
  if (!site) {
    log.warn(`No site found for siteId: ${siteId}`);
    return notFound();
  }

  // Query Athena directly for audit data (no dependency on stored audit)
  const auditData = await getAuditData(context, siteId, site.getBaseURL());
  if (!auditData?.top3Pages) {
    log.error(`Failed to get audit data for site ${siteId}. No consent data available.`);
    return notFound();
  }
  log.debug(`Fetched audit data from Athena for site: ${siteId}`);

  // Check for low severity and skip if so
  const guidanceParsed = getGuidanceObj(guidance);
  if (isLowSeverityGuidanceBody(guidanceParsed.body)) {
    log.info(`Skipping opportunity creation for site: ${siteId} page: ${url} due to low issue severity`);
    return ok();
  }

  const entity = mapToPaidOpportunity(siteId, url, auditData, guidanceParsed, auditId);
  // Always create a new opportunity
  log.debug(`Creating new paid-cookie-consent opportunity for ${siteId} page: ${url}`);

  const opportunity = await Opportunity.create(entity);
  // Create suggestion for the new opportunity first
  const suggestionData = await mapToPaidSuggestion(
    context,
    siteId,
    opportunity.getId(),
    url,
    guidanceParsed,
  );
  await Suggestion.create(suggestionData);
  log.info(`Created suggestion for opportunity ${opportunity.getId()}: ${JSON.stringify(suggestionData, null, 2)}`);
  log.debug(`Created suggestion for opportunity ${opportunity.getId()}`);

  // Only after suggestion is successfully created,
  // find and mark existing NEW system opportunities as IGNORED
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const existingMatches = existingOpportunities
    .filter((oppty) => oppty.getType() === 'consent-banner')
    .filter((oppty) => oppty.getStatus() === 'NEW' && oppty.getUpdatedBy() === 'system')
    .filter((oppty) => oppty.getId() !== opportunity.getId()); // Exclude the newly created one

  if (existingMatches.length > 0) {
    log.debug(`Found ${existingMatches.length} existing NEW system opportunities for page ${url}. Marking them as IGNORED.`);
    await Promise.all(existingMatches.map(async (oldOppty) => {
      oldOppty.setStatus('IGNORED');
      await oldOppty.save();
      log.info(`Marked opportunity ${oldOppty.getId()} as IGNORED`);
    }));
  }

  log.debug(`paid-cookie-consent opportunity successfully added for site: ${siteId} page: ${url} opportunity: ${JSON.stringify(opportunity, null, 2)}`);

  return ok();
}
