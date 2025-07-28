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

import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { LLM_404_BLOCKED_AUDIT, REPORT_HANDLER_SQS_TYPE } from './constants.js';

async function atomicIncrementReceived(AuditModel, auditId, log) {
  if (typeof AuditModel.update === 'function') {
    try {
      await AuditModel.update(auditId, { $ADD: { 'data.mystique.received': 1 } });
      return;
    } catch (err) {
      log.warn(`[${LLM_404_BLOCKED_AUDIT}] Atomic $ADD failed (falling back): ${err.message}`);
    }
  }
  const audit = await AuditModel.findById(auditId);
  if (!audit) {
    return;
  }
  const mystiqueData = audit.getData()?.mystique || { expected: 0, received: 0 };
  audit.setDataValue('mystique', {
    ...mystiqueData,
    received: (mystiqueData.received || 0) + 1,
  });
  await audit.save();
}

async function processSuggestionResponse(context, opportunity) {
  const {
    log, dataAccess, sqs, env,
  } = context;
  const { Audit } = dataAccess;
  const auditId = opportunity.getAuditId();

  try {
    const audit = await Audit.getByID(auditId);
    if (!audit) {
      log.warn(`[${LLM_404_BLOCKED_AUDIT}] Audit ${auditId} not found when trying to trigger report.`);
      return;
    }

    const mystiqueData = audit.getData()?.mystique || { expected: 0, received: 0 };
    const expected = mystiqueData.expected || 0;

    await atomicIncrementReceived(Audit, auditId, log);

    const newReceived = (mystiqueData.received || 0) + 1; // optimistic display

    log.info(`[${LLM_404_BLOCKED_AUDIT}] Suggestion count for audit ${auditId}: ${newReceived}/${expected}`);

    if (expected > 0 && newReceived >= expected) {
      log.info(`[${LLM_404_BLOCKED_AUDIT}] All suggestions received for audit ${auditId}. Triggering report generation.`);
      const message = {
        type: REPORT_HANDLER_SQS_TYPE,
        auditId,
        siteId: opportunity.getSiteId(),
      };
      await sqs.sendMessage(env.QUEUE_SPACECAT, message);
    }
  } catch (error) {
    log.error(`[${LLM_404_BLOCKED_AUDIT}] Failed to check/trigger report for audit ${auditId}: ${error.message}`, error);
  }
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Opportunity, Suggestion } = dataAccess;
  const { siteId, data } = message;
  const {
    suggestionId,
    broken_url, // eslint-disable-line camelcase
    suggested_urls, // eslint-disable-line camelcase
    aiRationale,
  } = data;

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Message received in guidance handler for site: ${siteId}, URL: ${broken_url}`); // eslint-disable-line camelcase

  const suggestion = await Suggestion.findById(suggestionId);
  if (!suggestion) {
    log.warn(`[${LLM_404_BLOCKED_AUDIT}] No suggestion found for suggestionId: ${suggestionId}`);
    return notFound();
  }

  const opportunity = await Opportunity.findById(suggestion.getOpportunityId());
  if (!opportunity) {
    log.warn(`[${LLM_404_BLOCKED_AUDIT}] No opportunity found for suggestion ${suggestionId}`);
    return notFound();
  }

  if (opportunity.getSiteId() !== siteId) {
    log.warn(`[${LLM_404_BLOCKED_AUDIT}] SiteId mismatch: expected ${opportunity.getSiteId()}, got ${siteId}`);
    return { status: 400, body: 'SiteId mismatch' };
  }

  if (message.auditId && opportunity.getAuditId() !== message.auditId) {
    log.warn(`[${LLM_404_BLOCKED_AUDIT}] AuditId mismatch: expected ${opportunity.getAuditId()}, got ${message.auditId}`);
    return { status: 400, body: 'AuditId mismatch' };
  }

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Found suggestion ${suggestionId}, processing AI guidance for URL: ${broken_url}`); // eslint-disable-line camelcase

  const currentData = suggestion.getData();
  suggestion.setData({
    ...currentData,
    urlsSuggested: suggested_urls || [], // eslint-disable-line camelcase
    aiRationale: aiRationale || '',
    aiResponseReceived: true,
    aiResponseTimestamp: new Date().toISOString(),
  });
  suggestion.setUpdatedBy('system');
  await suggestion.save();

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Successfully processed guidance for suggestion ${suggestionId}, URL: ${broken_url}, suggestions: ${suggested_urls?.length || 0}`); // eslint-disable-line camelcase

  await processSuggestionResponse(context, opportunity);

  return ok();
}
