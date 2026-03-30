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
import { removeTrailingSlash } from '../utils/url-utils.js';

const INTERVAL = 7; // days
const TARGET_CWV_ENTRY_COUNT = 15;
const PRIORITY_PADDING_MIN_PAGEVIEWS = 1000;
const CWV_THRESHOLDS = {
  lcp: 2500,
  cls: 0.1,
  inp: 200,
};

/**
 * Returns true when a single CWV metric is outside the "good" range.
 *
 * @param {'lcp'|'cls'|'inp'} metric - CWV metric name
 * @param {number|null|undefined} value - Metric value from RUM
 * @returns {boolean} Whether the metric exceeds the good threshold
 */
function isMetricAboveGoodThreshold(metric, value) {
  return Number.isFinite(value) && value > CWV_THRESHOLDS[metric];
}

/**
 * Returns true when any device-level metric in an entry exceeds the good threshold.
 *
 * This is the definition of a "failing" CWV entry for opportunity ranking.
 *
 * @param {object} entry - RUM CWV entry (URL or group)
 * @returns {boolean} Whether the entry has at least one threshold violation
 */
function isFailingCwvEntry(entry) {
  return entry.metrics?.some((metric) => (
    isMetricAboveGoodThreshold('lcp', metric.lcp)
    || isMetricAboveGoodThreshold('cls', metric.cls)
    || isMetricAboveGoodThreshold('inp', metric.inp)
  )) ?? false;
}

/**
 * Converts a raw CWV metric into a normalized pressure score relative to the
 * "good" threshold. A value of 1.0 sits exactly on the threshold, values below
 * 1.0 are still passing, and values above 1.0 are failing.
 *
 * @param {'lcp'|'cls'|'inp'} metric - CWV metric name
 * @param {number|null|undefined} value - Metric value from RUM
 * @returns {number} Normalized threshold pressure
 */
function getMetricThresholdPressureScore(metric, value) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return value / CWV_THRESHOLDS[metric];
}

/**
 * Returns the strongest threshold pressure across the entry's available CWV metrics.
 *
 * For passing entries this tells us which page is closest to becoming failing,
 * which is the basis for padding after we exhaust truly failing pages.
 *
 * @param {object} entry - RUM CWV entry (URL or group)
 * @returns {number} Highest normalized threshold pressure for the entry
 */
function getEntryThresholdPressureScore(entry) {
  return Math.max(
    ...(entry.metrics?.flatMap((metric) => [
      getMetricThresholdPressureScore('lcp', metric.lcp),
      getMetricThresholdPressureScore('cls', metric.cls),
      getMetricThresholdPressureScore('inp', metric.inp),
    ]) ?? [0]),
  );
}

/**
 * Sort comparator used for traffic-first ranking.
 *
 * @param {object} a - RUM CWV entry
 * @param {object} b - RUM CWV entry
 * @returns {number} Sort order
 */
function compareEntriesByPageviewsDesc(a, b) {
  return b.pageviews - a.pageviews;
}

/**
 * Sort comparator for passing entries used as padding. We prefer pages that are
 * closest to failing, then break ties by traffic.
 *
 * @param {object} a - RUM CWV entry
 * @param {object} b - RUM CWV entry
 * @returns {number} Sort order
 */
function comparePassingEntriesByPressureScoreThenPageviews(a, b) {
  const thresholdPressureDiff = getEntryThresholdPressureScore(b)
    - getEntryThresholdPressureScore(a);
  if (thresholdPressureDiff !== 0) {
    return thresholdPressureDiff;
  }

  return compareEntriesByPageviewsDesc(a, b);
}

/**
 * Splits raw CWV entries into the two primary ranking buckets used by the
 * product rule:
 * - failing entries ranked by traffic
 * - passing entries ranked by threshold pressure, then traffic
 *
 * @param {object[]} cwvEntries - Raw RUM CWV entries
 * @returns {{ failingEntries: object[], passingEntries: object[] }} Ranked buckets
 */
function splitEntriesByFailureState(cwvEntries) {
  const failingEntries = [];
  const passingEntries = [];

  cwvEntries.forEach((entry) => {
    if (isFailingCwvEntry(entry)) {
      failingEntries.push(entry);
      return;
    }

    passingEntries.push(entry);
  });

  failingEntries.sort(compareEntriesByPageviewsDesc);
  passingEntries.sort(comparePassingEntriesByPressureScoreThenPageviews);

  return {
    failingEntries,
    passingEntries,
  };
}

