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

import { deepEqual, isObject } from '@adobe/spacecat-shared-utils';
import { getCodeInfo } from '../accessibility/utils/data-processing.js';
import { METRICS, THRESHOLDS } from './kpi-metrics.js';

/**
 * Given all device-level metric rows for a suggestion, returns:
 * - failingMetrics: metric names (lcp/cls/inp) that exceed the threshold on any device
 * - cwvMetricValues: worst (highest) observed value for each failing metric across devices
 *
 * Used to tell Mystique exactly which metrics are flagged so it only generates
 * guidance for those metrics and can surface the measured values to the UI.
 * @param {Array<Object>} allMetrics - Array of per-device metric objects
 * @returns {{ failingMetrics: string[], cwvMetricValues: Object }}
 */
function getFailingMetricInfo(allMetrics) {
  const worstValues = {};
  for (const deviceMetrics of allMetrics) {
    for (const metric of METRICS) {
      const value = deviceMetrics[metric];
      if (value !== null && value !== undefined && value > THRESHOLDS[metric]) {
        if (worstValues[metric] === undefined || value > worstValues[metric]) {
          worstValues[metric] = value;
        }
      }
    }
  }
  return {
    failingMetrics: Object.keys(worstValues),
    cwvMetricValues: worstValues,
  };
}

/**
 * Deterministic "dispatch fingerprint" describing the inputs that justify (re)sending a
 * CWV suggestion to Mystique. Stamped on the suggestion after a NEW dispatch and compared
 * on the next weekly audit so we only re-dispatch when a relevant input changed:
 * - the set of failing metrics grew/changed (e.g. CLS newly goes bad), or
 * - site code became available (`hadCodeInfo` false -> true) so a code patch that couldn't
 *   be generated before might now succeed.
 * Both the guard (read) and `processAutoSuggest` (stamp) build it identically so a stamped
 * marker re-compares exactly next run. Mirrors the V2/blackboard `idea_fingerprint` idea.
 *
 * @param {string[]} failingMetrics - metrics failing this run (lcp/cls/inp)
 * @param {boolean} hasCodeInfo - whether a code repo/path is available for this site
 * @returns {{ failingMetrics: string[], hadCodeInfo: boolean }}
 */
function buildDispatchFingerprint(failingMetrics, hasCodeInfo) {
  return { failingMetrics: [...failingMetrics].sort(), hadCodeInfo: !!hasCodeInfo };
}

const CWV_AUTO_SUGGEST_MESSAGE_TYPE = 'guidance:cwv';

/**
 * Checks if a specific suggestion should receive auto-suggest from Mystique.
 *
 * CWV suggestion structure:
 * {
 *   status: 'NEW' | 'PENDING_VALIDATION' | 'APPROVED' | 'SKIPPED' | 'FIXED' | 'ERROR'
 *     | 'REJECTED',
 *   data: {
 *     type: 'url' | 'group',
 *     url?: string,                  // Present for type: 'url'
 *     pattern?: string,              // Present for type: 'group'
 *     metrics: [{...}],
 *     isCodeChangeAvailable?: boolean, // Set by autofix-worker when a patch lands
 *     issues?: [                     // Auto-suggest guidance stored here
 *       { type: 'lcp' | 'cls' | 'inp', value: string, source_index?: number,
 *         patchContent?: string }
 *     ]
 *   }
 * }
 *
 * On paid-tier ASO sites, CWV suggestions are created as PENDING_VALIDATION and an
 * SME reviews the generated guidance before approving them to NEW. Guidance is
 * therefore dispatched for both statuses — without it for PENDING_VALIDATION there
 * is nothing for the SME to review and the suggestion can never be approved.
 *
 * For NEW, we dispatch whenever no code patch has been produced yet
 * (`data.isCodeChangeAvailable !== true`) AND a relevant input has changed since the
 * last dispatch. Cost control (same flagged metric week after week shouldn't pay for
 * fresh guidance every audit): we SUPPRESS the re-dispatch when the currently-failing
 * metric set is already fully covered by existing guidance (`data.issues[*].type`) AND
 * the dispatch fingerprint is unchanged from the last stamped one
 * (`data.autoSuggestDispatch`). We still re-dispatch when a new bad metric appears or
 * when site code becomes available (both flip the fingerprint), and — crucially — when
 * guidance never actually arrived for a still-failing metric (`allFailingGuided` false),
 * so a slow/failed Mystique *guidance* run is still retried. We deliberately ignore
 * `issues[*].value` (its mere presence is not proof a code patch ran) — the retry is
 * bounded by the fingerprint + code-patch availability, not by guidance text existing.
 *
 * Bounded limitation: if code was already available at the first dispatch (so
 * `hadCodeInfo` is already `true` and never flips), guidance succeeded for every failing
 * metric, but Mystique's *code-fix* generation transiently failed and no patch landed
 * (`isCodeChangeAvailable` stays `false`), the fingerprint is unchanged and re-dispatch is
 * suppressed until the failing-metric set changes. The `hadCodeInfo false→true` escape only
 * covers newly-available code, not a failed generation on already-available code. This is
 * an accepted trade-off: reintroducing a blanket weekly retry for this case is exactly the
 * cost this guard removes, and it assumes code-fix generation is reliable whenever guidance
 * succeeds and code is present.
 *
 * For PENDING_VALIDATION, re-dispatch is gated on the existing guidance being
 * missing or in the legacy aggregated format (no per-issue `source_index`), so a
 * suggestion that already has granular guidance isn't re-sent (and regenerated)
 * on every weekly audit while it's awaiting SME review.
 *
 * Group filtering and "page is all-green" filtering happen in `processAutoSuggest`.
 *
 * @param {Object} suggestion - Suggestion object
 * @param {boolean} [hasCodeInfo=false] - whether site code is available this run; part of
 *   the dispatch fingerprint so a NEW page re-dispatches once when code first appears.
 * @returns {boolean} True if suggestion should receive auto-suggest
 */
