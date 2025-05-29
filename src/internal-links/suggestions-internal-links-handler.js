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

// import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
// import { Audit } from '@adobe/spacecat-shared-data-access';
// import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
// import { AuditBuilder } from '../common/audit-builder.js';
// import { syncSuggestions } from '../utils/data-access.js';
// import { convertToOpportunity } from '../common/opportunity.js';
// import { createOpportunityData } from './opportunity-data-mapper.js';
// import { generateSuggestionData } from './suggestions-generator.js';
// import { wwwUrlResolver } from '../common/index.js';
// import {
//   calculateKpiDeltasForAudit,
//   isLinkInaccessible,
//   calculatePriority,
// } from './helpers.js';

// const { AUDIT_STEP_DESTINATIONS } = Audit;
// const INTERVAL = 30; // days
// const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

export async function suggestionsInternalLinksHandler(message, context) {
  // const { log, dataAccess } = context;
  const { log } = context;
  // const { Audit, Opportunity, Suggestion } = dataAccess;
  // const { auditId, siteId, data } = message;
  // const { urls, msg } = data;
  log.info(`Message received in suggestions-internal-links handler: ${JSON.stringify(message, null, 2)}`);

  // const {
  //   log, site, finalUrl, audit, dataAccess,
  // } = context;

  // let { brokenInternalLinks } = audit.getAuditResult();

  // // generate suggestions
  // try {
  //   brokenInternalLinks = await generateSuggestionData(
  //     finalUrl,
  //     audit,
  //     context,
  //     site,
  //   );
  // } catch (error) {
  //   log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}]
  // suggestion generation error: ${error.message}`);
  // }

  // // TODO: skip opportunity creation if no internal link items are found in the audit data
  // const kpiDeltas = calculateKpiDeltasForAudit(brokenInternalLinks);

  // if (!isNonEmptyArray(brokenInternalLinks)) {
  //   // no broken internal links found
  //   // fetch opportunity
  //   const { Opportunity } = dataAccess;
  //   let opportunity;
  //   try {
  //     const opportunities = await Opportunity
  //       .allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW);
  //     opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
  //   } catch (e) {
  //     log.error(`Fetching opportunities for siteId
  // ${site.getId()} failed with error: ${e.message}`);
  //     throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
  //   }

  //   if (!opportunity) {
  //     log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}]
  // no broken internal links found, skipping opportunity creation`);
  //   } else {
  //     // no broken internal links found, update opportunity status to RESOLVED
  //     log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no broken internal
  // links found, but found opportunity, updating status to RESOLVED`);
  //     await opportunity.setStatus(Oppty.STATUSES.RESOLVED);

  //     // We also need to update all suggestions inside this opportunity
  //     // Get all suggestions for this opportunity
  //     const suggestions = await opportunity.getSuggestions();

  //     // If there are suggestions, update their status to outdated
  //     if (isNonEmptyArray(suggestions)) {
  //       const { Suggestion } = dataAccess;
  //       await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.OUTDATED);
  //     }
  //     opportunity.setUpdatedBy('system');
  //     await opportunity.save();
  //   }
  //   return {
  //     status: 'complete',
  //   };
  // }

  // const opportunity = await convertToOpportunity(
  //   finalUrl,
  //   { siteId: site.getId(), id: audit.getId() },
  //   context,
  //   createOpportunityData,
  //   AUDIT_TYPE,
  //   {
  //     kpiDeltas,
  //   },
  // );

  // const buildKey = (item) => `${item.urlFrom}-${item.urlTo}`;
  // await syncSuggestions({
  //   opportunity,
  //   newData: brokenInternalLinks,
  //   context,
  //   buildKey,
  //   mapNewSuggestion: (entry) => ({
  //     opportunityId: opportunity.getId(),
  //     type: 'CONTENT_UPDATE',
  //     rank: entry.trafficDomain,
  //     data: {
  //       title: entry.title,
  //       urlFrom: entry.urlFrom,
  //       urlTo: entry.urlTo,
  //       urlsSuggested: entry.urlsSuggested || [],
  //       aiRationale: entry.aiRationale || '',
  //       trafficDomain: entry.trafficDomain,
  //     },
  //   }),
  //   log,
  // });
  return {
    status: 'complete',
  };
}

// export default new AuditBuilder()
//   .withUrlResolver(wwwUrlResolver)
//   .addStep('suggestionsInternalLinks', suggestionsInternalLinksHandler)
//   .build();
