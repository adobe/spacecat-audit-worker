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
import { removeTrailingSlash } from '../utils/url-utils.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import calculateKpiDeltasForAudit from './kpi-metrics.js';
import { sendSQSMessageForAutoSuggest } from './auto-suggest.js';
import { isHomepage } from './utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const DAILY_THRESHOLD = 1000; // pageviews
const INTERVAL = 7; // days
// The number of top pages with issues that will be included in the report
const TOP_PAGES_COUNT = 15;

/**
 * Step 1: Code Import Step
 * Triggers import worker to fetch and store repository code in S3
 * @param {Object} context - Context object containing site, finalUrl and log
 * @returns {Promise<Object>} Message for import worker with audit result
 */
export async function codeImportStep(context) {
  const {
    log, site, finalUrl,
  } = context;

  log.info(`[CWVAudit] [Site Id: ${site.getId()}] starting code import step`);

  return {
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: finalUrl,
    type: 'code',
    siteId: site.getId(),
    allowCache: false,
  };
}

/**
 * Step 2: CWV Data Collection and Analysis
 * Collects RUM data, filters URLs, and prepares audit result
 * @param {Object} context - Context object containing site, finalUrl, log
 * @returns {Promise<Object>} Audit result with CWV data
 */
export async function collectCWVDataStep(context) {
  const {
    site, finalUrl: auditUrl, log,
  } = context;

  const siteId = site.getId();
  const baseURL = removeTrailingSlash(site.getBaseURL());

  const rumAPIClient = RUMAPIClient.createFrom(context);
  const groupedURLs = site.getConfig().getGroupedURLs(Audit.AUDIT_TYPES.CWV);
  const options = {
    domain: auditUrl,
    interval: INTERVAL,
    granularity: 'hourly',
    groupedURLs,
  };
  const cwvData = await rumAPIClient.query(Audit.AUDIT_TYPES.CWV, options);

  const stats = { homepage: false, topNCount: 0, thresholdCount: 0 };

  // Always include: homepage + top N pages + pages meeting threshold
  const filteredCwvData = [...cwvData]
    .sort((a, b) => b.pageviews - a.pageviews)
    .reduce((list, item) => {
      // 1) Homepage
      if (isHomepage(item, baseURL)) {
        list.push(item);
        stats.homepage = true;
        return list;
      }

      // 2) Top N by pageviews (excluding homepage)
      if (stats.topNCount < TOP_PAGES_COUNT) {
        list.push(item);
        stats.topNCount += 1;
        return list;
      }

      // 3) Threshold group (pages meeting threshold, excluding homepage and topN)
      if (item.pageviews >= DAILY_THRESHOLD * INTERVAL) {
        list.push(item);
        stats.thresholdCount += 1;
      }

      return list;
    }, []);

  log.info(
    `[audit-worker-cwv] siteId: ${siteId} | baseURL: ${baseURL} | Total=${cwvData.length}, Reported=${filteredCwvData.length} | `
    + `Homepage: ${stats.homepage ? 'included' : 'not included'} | `
    + `Top${TOP_PAGES_COUNT} pages: ${stats.topNCount} | `
    + `Pages above threshold: ${stats.thresholdCount}`,
  );

  return {
    auditResult: {
      cwv: filteredCwvData,
      auditContext: {
        interval: INTERVAL,
      },
    },
    fullAuditRef: auditUrl,
  };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context, site) {
  const groupedURLs = site.getConfig().getGroupedURLs(Audit.AUDIT_TYPES.CWV);
  const kpiDeltas = calculateKpiDeltasForAudit(auditData, context, groupedURLs);
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    Audit.AUDIT_TYPES.CWV,
    kpiDeltas,
  );
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
  });

  await sendSQSMessageForAutoSuggest(context, opportunity, site);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('codeImport', codeImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('collectCWVData', collectCWVDataStep)
  .withPostProcessors([opportunityAndSuggestions])
  .build();