export function shouldSendAutoSuggestForSuggestion(suggestion, hasCodeInfo = false) {
  const status = suggestion.getStatus();
  if (status !== 'NEW' && status !== 'PENDING_VALIDATION') {
    return false;
  }
  const data = suggestion.getData() || {};
  if (data.isCodeChangeAvailable === true) {
    return false;
  }
  if (status === 'PENDING_VALIDATION') {
    const { issues } = data;
    const hasGranularGuidance = Array.isArray(issues) && issues.length > 0
      && issues.some((i) => Number.isInteger(i.source_index));
    return !hasGranularGuidance;
  }

  // status === 'NEW': suppress the weekly re-dispatch unless an input changed.
  const { failingMetrics } = getFailingMetricInfo(data.metrics || []);
  if (failingMetrics.length === 0) {
    // All-green: dispatch decision defers to processAutoSuggest, which owns the skip+log.
    return true;
  }
  const guidedMetrics = new Set(
    (Array.isArray(data.issues) ? data.issues : []).map((i) => i.type),
  );
  const allFailingGuided = failingMetrics.every((m) => guidedMetrics.has(m));
  const stored = data.autoSuggestDispatch;
  const fingerprintUnchanged = isObject(stored)
    && deepEqual(stored, buildDispatchFingerprint(failingMetrics, hasCodeInfo));
  if (allFailingGuided && fingerprintUnchanged) {
    return false;
  }
  return true;
}

/**
 * Processes CWV auto-suggest for eligible suggestions.
 * Filters suggestions that need guidance and sends messages to Mystique for
 * AI-powered guidance generation.
 * Sends one message per suggestion that needs auto-suggest (NEW or PENDING_VALIDATION
 * status, no guidance yet — see `shouldSendAutoSuggestForSuggestion`)
 * Includes code repository information (codeBucket, codePath) whenever a site is provided.
 *
 * Entitlement/enablement for `cwv` is already verified upstream — the job-dispatcher's
 * `isHandlerEnabledForSite` pre-filter for scheduled runs, and `run-audit`'s entitlement +
 * deny-list check for one-off runs — before this audit ever gets dispatched, so this step
 * does not re-check `cwv-auto-suggest`/`cwv-auto-fix` (consistent with how every other
 * audit type's auto-suggest/auto-fix step in this codebase relies on the base audit's own
 * gating rather than re-checking Configuration for the sub-feature).
 *
 * @param {Object} context - Context object containing log, sqs, env, s3Client
 * @param {Object} opportunity - Opportunity object with siteId, auditId, opportunityId, and data
 * @param {Object} site - Site object with getBaseURL() and getDeliveryType() methods
 * @throws {Error} When SQS message sending fails
 */
