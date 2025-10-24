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

const CWV_AUTO_SUGGEST_MESSAGE_TYPE = 'guidance:cwv-analysis';

const CWV_AUTO_SUGGEST_FEATURE_TOGGLE = 'cwv-auto-suggest';

/**
 * Checks if a specific suggestion should receive auto-suggest from Mystique
 *
 * CWV suggestion structure:
 * {
 *   opportunityId: string,
 *   status: 'NEW' | 'APPROVED' | 'SKIPPED' | 'FIXED' | 'ERROR',
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
 * - Are not NEW (IN_PROGRESS, APPROVED, FIXED, SKIPPED, ERROR)
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
 * Sends messages to Mystique for CWV auto-suggest processing
 * Sends one message per suggestion that needs auto-suggest (NEW status, no guidance)
 *
 * @param {Object} context - Context object containing log, sqs, env
 * @param {Object} opportunity - Opportunity object with siteId, auditId, opportunityId, and data
 * @param {Object} site - Site object with getBaseURL() and getDeliveryType() methods
 * @throws {Error} When SQS message sending fails
 */
export async function sendSQSMessageForAutoSuggest(context, opportunity, site) {
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
    log.info(`CWV auto-suggest is disabled for site ${site?.getId?.()}, skipping`);
    return;
  }

  try {
    const siteId = opportunity.getSiteId();
    const auditId = opportunity.getAuditId();
    const opportunityId = opportunity.getId();
    const suggestions = await opportunity.getSuggestions();

    log.info(`Processing ${suggestions.length} suggestions for CWV auto-suggest - siteId: ${siteId}, opportunityId: ${opportunityId}`);

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
      const metrics = suggestionData.metrics?.[0] || {};

      log.info(`Sending CWV suggestion for auto-suggest - suggestionId: ${suggestionId}, url: ${url}`);

      const sqsMessage = {
        type: CWV_AUTO_SUGGEST_MESSAGE_TYPE,
        siteId,
        auditId,
        deliveryType: site ? site.getDeliveryType() : 'aem_cs',
        time: new Date().toISOString(),
        data: {
          page: url,
          opportunityId,
          suggestionId,
          device_type: metrics.deviceType || 'mobile',
        },
      };

      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, sqsMessage);
      log.info(`CWV suggestion sent to Mystique - siteId: ${siteId}, suggestionId: ${suggestionId}, url: ${url}`);
    }

    log.info(`Completed sending CWV auto-suggest messages - siteId: ${siteId}, opportunityId: ${opportunityId}`);
  } catch (error) {
    const siteId = opportunity?.getSiteId?.() || 'unknown';
    const opportunityId = opportunity?.getId?.() || 'unknown';
    log.error(`[CWV] Failed to send auto-suggest messages to Mystique - siteId: ${siteId}, opportunityId: ${opportunityId}, error: ${error.message}`);
    throw new Error(error.message);
  }
}
