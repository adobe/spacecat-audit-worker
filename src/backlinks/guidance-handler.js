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

import { notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import calculateKpiDeltasForAudit from './kpi-metrics.js';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Suggestion, Site } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
  // eslint-disable-next-line camelcase
    broken_url, source_url, suggested_urls, aiRationale,
  } = data;
  log.info(`Message received in broken-backlinks suggestion handler: ${JSON.stringify(message, null, 2)}`);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const site = await Site.findById(siteId);
  const kpiDeltas = await calculateKpiDeltasForAudit(audit, context, site);
  const opportunity = await convertToOpportunity(
    audit.getFullAuditRef(),
    { siteId, id: audit.getId() },
    context,
    createOpportunityData,
    audit.getType(),
    kpiDeltas,
  );

  // map the suggestions received from M to PSS
  const suggestionData = {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: 'NEW',
    data: {
      // eslint-disable-next-line camelcase
      url_from: source_url,
      // eslint-disable-next-line camelcase
      url_to: broken_url,
      // eslint-disable-next-line camelcase
      suggested_urls,
      aiRationale,
    },
    kpiDeltas: {
      estimatedKPILift: 0,
    },
  };

  await Suggestion.create(suggestionData);

  return ok();
}