export async function processAutoSuggest(context, opportunity, site) {
  const {
    log, sqs, env, dataAccess,
  } = context;
  const Suggestion = dataAccess?.Suggestion;

  try {
    const siteId = opportunity.getSiteId();
    const auditId = opportunity.getAuditId();
    const opportunityId = opportunity.getId();
    const suggestions = await opportunity.getSuggestions();

    log.info(`[audit-worker-cwv] siteId: ${siteId} | Processing ${suggestions.length} suggestions for CWV auto-suggest, opportunityId: ${opportunityId}`);

    const codeInfo = site ? await getCodeInfo(site, 'cwv', context) : null;
    const hasCodeInfo = codeInfo && codeInfo.codeBucket && codeInfo.codePath && String(codeInfo.codePath).trim() !== '';

    // NEW suggestions we dispatched this run, stamped with a fresh dispatch fingerprint so
    // the next weekly audit can suppress an identical re-dispatch. Persisted in one batched
    // saveMany (never per-item save — see the repo N+1 guidance).
    const dispatchedNew = [];

    // Send one SQS message per suggestion that needs auto-suggest
    for (const suggestion of suggestions) {
      // Skip suggestions that don't need auto-suggest
      if (!shouldSendAutoSuggestForSuggestion(suggestion, hasCodeInfo)) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const suggestionId = suggestion.getId();
      const suggestionData = suggestion.getData();

      // Skip groups - only process URL-type suggestions
      if (suggestionData.type === 'group') {
        // eslint-disable-next-line no-continue
        continue;
      }

      // Extract URL and metrics from suggestion data
      const { url } = suggestionData;
      const allMetrics = suggestionData.metrics || [];
      const firstMetrics = allMetrics[0] || {};
      const { failingMetrics, cwvMetricValues } = getFailingMetricInfo(allMetrics);

      // Defense-in-depth: hasFailingMetrics upstream should already exclude these,
      // but if a future code path bypasses that filter we don't want Mystique to
      // generate guidance for an all-green page.
      if (failingMetrics.length === 0) {
        log.info(`[audit-worker-cwv] siteId: ${siteId} | Skipping suggestionId: ${suggestionId} - no failing CWV metrics`);
        // eslint-disable-next-line no-continue
        continue;
      }

      log.debug(`[audit-worker-cwv] siteId: ${siteId} | Sending CWV suggestion for auto-suggest, suggestionId: ${suggestionId}, url: ${url}, failingMetrics: ${failingMetrics.join(',')}`);

      const sqsMessage = {
        type: CWV_AUTO_SUGGEST_MESSAGE_TYPE,
        siteId,
        auditId,
        deliveryType: site ? site.getDeliveryType() : 'aem_cs',
        time: new Date().toISOString(),
        data: {
          type: 'cwv', // Discriminator for Pydantic Union type resolution
          url,
          opportunityId,
          suggestionId,
          // Current suggestion status so Mystique can gate code-fix generation on
          // SME approval (PENDING_VALIDATION → guidance only, NEW → approved for
          // code-fix generation).
          suggestionStatus: suggestion.getStatus(),
          device_type: firstMetrics.deviceType || 'mobile',
          // Metrics flagged as failing in RUM — Mystique must only generate guidance
          // for these metrics, keeping the identify and suggest steps consistent.
          failing_metrics: failingMetrics,
          // Actual P75 values for each failing metric — passed through so guidance
          // issues can surface the measured value alongside the recommendation.
          cwv_metric_values: cwvMetricValues,
          // Add code repository information if available
          ...(hasCodeInfo && {
            codeBucket: codeInfo.codeBucket,
            codePath: codeInfo.codePath,
          }),
        },
      };

      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, sqsMessage);
      log.info(`[audit-worker-cwv] siteId: ${siteId} | CWV suggestion message sent to Mystique (opportunityId: ${opportunityId}, suggestionId: ${suggestionId}, url: ${url}), message: \n${JSON.stringify(sqsMessage, null, 2)}`);

      // Stamp the dispatch fingerprint on NEW suggestions so an unchanged re-audit next
      // week is suppressed. NEW only: a leftover PENDING_VALIDATION-era fingerprint must
      // not suppress the first post-SME-approval NEW dispatch (that dispatch is what
      // authorizes Mystique code-fix generation via suggestionStatus).
      if (Suggestion && suggestion.getStatus() === 'NEW') {
        suggestion.setData({
          ...suggestionData,
          autoSuggestDispatch: buildDispatchFingerprint(failingMetrics, hasCodeInfo),
        });
        dispatchedNew.push(suggestion);
      }
    }

    if (dispatchedNew.length > 0) {
      // Best-effort persistence: every SQS message already went out above, so a failure
      // here must not fail the audit step. If the stamp doesn't persist, next week's
      // audit simply re-dispatches (the fingerprint guard sees no stored fingerprint) —
      // the fail-safe direction. Log a warning instead of propagating to the outer catch.
      try {
        await Suggestion.saveMany(dispatchedNew);
      } catch (stampError) {
        log.warn(`[audit-worker-cwv] siteId: ${siteId} | Failed to persist dispatch fingerprint for ${dispatchedNew.length} suggestion(s); messages were already sent, will re-dispatch next audit. error: ${stampError.message}`);
      }
    }

    log.info(`[audit-worker-cwv] siteId: ${siteId} | Completed sending CWV auto-suggest messages, opportunityId: ${opportunityId}`);
  } catch (error) {
    const siteId = opportunity?.getSiteId?.() || 'unknown';
    const opportunityId = opportunity?.getId?.() || 'unknown';
    log.error(`[audit-worker-cwv] siteId: ${siteId} | Failed to send auto-suggest messages to Mystique, opportunityId: ${opportunityId}, error: ${error.message}`);
    throw new Error(error.message);
  }
}
