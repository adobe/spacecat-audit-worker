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
import { mapToPaidOpportunity, mapToPaidSuggestion } from './guidance-opportunity-mapper.js';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, guidance } = data;

  log.info(`Message received for guidance:paid-cookie-consent handler site: ${siteId} url: ${url} message: ${JSON.stringify(message)}`);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }
  log.info(`Fetched Audit ${JSON.stringify(message)}`);
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  let opportunity = existingOpportunities
    .filter((oppty) => oppty.getType() === audit.getAuditType());
    // .find((oppty) => oppty.page === url);
  const entity = mapToPaidOpportunity(siteId, url, audit, guidance);
  if (!opportunity) {
    log.info(`No existing Opportunity found for ${siteId} page: ${url}. Creating a new one.`);
    opportunity = await Opportunity.create(entity);
  } else {
    log.info(`Found existing paid Opportunity for page ${url} with status ${opportunity.status}. Updating it with new data`);
    opportunity = {
      ...entity,
      // If customer decides to ignore the opportunity we should keep it as ignored
      status: opportunity.status,
    };
  }

  const existingSuggestions = await opportunity.getSuggestions();

  // delete previous suggestions if any
  await Promise.all(existingSuggestions.map((suggestion) => suggestion.remove()));

  const suggestionData = mapToPaidSuggestion(opportunity.getId(), url, guidance);
  await Suggestion.create(suggestionData);

  log.info(`paid guidance would have saved opportunity : ${JSON.stringify(opportunity, null, 2)}`);

  return ok();
}
