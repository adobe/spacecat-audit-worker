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

// Sync suggestions for broken internal links
export async function syncBrokenInternalLinksSuggestions({
  opportunity,
  brokenInternalLinks,
  context,
  opportunityId,
  log,
}) {
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
}

export async function suggestionsInternalLinksHandler(message, context) {
  const {
    log, finalUrl, dataAccess,
  } = context;

  let { brokenInternalLinks } = message.data;
  const { opportunityId } = message.data;
  const { Opportunity, Site } = dataAccess;

  const site = await Site.findById(message.siteId);
  log.info(`Message received in suggestions-internal-links handler: site id: ${message.siteId}, opportunityId: ${message.data.opportunityId} for audit type: ${AUDIT_TYPE}`);

  // generate suggestions for this set of broken internal links
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

  // find opportunity by id and check if it belongs to the site
  const opportunity = await Opportunity.findById(opportunityId);
  if (!opportunity || opportunity.getSiteId() !== message.siteId) {
    throw new Error('Opportunity not found');
  }

  // sync suggestions for this set of broken internal links
  await syncBrokenInternalLinksSuggestions({
    opportunity,
    brokenInternalLinks,
    context,
    opportunityId,
    log,
  });
}
