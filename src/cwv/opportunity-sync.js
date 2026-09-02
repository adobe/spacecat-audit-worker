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

import { Audit, Suggestion, FixEntity } from '@adobe/spacecat-shared-data-access';
import { syncSuggestions, defaultMergeStatusFunction } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { convertToOpportunity } from '../common/opportunity.js';
import calculateKpiDeltasForAudit, { THRESHOLDS, METRICS, calculateConfidenceScore } from './kpi-metrics.js';
import { isHomepage } from './cwv-audit-result.js';
import { removeTrailingSlash } from '../utils/url-utils.js';

/**
 * Minimum number of RUM measurements a metric's p75 must be computed from before a
 * threshold breach is treated as a real, actionable CWV issue (SITES-50756). A p75
 * derived from a handful of samples is dominated by a single outlier navigation — a bot,
 * a bot-mitigation challenge, a cold-cache hit — which surfaced as false "Critical" LCP
 * suggestions on low-traffic pages that Google PSI/CrUX (larger sample-count gate, longer
 * window) never showed. The homepage is always reported per product decision, so its
 * suggestions waive this floor; groups and every other page are gated.
 */
export const MIN_METRIC_SAMPLES = 10;

/**
 * Number of measurements behind a metric's p75 for a given device row. A missing count
 * (legacy data, or a metric not observed on that device) is treated as zero samples.
 * @param {Object} deviceMetrics - a single device-level metrics object
 * @param {string} metric - one of lcp / cls / inp
 * @returns {number}
 */
function metricSampleCount(deviceMetrics, metric) {
  return deviceMetrics[`${metric}Count`] || 0;
}

/**
 * A device-level metric is "failing" when its p75 exceeds the good threshold AND — unless
 * the sample floor is waived (homepage) — it is backed by at least MIN_METRIC_SAMPLES
 * measurements. Null/undefined values are treated as passing (no data = not failing).
 * @param {Object} deviceMetrics - a single device-level metrics object
 * @param {string} metric - one of lcp / cls / inp
 * @param {boolean} enforceMinSamples - when true, a threshold breach below the sample
 *   floor is treated as passing (noise); when false the floor is waived
 * @returns {boolean}
 */
function isDeviceMetricFailing(deviceMetrics, metric, enforceMinSamples) {
  const value = deviceMetrics[metric];
  if (value === null || value === undefined || value <= THRESHOLDS[metric]) {
    return false;
  }
  return !enforceMinSamples || metricSampleCount(deviceMetrics, metric) >= MIN_METRIC_SAMPLES;
}

/**
 * Per-issue statuses that should NOT be removed when re-audit detects a metric
 * has resolved. These represent customer/system intent (FIXED, SKIPPED, etc.) or
 * in-flight work (APPROVED, IN_PROGRESS) — dropping them would lose history. Issues
 * with any other status (NEW, OUTDATED) get pruned when their metric is no longer
 * failing, so the UI never shows resolved/below-threshold issues.
 */
const ISSUE_STATUSES_TO_PRESERVE = new Set([
  Suggestion.STATUSES.FIXED,
  Suggestion.STATUSES.ERROR,
  Suggestion.STATUSES.SKIPPED,
  Suggestion.STATUSES.REJECTED,
  Suggestion.STATUSES.APPROVED,
  Suggestion.STATUSES.IN_PROGRESS,
]);

/**
 * Returns true if the CWV entry has at least one metric that exceeds the "good" threshold
 * on any device type. Null/undefined metric values are treated as passing (no data = not
 * failing). By default a threshold breach must clear the MIN_METRIC_SAMPLES floor to count
 * (SITES-50756); pass enforceMinSamples=false to waive the floor (homepage).
 * @param {Object} entry - CWV audit entry ({ metrics: [{lcp, cls, inp, ...}] })
 * @param {boolean} [enforceMinSamples=true] - whether the sample floor applies
 * @returns {boolean}
 */
