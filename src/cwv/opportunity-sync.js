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

import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import calculateKpiDeltasForAudit, { THRESHOLDS, METRICS, calculateConfidenceScore } from './kpi-metrics.js';

/**
 * Per-issue statuses that should NOT be overwritten when re-audit detects a metric
 * has resolved. Mirrors the skip list used by `handleOutdatedSuggestions` for
 * suggestion-level statuses — preserves customer/system intent on issues that
 * already moved past NEW.
 */
const ISSUE_STATUSES_TO_PRESERVE = new Set([
  Suggestion.STATUSES.OUTDATED,
  Suggestion.STATUSES.FIXED,
  Suggestion.STATUSES.ERROR,
  Suggestion.STATUSES.SKIPPED,
  Suggestion.STATUSES.REJECTED,
  Suggestion.STATUSES.APPROVED,
  Suggestion.STATUSES.IN_PROGRESS,
]);

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
 * Returns true if the named metric (lcp/cls/inp) exceeds threshold on any device
 * in the entry. Null/undefined values are treated as passing.
 * @param {Object} entry - CWV audit entry with a metrics array
 * @param {string} metric - One of lcp / cls / inp
 * @returns {boolean}
 */
export function isMetricFailing(entry, metric) {
  if (!entry || !Array.isArray(entry.metrics)) {
    return false;
  }
  return entry.metrics.some((deviceMetrics) => {
    const value = deviceMetrics[metric];
    return value !== null && value !== undefined && value > THRESHOLDS[metric];
  });
}

/**
 * For each existing issue in `data.issues[]`, if its metric type no longer exceeds
 * threshold in the new audit data, mark it OUTDATED — unless its status is in
 * ISSUE_STATUSES_TO_PRESERVE, in which case it's untouched.
 *
 * Issues without a `type` field (legacy data) are left untouched: we can't tell
 * which metric they describe, so the safe behaviour is "no change."
 *
 * @param {Object[]} existingIssues - issues array from existing suggestion.data
 * @param {Object} newDataItem - the new CWV entry for this URL/pattern
 * @returns {Object[]} a new array (does not mutate input) with updated statuses
 */
export function applyPerIssueOutdated(existingIssues, newDataItem) {
  if (!Array.isArray(existingIssues) || existingIssues.length === 0) {
    return existingIssues || [];
  }
  return existingIssues.map((issue) => {
    if (!issue || !issue.type) {
      return issue;
    }
    if (issue.status && ISSUE_STATUSES_TO_PRESERVE.has(issue.status)) {
      return issue;
    }
    if (isMetricFailing(newDataItem, issue.type)) {
      return issue;
    }
    return { ...issue, status: Suggestion.STATUSES.OUTDATED };
  });
}

/**
 * Custom mergeDataFunction for CWV suggestions used by syncSuggestions on re-audit.
 *
 * Default behaviour is a shallow `{...existing, ...new}` spread. We extend it with
 * per-issue OUTDATED detection: when a URL still fails some metrics but others
 * resolved between audits, only the resolved metrics' issues flip to OUTDATED.
 * The suggestion itself stays NEW because the URL is still failing overall.
 *
 * The newDataItem (raw CWV entry) doesn't carry `issues`, so the existing
 * `data.issues[]` is preserved via the spread; we then post-process it.
 *
 * Backwards-compat: if existing data has no issues at all (fresh suggestion or
 * legacy row from before Mystique populated `data.issues[]`), we don't add an
 * empty `issues` key — keep the shallow-merge output identical to the previous
 * default so existing consumers and tests are unaffected.
 */
export function mergeCwvData(existingData, newDataItem) {
  const merged = { ...existingData, ...newDataItem };
  if (Array.isArray(existingData?.issues) && existingData.issues.length > 0) {
    merged.issues = applyPerIssueOutdated(existingData.issues, newDataItem);
  }
  return merged;
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
    // On re-audit: shallow-merge new fields onto existing data, then mark issues
    // OUTDATED for any metric whose failure has resolved (skip list preserves
    // APPROVED/REJECTED/FIXED/SKIPPED/IN_PROGRESS/ERROR/OUTDATED).
    mergeDataFunction: mergeCwvData,
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
      // jiraLink starts null (no Jira ticket yet). Schema allows null or a URI;
      // empty string fails Joi's uri() validator.
      data: {
        ...entry,
        jiraLink: null,
      },
    }),
  });

  opportunity.setLastAuditedAt(new Date().toISOString());
  await opportunity.save();

  return opportunity;
}
