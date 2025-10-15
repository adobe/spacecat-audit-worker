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
 * Checks if opportunity needs auto-suggest from Mystique
 *
 * First checks if auto-suggest feature is enabled for the site,
 * then checks if opportunity has suggestions without CODE_CHANGE guidance.
 *
 * CWV suggestion structure:
 * {
 *   opportunityId: string,
 *   status: 'NEW' | 'APPROVED' | 'SKIPPED' | 'FIXED' | 'ERROR',
 *   ...
 *   data: {
 *     issues?: [              // Auto-suggest guidance stored here
 *       {
 *         type: 'lcp' | 'cls' | 'inp',
 *         value: string       // Markdown text with guidance/patch
 *       }
 *     ]
 *   },
 *   ...
 * }
 *
 * @param {Object} context - Context object containing log
 * @param {Object} opportunity - Opportunity object
 * @param {Object} site - Site object
 * @returns {Promise<boolean>} True if auto-suggest is enabled AND opportunity needs suggestions
 */
export async function needsAutoSuggest(context, opportunity, site) {
  const isEnabled = await isAuditEnabledForSite(CWV_AUTO_SUGGEST_FEATURE_TOGGLE, site, context);

  if (!isEnabled) {
    context.log.info(`CWV auto-suggest is disabled for site ${site?.getId?.()}, skipping`);
    return false;
  }

  // Feature is enabled, now check if opportunity needs suggestions
  const suggestions = await opportunity.getSuggestions();

  if (suggestions.length === 0) {
    return false; // No suggestions (no auto-suggest needed)
  }

  return suggestions.some((suggestion) => {
    const data = suggestion.getData();
    const issues = data?.issues || [];

    // Check if suggestion has no issues at all (needs auto-suggest)
    if (issues.length === 0) {
      return true;
    }

    // Check if any auto-suggest guidance is empty (needs auto-suggest)
    return issues.some((issue) => !issue.value || !issue.value.trim());
  });
}

/**
 * Sends a message to Mystique for CWV auto-suggest processing
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

  try {
    if (opportunity) {
      const opptyData = JSON.parse(JSON.stringify(opportunity));
      const { siteId } = opptyData;

      log.info(`Received CWV opportunity for auto-suggest (siteId: ${siteId}): ${JSON.stringify(opportunity)}`);

      const sqsMessage = {
        type: CWV_AUTO_SUGGEST_MESSAGE_TYPE,
        siteId: opptyData.siteId,
        auditId: opptyData.auditId,
        deliveryType: site ? site.getDeliveryType() : 'aem_cs',
        time: new Date().toISOString(),
        data: {
          page: site ? site.getBaseURL() : '',
          opportunityId: opptyData.opportunityId || '',
        },
      };

      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, sqsMessage);
      log.info(`CWV opportunity sent to Mystique for auto-suggest (siteId: ${siteId}): ${JSON.stringify(sqsMessage)}`);
    }
  } catch (error) {
    const siteId = opportunity?.siteId || 'unknown';
    log.error(`[CWV] Failed to send auto-suggest message to Mystique (siteId: ${siteId}) for opportunity ${opportunity?.getId()}: ${error.message}`);
    throw new Error(error.message);
  }
}