/**
 * Applies the CWV opportunity product rule to the ranked entry buckets.
 *
 * Selection order:
 * 1. All failing entries ranked by traffic
 * 2. Passing entries with at least 1000 pageviews ranked by threshold pressure then traffic
 * 3. Remaining passing entries as a final fallback, ranked the same way
 *
 * @param {object[]} cwvEntries - Raw RUM CWV entries from the RUM API
 * @returns {{
 *   selectedEntries: object[],
 *   failingEntries: object[],
 *   passingEntries: object[],
 *   priorityPaddingEntries: object[],
 *   fallbackPaddingEntries: object[],
 * }} Ranked selection details used for the audit result and logging
 */
function selectCwvEntriesForOpportunity(cwvEntries) {
  const { failingEntries, passingEntries } = splitEntriesByFailureState(cwvEntries);
  const priorityPaddingEntries = passingEntries
    .filter((entry) => entry.pageviews >= PRIORITY_PADDING_MIN_PAGEVIEWS);
  const fallbackPaddingEntries = passingEntries
    .filter((entry) => entry.pageviews < PRIORITY_PADDING_MIN_PAGEVIEWS);
  const selectedEntries = [
    ...failingEntries,
    ...priorityPaddingEntries,
    ...fallbackPaddingEntries,
  ].slice(0, TARGET_CWV_ENTRY_COUNT);

  return {
    selectedEntries,
    failingEntries,
    passingEntries,
    priorityPaddingEntries,
    fallbackPaddingEntries,
  };
}

/**
 * Builds the prioritized CWV audit result for opportunity creation.
 *
 * The returned `auditResult.cwv` payload is already ranked according to the
 * product rule. Downstream consumers should preserve that order and must not
 * assume every selected entry is failing.
 *
 * @param {Object} context - Audit context containing the site, finalUrl, log, and RUM client config
 * @returns {Promise<Object>} Audit result payload and fullAuditRef for persistence
 */
export async function buildPrioritizedCWVAuditResult(context) {
  const { site, finalUrl: auditUrl, log } = context;
  const siteId = site.getId();
  const siteBaseURL = removeTrailingSlash(site.getBaseURL());

  const rumApiClient = RUMAPIClient.createFrom(context);
  const groupedURLs = site.getConfig().getGroupedURLs(Audit.AUDIT_TYPES.CWV);
  const options = {
    domain: auditUrl,
    interval: INTERVAL,
    granularity: 'hourly',
    groupedURLs,
  };
  const cwvData = await rumApiClient.query(Audit.AUDIT_TYPES.CWV, options);
  const {
    selectedEntries,
    failingEntries,
    passingEntries,
    priorityPaddingEntries,
    fallbackPaddingEntries,
  } = selectCwvEntriesForOpportunity(cwvData);

  const selectedFailingCount = selectedEntries.filter(isFailingCwvEntry).length;
  const selectedPriorityPaddingCount = selectedEntries.filter(
    (entry) => !isFailingCwvEntry(entry) && entry.pageviews >= PRIORITY_PADDING_MIN_PAGEVIEWS,
  ).length;
  const selectedFallbackPaddingCount = selectedEntries.filter(
    (entry) => !isFailingCwvEntry(entry) && entry.pageviews < PRIORITY_PADDING_MIN_PAGEVIEWS,
  ).length;

  log.info(
    `[audit-worker-cwv] siteId: ${siteId} | baseURL: ${siteBaseURL} | Total=${cwvData.length}, `
    + `Failing=${failingEntries.length}, Passing=${passingEntries.length}, Reported=${selectedEntries.length} | `
    + `Selected failing=${selectedFailingCount}, `
    + `Priority padding candidates=${priorityPaddingEntries.length}, `
    + `Fallback padding candidates=${fallbackPaddingEntries.length}, `
    + `Selected priority padding (>=${PRIORITY_PADDING_MIN_PAGEVIEWS} PV)=${selectedPriorityPaddingCount}, `
    + `Selected fallback padding=${selectedFallbackPaddingCount}`,
  );

  return {
    auditResult: {
      cwv: selectedEntries,
      auditContext: {
        interval: INTERVAL,
      },
    },
    fullAuditRef: auditUrl,
  };
}

// Backward-compatible alias while downstream imports are updated.
export const buildCWVAuditResult = buildPrioritizedCWVAuditResult;
