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
import { notFound, ok, badRequest } from '@adobe/spacecat-shared-http-utils';
import { filterBrokenSuggestedUrls } from '../utils/url-utils.js';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Suggestion, Site } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    // eslint-disable-next-line camelcase
    suggested_urls, ai_rationale, suggestionId, opportunityId,
  } = data;
  log.info(`Message received in broken-internal-links suggestion handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound('Audit not found');
  }
  const { Opportunity } = dataAccess;
  const opportunity = await Opportunity.findById(opportunityId);

  if (!opportunity) {
    log.error(`[BrokenInternalLinksGuidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[BrokenInternalLinks] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  const suggestion = await Suggestion.findById(suggestionId);
  if (!suggestion) {
    log.error(`[BrokenInternalLinksGuidance] Suggestion not found for ID: ${suggestionId}`);
    return notFound('Suggestion not found');
  }
  const suggestedUrls = await filterBrokenSuggestedUrls(suggested_urls, site.getBaseURL());
  suggestion.setData({
    ...suggestion.getData(),
    // eslint-disable-next-line camelcase
    suggestedUrls,
    // eslint-disable-next-line camelcase
    aiRationale: ai_rationale,
  });

  await suggestion.save();

  return ok();
}
