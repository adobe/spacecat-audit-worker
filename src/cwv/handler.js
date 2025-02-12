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
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/audit.js';
import { syncSuggestions } from '../utils/data-access.js';
import calculateKpiDeltasForAudit from './kpi-metrics.js';

const DAILY_THRESHOLD = 1000;
const INTERVAL = 7; // days
const AUDIT_TYPE = 'cwv';

export async function CWVRunner(auditUrl, context, site) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const groupedURLs = site.getConfig().getGroupedURLs(AUDIT_TYPE);
  const options = {
    domain: auditUrl,
    interval: INTERVAL,
    granularity: 'hourly',
    groupedURLs,
  };
  const cwvData = await rumAPIClient.query(AUDIT_TYPE, options);
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

export async function convertToOppty(auditUrl, auditData, context, site) {
  const {
    dataAccess,
    log,
  } = context;
  const { Opportunity } = dataAccess;
  const groupedURLs = site.getConfig().getGroupedURLs(AUDIT_TYPE);

  log.info(`auditUrl: ${auditUrl}`);
  log.info(`auditData: ${JSON.stringify(auditData)}`);

  const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  log.info(`opportunities: ${JSON.stringify(opportunities)}`);

  let opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
  log.info(`opportunity: ${JSON.stringify(opportunity)}`);

  const kpiDeltas = calculateKpiDeltasForAudit(auditData, dataAccess, groupedURLs);
  if (!opportunity) {
    const opportunityData = {
      siteId: auditData.siteId,
      auditId: auditData.id,
      runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_CWV_Runbook.docx?web=1',
      type: AUDIT_TYPE,
      origin: 'AUTOMATION',
      title: 'Core Web Vitals',
      description: 'Core Web Vitals are key metrics Google uses to evaluate website performance, impacting SEO rankings by measuring user experience.',
      guidance: {
        steps: [
          'Analyze CWV data using RUM and PageSpeed Insights to identify performance bottlenecks.',
          'Optimize CWV metrics (CLS, INP, LCP) by addressing common issues such as slow server response times, unoptimized assets, excessive JavaScript, and layout instability.',
          'Test the implemented changes with tools like Chrome DevTools or PageSpeed Insights to verify improvements.',
          'Monitor performance over time to ensure consistent CWV scores across devices.',
        ],
      },
      tags: [
        'Traffic acquisition',
        'Engagement',
      ],
      data: {
        ...kpiDeltas,
      },
    };
    try {
      opportunity = await Opportunity.create(opportunityData);
    } catch (e) {
      log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
      throw e;
    }
  } else {
    opportunity.setAuditId(auditData.id);
    opportunity.setData({
      ...opportunity.getData(),
      ...kpiDeltas,
    });
    await opportunity.save();
  }

  // Sync suggestions
  const buildKey = (data) => (data.type === 'url' ? data.url : data.pattern);
  const maxOrganicForUrls = Math.max(...auditData.auditResult.cwv.filter((entry) => entry.type === 'url').map((entry) => entry.pageviews));

  await syncSuggestions({
    opportunity,
    newData: auditData.auditResult.cwv,
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
  .withPostProcessors([convertToOppty])
  .build();