export function hasFailingMetrics(entry, enforceMinSamples = true) {
  return entry.metrics.some(
    (deviceMetrics) => METRICS.some(
      (metric) => isDeviceMetricFailing(deviceMetrics, metric, enforceMinSamples),
    ),
  );
}

/**
 * Returns a copy of the entry where the metrics array only contains device entries
 * that have at least one failing metric (threshold breach clearing the sample floor,
 * unless waived). This prevents suggestions from containing green device-level data
 * alongside failing ones, and drops device rows whose only breach is noise.
 * @param {Object} entry - CWV audit entry
 * @param {boolean} [enforceMinSamples=true] - whether the sample floor applies
 * @returns {Object} Entry with metrics filtered to failing device types only
 */
export function filterToFailingDeviceMetrics(entry, enforceMinSamples = true) {
  return {
    ...entry,
    metrics: entry.metrics.filter(
      (deviceMetrics) => METRICS.some(
        (metric) => isDeviceMetricFailing(deviceMetrics, metric, enforceMinSamples),
      ),
    ),
  };
}

/**
 * True when the page was observed this run with a trustworthy sample volume — at least one
 * metric on any device backed by MIN_METRIC_SAMPLES measurements. A page seen only through
 * a handful of samples carries no reliable signal in EITHER direction, so it must neither
 * spawn a new suggestion nor age out an existing one: excluding it from the OUTDATED
 * coverage set preserves a prior issue across a sparse week (SITES-50756 + SITES-48436).
 * @param {Object} entry - CWV audit entry
 * @returns {boolean}
 */
