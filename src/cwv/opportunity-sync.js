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
import calculateKpiDeltasForAudit, { THRESHOLDS, METRICS, calculateConfidenceScore } from './kpi-metrics.js';

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
 * Returns a copy of the entry where the metrics array only contains device entries
 * that have at least one metric above the "good" threshold. This prevents suggestions
 * from containing green device-level data alongside failing ones.
 * @param {Object} entry - CWV audit entry
 * @returns {Object} Entry with metrics filtered to failing device types only
 */
function filterToFailingDeviceMetrics(entry) {
  return {
    ...entry,
    metrics: entry.metrics.filter((deviceMetrics) => METRICS.some((metric) => {
      const value = deviceMetrics[metric];
      return value !== null && value !== undefined && value > THRESHOLDS[metric];
    })),
  };
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

  // Only sync suggestions for pages where at least one CWV metric is failing.
  // Pages where all metrics pass are not actionable. Data is already sorted by
  // page views descending from step 1.
  // Additionally, strip device-level metrics that are all-green so that suggestions
  // only contain data for device types with actual CWV issues. This prevents a page
  // that is failing on one device but passing on another from surfacing green metric
  // values in its suggestion, which would make it appear incorrectly resolved.
  const cwvData = auditResult.cwv
    .filter(hasFailingMetrics)
    .map(filterToFailingDeviceMetrics);
  log.info(`[syncOpportunitiesAndSuggestions] site ${site.getId()} - ${cwvData.length} of ${auditResult.cwv.length} CWV entries have failing metrics`);

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
  const maxConfidenceForUrls = Math.max(
    0,
    ...cwvData.filter((entry) => entry.type === 'url').map((entry) => calculateConfidenceScore(entry)),
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
      // 1. if the entry is a group, then the rank is the max confidence for URLs
      //   plus the confidence for the group (ensures groups sort before URLs,
      //   because the UI shows groups first)
      // 2. if the entry is a URL, then the rank is the confidence score for that URL
      rank: entry.type === 'group'
        ? maxConfidenceForUrls + calculateConfidenceScore(entry)
        : calculateConfidenceScore(entry),
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
