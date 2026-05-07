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
 * Explodes a single CWV entry (one URL, all metrics bundled) into N per-metric entries,
 * one for each metric that exceeds the "good" threshold on any device.
 *
 * Each per-metric entry carries:
 * - metric: which metric this entry represents (lcp, cls, inp)
 * - metrics[]: both device values for that single metric only
 * - aggregationKey: stable key for dedup across audit runs
 * - All other fields from the original entry (url, type, pageviews, organic, etc.)
 *
 * @param {Object} entry - CWV audit entry with all metrics bundled
 * @returns {Object[]} Array of per-metric entries
 */
function splitEntryByMetric(entry) {
  const key = entry.type === 'url' ? entry.url : entry.pattern;
  const perMetricEntries = [];

  for (const metric of METRICS) {
    // Collect device values for this metric, only where the metric exceeds threshold
    const deviceValues = entry.metrics
      .filter((dm) => {
        const value = dm[metric];
        return value !== null && value !== undefined && value > THRESHOLDS[metric];
      })
      .map((dm) => ({ deviceType: dm.deviceType, [metric]: dm[metric] }));

    if (deviceValues.length === 0) {
      // This metric is not failing on any device — skip
      // eslint-disable-next-line no-continue
      continue;
    }

    // Also include devices where the metric is present but passing,
    // so the UI shows the full picture for this metric across all devices
    const allDeviceValues = entry.metrics
      .filter((dm) => dm[metric] != null)
      .map((dm) => ({ deviceType: dm.deviceType, [metric]: dm[metric] }));

    perMetricEntries.push({
      ...entry,
      metric,
      metrics: allDeviceValues,
      aggregationKey: `cwv#${key}#${metric}`,
    });
  }

  return perMetricEntries;
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
  // Pages where all metrics pass are not actionable.
  // Each failing metric on a URL becomes its own suggestion (per-metric split),
  // enabling independent tracking, deployment, and Jira tickets per issue.
  const cwvData = auditResult.cwv
    .filter(hasFailingMetrics)
    .flatMap(splitEntryByMetric);
  log.info(`[syncOpportunitiesAndSuggestions] site ${site.getId()} - ${cwvData.length} per-metric suggestions from ${auditResult.cwv.length} CWV entries`);

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

  // Sync suggestions — buildKey includes metric for per-metric dedup
  const buildKey = (data) => {
    const base = data.type === 'url' ? data.url : data.pattern;
    return data.metric ? `${base}:${data.metric}` : base;
  };
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
