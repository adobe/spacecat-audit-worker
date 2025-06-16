/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { Audit } from '@adobe/spacecat-shared-data-access';
import { syncSuggestions } from '../utils/data-access.js';
import { generateSuggestionData } from './suggestions-generator.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

export async function suggestionsInternalLinksHandler(message, context) {
  const {
    log, finalUrl, dataAccess,
  } = context;

  let { brokenInternalLinks } = message.data;
  const { opportunityId } = message.data;

  const { Opportunity, Site } = dataAccess;

  const site = await Site.findById(message.siteId);
  log.info(`Message received in suggestions-internal-links handler: site: ${JSON.stringify(site, null, 2)}`);
  // const { auditId, siteId, data } = message;
  // const { urls, msg } = data;
  log.info(`Message received in suggestions-internal-links handler brokenInternalLinks: ${JSON.stringify(message.data.brokenInternalLinks, null, 2)}`);
  log.info(`Message received in suggestions-internal-links handler: opportunityId: ${JSON.stringify(message.data.opportunityId, null, 2)}`);
  // log.info(`Message received in suggestions-internal-links handler:
  // context: ${JSON.stringify(context, null, 2)}`);

  // generate suggestions
  try {
    brokenInternalLinks = await generateSuggestionData(
      finalUrl,
      brokenInternalLinks,
      context,
      site,
    );
  } catch (error) {
    log.error(`[${AUDIT_TYPE}] [Site: ${message.siteId}] suggestion generation error: ${error.message}`);
  }

  // find opportunity by id
  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity || opportunity.getSiteId() !== message.siteId) {
    throw new Error('Opportunity not found');
  }

  const buildKey = (item) => `${item.urlFrom}-${item.urlTo}`;
  await syncSuggestions({
    opportunity,
    newData: brokenInternalLinks,
    context,
    buildKey,
    mapNewSuggestion: (entry) => ({
      opportunityId,
      type: 'CONTENT_UPDATE',
      rank: entry.trafficDomain,
      data: {
        title: entry.title,
        urlFrom: entry.urlFrom,
        urlTo: entry.urlTo,
        urlsSuggested: entry.urlsSuggested || [],
        aiRationale: entry.aiRationale || '',
        trafficDomain: entry.trafficDomain,
      },
    }),
    log,
  });
  return {
    status: 'complete',
  };
}

// export default new AuditBuilder()
//   .withUrlResolver(wwwUrlResolver)
//   .addStep('suggestionsInternalLinks', suggestionsInternalLinksHandler)
//   .build();
