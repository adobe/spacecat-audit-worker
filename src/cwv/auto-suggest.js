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

import { isAuditEnabledForSite } from '../common/index.js';
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

const CWV_AUTO_SUGGEST_MESSAGE_TYPE = 'guidance:cwv';
const CWV_AUTO_SUGGEST_FEATURE_TOGGLE = 'cwv-auto-suggest';
const CWV_AUTO_FIX_FEATURE_TOGGLE = 'cwv-auto-fix';

/**
 * Checks if a specific suggestion should receive auto-suggest from Mystique
 *
 * CWV suggestion structure:
 * {
 *   opportunityId: string,
 *   status: 'NEW' | 'APPROVED' | 'SKIPPED' | 'FIXED' | 'ERROR' | 'REJECTED',
 *   ...
 *   data: {
 *     type: 'url' | 'group',
 *     url?: string,              // Present for type: 'url'
 *     pattern?: string,          // Present for type: 'group'
 *     metrics: [{...}],
 *     issues?: [                 // Auto-suggest guidance stored here
 *       {
 *         type: 'lcp' | 'cls' | 'inp',
 *         value: string,         // Markdown text with guidance
 *         patchContent: string   // Git diff patch
 *       }
 *     ]
 *   },
 *   ...
 * }
 *
 * Filters out suggestions that:
 * - Are not NEW (IN_PROGRESS, APPROVED, FIXED, SKIPPED, ERROR, REJECTED)
 * - Already have guidance (data.issues with non-empty values)
 *
 * @param {Object} suggestion - Suggestion object
 * @returns {boolean} True if suggestion should receive auto-suggest
 */
export function shouldSendAutoSuggestForSuggestion(suggestion) {
  const status = suggestion.getStatus();

  // Only send for NEW suggestions
  if (status !== 'NEW') {
    return false;
  }

  const data = suggestion.getData();
  const issues = data?.issues || [];

  // If no issues at all, send for auto-suggest
  if (issues.length === 0) {
    return true;
  }

  // If any issue has empty value, send for auto-suggest
  return issues.some((issue) => !issue.value || !issue.value.trim());
}

/**
 * Processes CWV auto-suggest for eligible suggestions.
 * Checks if auto-suggest is enabled, filters suggestions that need guidance,
 * and sends messages to Mystique for AI-powered guidance generation.
 * Sends one message per suggestion that needs auto-suggest (NEW status, no guidance)
 * Includes code repository information (codeBucket, codePath) if auto-fix feature is enabled
 *
 * @param {Object} context - Context object containing log, sqs, env, s3Client
 * @param {Object} opportunity - Opportunity object with siteId, auditId, opportunityId, and data
 * @param {Object} site - Site object with getBaseURL() and getDeliveryType() methods
 * @throws {Error} When SQS message sending fails
 */
export async function processAutoSuggest(context, opportunity, site) {
  const {
    log, sqs, env,
  } = context;

  // Check if CWV auto-suggest feature is enabled for this site
  const isAutoSuggestEnabled = await isAuditEnabledForSite(
    CWV_AUTO_SUGGEST_FEATURE_TOGGLE,
    site,
    context,
  );
  if (!isAutoSuggestEnabled) {
    log.info(`[audit-worker-cwv] siteId: ${site?.getId?.()} | baseURL: ${site?.getBaseURL?.()} | CWV auto-suggest is disabled, skipping`);
    return;
  }

  // Check if CWV auto-fix feature is enabled for this site
  const isAutoFixEnabled = await isAuditEnabledForSite(
    CWV_AUTO_FIX_FEATURE_TOGGLE,
    site,
    context,
  );

  try {
    const siteId = opportunity.getSiteId();
    const auditId = opportunity.getAuditId();
    const opportunityId = opportunity.getId();
    const suggestions = await opportunity.getSuggestions();

    log.info(`[audit-worker-cwv] siteId: ${siteId} | Processing ${suggestions.length} suggestions for CWV auto-suggest, opportunityId: ${opportunityId}`);

    // Get code repository information only if auto-fix is enabled
    const codeInfo = (isAutoFixEnabled && site) ? await getCodeInfo(site, 'cwv', context) : null;
    const hasCodeInfo = codeInfo && codeInfo.codeBucket && codeInfo.codePath && String(codeInfo.codePath).trim() !== '';

    // Send one SQS message per suggestion that needs auto-suggest
    for (const suggestion of suggestions) {
      // Skip suggestions that don't need auto-suggest
      if (!shouldSendAutoSuggestForSuggestion(suggestion)) {
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
    }

    log.info(`[audit-worker-cwv] siteId: ${siteId} | Completed sending CWV auto-suggest messages, opportunityId: ${opportunityId}`);
  } catch (error) {
    const siteId = opportunity?.getSiteId?.() || 'unknown';
    const opportunityId = opportunity?.getId?.() || 'unknown';
    log.error(`[audit-worker-cwv] siteId: ${siteId} | Failed to send auto-suggest messages to Mystique, opportunityId: ${opportunityId}, error: ${error.message}`);
    throw new Error(error.message);
  }
}
