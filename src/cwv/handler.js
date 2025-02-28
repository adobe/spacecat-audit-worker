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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import calculateKpiDeltasForAudit from './kpi-metrics.js';

const DAILY_THRESHOLD = 1000;
const INTERVAL = 7; // days
const auditType = Audit.AUDIT_TYPES.CWV;

export async function CWVRunner(auditUrl, context, site) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const groupedURLs = site.getConfig().getGroupedURLs(auditType);
  const options = {
    domain: auditUrl,
    interval: INTERVAL,
    granularity: 'hourly',
    groupedURLs,
  };
  const cwvData = await rumAPIClient.query(auditType, options);
  const auditResult = {
    cwv: cwvData.filter((data) => data.pageviews >= DAILY_THRESHOLD * INTERVAL),
    auditContext: {
      interval: INTERVAL,
    },
  };

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context, site) {
  const groupedURLs = site.getConfig().getGroupedURLs(auditType);
  const kpiDeltas = calculateKpiDeltasForAudit(auditData, context, groupedURLs);
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
    kpiDeltas,
  );
  const { log } = context;
  // Sync suggestions
  const buildKey = (data) => (data.type === 'url' ? data.url : data.pattern);
  const maxOrganicForUrls = Math.max(...auditData.auditResult.cwv.filter((entry) => entry.type === 'url').map((entry) => entry.pageviews));

  await syncSuggestions({
    opportunity,
    newData: auditData.auditResult.cwv,
    context,
    buildKey,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      // the rank logic for CWV is as follows:
      // 1. if the entry is a group, then the rank is the max organic for URLs
      //   plus the organic for the group
      // 2. if the entry is a URL, then the rank is the max organic for URLs
      // Reason is because UI first shows groups and then URLs
      rank: entry.type === 'group' ? maxOrganicForUrls + entry.organic : entry.organic,
      data: {
        ...entry,
      },
    }),
    log,
  });
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(CWVRunner)
  .withPostProcessors([opportunityAndSuggestions])
  .build();
