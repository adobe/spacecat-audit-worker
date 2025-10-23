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
import { mapToPaidOpportunity, mapToPaidSuggestion, isLowSeverityGuidanceBody } from './guidance-opportunity-mapper.js';

function getGuidanceObj(guidance) {
  const body = guidance && guidance[0] && guidance[0].body;

  return {
    ...guidance[0],
    body,
  };
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, guidance } = data;

  log.debug(`Message received for guidance:paid-cookie-consent handler site: ${siteId} url: ${url} message: ${JSON.stringify(message)}`);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }
  log.debug(`Fetched Audit ${JSON.stringify(message)}`);

  // Check for low severity and skip if so
  const guidanceParsed = getGuidanceObj(guidance);
  if (isLowSeverityGuidanceBody(guidanceParsed.body)) {
    log.info(`Skipping opportunity creation for site: ${siteId} page: ${url} audit: ${auditId} due to low issue severity: ${guidanceParsed}`);
    return ok();
  }

  const entity = mapToPaidOpportunity(siteId, url, audit, guidanceParsed);
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
  log.debug(`Created suggestion for opportunity ${opportunity.getId()}`);

  // Only after suggestion is successfully created,
  // find and mark existing NEW system opportunities as IGNORED
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const existingMatches = existingOpportunities
    .filter((oppty) => oppty.getType() === 'generic-opportunity')
    .filter((oppty) => oppty.getData()?.page === url && oppty.getData().opportunityType === 'paid-cookie-consent')
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

  log.debug(`paid-cookie-consent  opportunity succesfully added for site: ${siteId} page: ${url} audit: ${auditId}  opportunity: ${JSON.stringify(opportunity, null, 2)}`);

  return ok();
}