export function hasReliableSamples(entry) {
  return entry.metrics.some(
    (deviceMetrics) => METRICS.some(
      (metric) => metricSampleCount(deviceMetrics, metric) >= MIN_METRIC_SAMPLES,
    ),
  );
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
 * For each existing issue in `data.issues[]`, drop it if its metric type no longer
 * exceeds threshold in the new audit data — unless its status is in
 * ISSUE_STATUSES_TO_PRESERVE (FIXED / SKIPPED / APPROVED / IN_PROGRESS / REJECTED /
 * ERROR), which we keep as customer/system intent.
 *
 * This prevents the UI from showing issue entries for metrics that have improved
 * back below threshold. Previously these were left in the array with status
 * OUTDATED, which leaked through to the UI.
 *
 * Issues without a `type` field (legacy data) are kept untouched: we can't tell
 * which metric they describe, so the safe behaviour is "no change."
 *
 * @param {Object[]} existingIssues - issues array from existing suggestion.data
 * @param {Object} newDataItem - the new CWV entry for this URL/pattern
 * @returns {Object[]} a new array (does not mutate input) with resolved issues removed
 */
export function applyPerIssueOutdated(existingIssues, newDataItem) {
  if (!Array.isArray(existingIssues) || existingIssues.length === 0) {
    return existingIssues || [];
  }
  return existingIssues.filter((issue) => {
    if (!issue || !issue.type) {
      return true;
    }
    if (issue.status && ISSUE_STATUSES_TO_PRESERVE.has(issue.status)) {
      return true;
    }
    return isMetricFailing(newDataItem, issue.type);
  });
}

/**
 * Custom mergeDataFunction for CWV suggestions used by syncSuggestions on re-audit.
 *
 * Default behaviour is a shallow `{...existing, ...new}` spread. We extend it with
 * per-issue resolution: when a URL still fails some metrics but others resolved
 * between audits, the resolved-metric issues are dropped from `data.issues[]` so
 * the UI no longer surfaces them. Customer/system-touched issues (FIXED, SKIPPED,
 * APPROVED, IN_PROGRESS, REJECTED, ERROR) are preserved for history. The suggestion
 * itself stays NEW because the URL is still failing overall.
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
  // Self-heal legacy rows that have jiraLink='' (schema rejects empty string;
  // canonical "unset" is null). Without this, re-audits keep emitting the
  // "jiraLink is not allowed to be empty" validation warning indefinitely.
  if (merged.jiraLink === '') {
    merged.jiraLink = null;
  }
  if (Array.isArray(existingData?.issues) && existingData.issues.length > 0) {
    merged.issues = applyPerIssueOutdated(existingData.issues, newDataItem);
  }
  return merged;
}

/**
 * How long a CWV suggestion may sit IN_PROGRESS before a re-audit treats it as
 * stale and reclaims it back to NEW. Mystique flips a suggestion to IN_PROGRESS
 * the moment it hands a generated patch off for deploy; on an auto-deploy-off
 * site nothing ever consumes that hand-off, so without this the suggestion is
 * stuck forever. 24h is comfortably longer than the transient deploy window, so
 * a genuinely in-flight IN_PROGRESS is never reclaimed mid-deploy.
 */
export const STALE_IN_PROGRESS_MS = 24 * 60 * 60 * 1000;

/**
 * FixEntity statuses that represent a real in-flight or live deploy. A suggestion
 * covered by a fix in one of these states must never be reclaimed — the deploy
 * hand-off is legitimately still owned downstream.
 */
const ACTIVE_FIX_STATUSES = new Set([
  FixEntity.STATUSES.PENDING,
  FixEntity.STATUSES.DEPLOYED,
  FixEntity.STATUSES.PUBLISHED,
]);

/**
 * Builds the CWV mergeStatusFunction for syncSuggestions. On re-audit it reclaims
 * STALE stuck IN_PROGRESS suggestions back to NEW so they self-heal instead of
 * accumulating every weekly run (Mystique sets IN_PROGRESS as the deploy hand-off;
 * on auto-deploy-off sites nothing ever deploys it). A suggestion is reclaimed ONLY
 * when ALL of the following hold:
 *   - it is IN_PROGRESS,
 *   - it has NO active fix entity (PENDING/DEPLOYED/PUBLISHED) — never touch a real
 *     in-flight/live deploy, and
 *   - it is stale (> STALE_IN_PROGRESS_MS since updatedAt) — never touch a freshly-set
 *     IN_PROGRESS still inside the transient deploy window.
 * Every other case delegates to defaultMergeStatusFunction, preserving its behaviour
 * (incl. OUTDATED-regression and ERROR→NEW handling).
 *
 * @param {Set<string>} activeFixSuggestionIds - suggestion ids covered by an active fix.
 * @param {boolean} fixFetchFailed - true if the fix-entity fetch failed; when true the
 *   function behaves exactly like defaultMergeStatusFunction (fail safe: no reclaim).
 * @returns {Function} mergeStatusFunction(existing, newDataItem, context)
 */
export function createMergeCwvStatus(activeFixSuggestionIds, fixFetchFailed) {
  return (existing, newDataItem, context) => {
    if (
      !fixFetchFailed
      && existing.getStatus() === Suggestion.STATUSES.IN_PROGRESS
      && !activeFixSuggestionIds.has(existing.getId())
      && Date.now() - new Date(existing.getUpdatedAt()).getTime() > STALE_IN_PROGRESS_MS
    ) {
      return Suggestion.STATUSES.NEW;
    }
    return defaultMergeStatusFunction(existing, newDataItem, context);
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
  const baseURL = removeTrailingSlash(site.getBaseURL());
  // The homepage is always reported per product decision, so its suggestions waive the
  // per-metric sample floor; every other page (and every group) enforces it (SITES-50756).
  const enforceMinSamplesFor = (entry) => !isHomepage(entry, baseURL);

  // Only sync suggestions for pages where at least one CWV metric is failing.
  // Pages where all metrics pass are not actionable. Data is already sorted by
  // page views descending from step 1.
  // A threshold breach computed from too few RUM samples is statistical noise, not an
  // actionable issue, so it is not treated as failing unless the page is the homepage
  // (SITES-50756). Additionally, strip device-level metrics that are all-green so that
  // suggestions only contain data for device types with actual CWV issues. This prevents
  // a page that is failing on one device but passing on another from surfacing green
  // metric values in its suggestion, which would make it appear incorrectly resolved.
  const cwvData = auditResult.cwv
    .filter((entry) => hasFailingMetrics(entry, enforceMinSamplesFor(entry)))
    .map((entry) => filterToFailingDeviceMetrics(entry, enforceMinSamplesFor(entry)));
  log.info(`[syncOpportunitiesAndSuggestions] site ${site.getId()} - ${cwvData.length} of ${auditResult.cwv.length} CWV entries have failing metrics`);

  // Set of page URLs RELIABLY observed in THIS run's RUM data (the full reported set,
  // before the failing-metrics filter). Passed to syncSuggestions so a suggestion is only
  // aged out to OUTDATED when its page was measured this run and dropped from the failing
  // set because it now passes. A URL absent from this set — bot/WAF-blocked HEAD, dropped
  // from the top-N/threshold selection, or sparse/empty RUM — is NOT evidence the issue is
  // resolved, so it must not be marked OUTDATED (SITES-48436). A page seen only through too
  // few samples is likewise no reliable signal, so it is excluded here to preserve a prior
  // issue across a sparse week (SITES-50756); the always-reported homepage is kept. Group/
  // pattern rows carry no scraped-URL identity and are unaffected by this guard.
  const scrapedUrlsSet = new Set(
    auditResult.cwv
      .filter((entry) => entry.type === 'url')
      .filter((entry) => isHomepage(entry, baseURL) || hasReliableSamples(entry))
      .map((entry) => entry.url),
  );

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

  // Build the set of suggestion ids that are covered by an ACTIVE fix entity
  // (PENDING/DEPLOYED/PUBLISHED). mergeCwvStatus uses this to reclaim ONLY the
  // stuck IN_PROGRESS suggestions that have no real in-flight/live deploy. On any
  // fetch failure we fail safe — skip reclaim entirely this run (fixFetchFailed) —
  // rather than risk reclaiming a suggestion whose deploy is genuinely in flight.
  const activeFixSuggestionIds = new Set();
  let fixFetchFailed = false;
  try {
    const fixEntities = await opportunity.getFixEntities();
    (fixEntities || []).forEach((fixEntity) => {
      if (ACTIVE_FIX_STATUSES.has(fixEntity.getStatus())) {
        // Contract (cross-repo): the CWV fix→suggestion link is the denormalized
        // changeDetails.suggestionId that spacecat-autofix-worker owns — its
        // cwv/handler.js writes changeDetails = { suggestionId, issueId, issueTitle }
        // and code-repo-manager.js reads it back. We deliberately key on that
        // rather than the canonical FixEntitySuggestion join for an O(1) reverse
        // lookup. If a future CWV fix writer ever lands without suggestionId, this
        // guard misses it — but the 24h staleness window + fail-safe (fixFetchFailed)
        // bound the blast radius, so a genuinely-live deploy is never reclaimed here.
        const suggestionId = fixEntity.getChangeDetails?.()?.suggestionId;
        if (suggestionId) {
          activeFixSuggestionIds.add(suggestionId);
        }
      }
    });
  } catch (e) {
    fixFetchFailed = true;
    log.warn(`[syncOpportunitiesAndSuggestions] site ${site.getId()} - failed to fetch fix entities; skipping IN_PROGRESS reclaim this run: ${e.message}`);
  }
  const mergeCwvStatus = createMergeCwvStatus(activeFixSuggestionIds, fixFetchFailed);

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
    scrapedUrlsSet,
    bypassValidationForPlg: true,
    // On re-audit: shallow-merge new fields onto existing data, then mark issues
    // OUTDATED for any metric whose failure has resolved (skip list preserves
    // APPROVED/REJECTED/FIXED/SKIPPED/IN_PROGRESS/ERROR/OUTDATED).
    mergeDataFunction: mergeCwvData,
    // On re-audit: reclaim STALE stuck IN_PROGRESS suggestions (no active fix,
    // >24h old) back to NEW so the Mystique deploy hand-off self-heals on
    // auto-deploy-off sites instead of accumulating every weekly audit.
    mergeStatusFunction: mergeCwvStatus,
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
