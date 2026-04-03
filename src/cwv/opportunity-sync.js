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
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import calculateKpiDeltasForAudit, { THRESHOLDS, METRICS } from './kpi-metrics.js';

/**
 * Returns true if the CWV entry has at least one metric that exceeds the "good" threshold
 * on any device type. Null/undefined metric values are treated as passing (no data = not failing).
 * @param {Object} entry - CWV audit entry ({ metrics: [{lcp, cls, inp, ...}] })
 * @returns {boolean}
 */
function hasFailingMetrics(entry) {
  return entry.metrics.some((deviceMetrics) => METRICS.some((metric) => {
    const value = deviceMetrics[metric];
    return value !== null && value !== undefined && value > THRESHOLDS[metric];
  }));
}

/**
 * Synchronizes opportunities and suggestions for a CWV audit
 * Creates or updates opportunity and syncs suggestions
 * @param {Object} context - Context object containing site, audit, finalUrl, log, dataAccess
 * @returns {Promise<Object>} The created or updated opportunity object
 */
export async function syncOpportunitiesAndSuggestions(context) {
  const {
    site, audit, finalUrl, log,
  } = context;

  const auditResult = audit.getAuditResult();
  const groupedURLs = site.getConfig().getGroupedURLs(Audit.AUDIT_TYPES.CWV);

  // Detect PLG sites (summit-plg handler enabled) to apply filtered suggestions.
  // PLG sites only receive suggestions for pages where at least one CWV metric is failing,
  // sorted by page views descending (already ordered from step 1).
  const { Configuration } = context.dataAccess;
  const configuration = await Configuration.findLatest();
  const isSummitPlgSite = configuration.isHandlerEnabledForSite('summit-plg', site);

  const cwvData = isSummitPlgSite
    ? auditResult.cwv.filter(hasFailingMetrics)
    : auditResult.cwv;

  if (isSummitPlgSite) {
    log.info(`[syncOpportunitiesAndSuggestions] PLG site ${site.getId()} - ${cwvData.length} of ${auditResult.cwv.length} CWV entries have failing metrics`);
  }

  // Build minimal audit data object for opportunity creation
  const auditData = {
    siteId: site.getId(),
    id: audit.getId(),
    auditResult,
  };

  const kpiDeltas = calculateKpiDeltasForAudit(auditData, context, groupedURLs);
  const opportunity = await convertToOpportunity(
    finalUrl,
    auditData,
    context,
    createOpportunityData,
    Audit.AUDIT_TYPES.CWV,
    kpiDeltas,
  );

  // Sync suggestions
  const buildKey = (data) => (data.type === 'url' ? data.url : data.pattern);
  const maxOrganicForUrls = Math.max(
    0,
    ...cwvData.filter((entry) => entry.type === 'url').map((entry) => entry.pageviews),
  );

  await syncSuggestions({
    opportunity,
    newData: cwvData,
    context,
    buildKey,
    bypassValidationForPlg: true,
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
        jiraLink: '',
      },
    }),
  });

  opportunity.setLastAuditedAt(new Date().toISOString());
  await opportunity.save();

  return opportunity;
}
