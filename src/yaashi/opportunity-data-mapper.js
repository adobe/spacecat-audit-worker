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

import { randomUUID } from 'crypto';
import { LLM_404_BLOCKED_AUDIT, MYSTIQUE_MESSAGE_TYPE, SUGGESTION_TYPES } from './constants.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { sleep } from '../support/utils.js';

function createOpportunityData() {
  return {
    runbook: 'https://wiki.corp.adobe.com/display/AEMSites/404+Agentic+Traffic',
    origin: 'AUTOMATION',
    title: 'Agentic Traffic - 404 Blocked URLs',
    description: 'When AI hits a 404, the page visit is unutilized. This is a problem because it means that the AI is not able scrape data and surface it, which leads to potential traffic loss.',
    guidance: {
      steps: [
        'Review the list of 404 URLs and their corresponding redirect suggestions.',
      ],
    },
    tags: ['isElmo'],
    data: {},
  };
}

/**
 * Send 404 URLs to Mystique and create suggestions
 * @param {Object} context - Audit context
 * @param {Object} opportunity - The single opportunity object
 * @param {Array} urlsWithCounts - Array of {url, count} objects
 * @returns {Promise<Object>} Statistics about messages sent
 */
async function sendToMystique(
  context,
  site,
  auditId,
  urlsWithCounts,
  opportunityId,
  suggestionIdMap,
) {
  const { log, sqs, env } = context;

  if (!sqs || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`[${LLM_404_BLOCKED_AUDIT}] SQS or queue configuration missing, skipping Mystique integration`);
    return { messagesSent: 0, successfulMessages: 0, failedMessages: 0 };
  }

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Sending ${urlsWithCounts.length} URLs to Mystique and creating opportunities`);

  const baseMessage = {
    type: MYSTIQUE_MESSAGE_TYPE,
    siteId: site.getId(),
    auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
  };

  let successfulMessages = 0;
  let failedMessages = 0;
  const BATCH_SIZE = 10;

  for (let i = 0; i < urlsWithCounts.length; i += BATCH_SIZE) {
    const batch = urlsWithCounts.slice(i, Math.min(i + BATCH_SIZE, urlsWithCounts.length));
    // eslint-disable-next-line no-loop-func
    const batchPromises = batch.map(async (urlData) => {
      const messageId = randomUUID();
      const suggestionId = suggestionIdMap.get(urlData.path) || randomUUID();

      try {
        // Send message to Mystique (suggestion will be created later)
        const message = {
          MessageId: messageId,
          Body: JSON.stringify({
            ...baseMessage,
            data: {
              broken_url: urlData.fullUrl,
              alternative_urls: [],
              opportunity_id: opportunityId,
              suggestion_id: suggestionId,
            },
          }),
        };

        await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
        return { success: true, url: urlData.path, suggestionId };
      } catch (error) {
        log.error(`[${LLM_404_BLOCKED_AUDIT}] Failed to process URL ${urlData.fullUrl}: ${error.message}`);
        return { success: false, url: urlData.path, error: error.message };
      }
    });

    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.success) {
        successfulMessages += 1;
      } else {
        failedMessages += 1;
      }
    }

    if (i + BATCH_SIZE < urlsWithCounts.length) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(50);
    }
  }

  const messageStats = {
    messagesSent: urlsWithCounts.length,
    successfulMessages,
    failedMessages,
  };

  log.info(`[${LLM_404_BLOCKED_AUDIT}] Mystique integration complete: ${successfulMessages} messages sent, ${failedMessages} failed`);

  return messageStats;
}

export default async function llm404PostProcessor(auditUrl, auditData, context, site) {
  const { log } = context;
  const { siteId, id: auditId, auditResult } = auditData;

  try {
    // Only process if audit was successful and has blocked URLs
    if (
      !auditResult.success || !auditResult.blocked404Urls || auditResult.blocked404Urls.length === 0
    ) {
      log.info(`[${LLM_404_BLOCKED_AUDIT}] No valid URLs to process for site ${siteId}`);
      return auditData;
    }

    const { blocked404Urls } = auditResult;
    const siteBaseUrl = site.getBaseURL();

    const urlsWithCounts = blocked404Urls.map((item) => {
      const itemPath = item.URL?.startsWith('/') ? item.URL : `/${item.URL || ''}`;
      const fullUrl = new URL(itemPath, siteBaseUrl).href;
      return {
        fullUrl,
        path: itemPath,
        count_404s: item.count_404s || 0,
      };
    });

    log.info(`[${LLM_404_BLOCKED_AUDIT}] Processing ${urlsWithCounts.length} URLs for opportunities and Mystique integration`);

    const opportunity = await convertToOpportunity(
      auditUrl,
      { siteId, id: auditId },
      context,
      createOpportunityData,
      LLM_404_BLOCKED_AUDIT,
    );

    const buildKey = (data) => data.path;
    await syncSuggestions({
      opportunity,
      newData: urlsWithCounts,
      context,
      buildKey,
      mapNewSuggestion: (urlData) => ({
        opportunityId: opportunity.getId(),
        type: SUGGESTION_TYPES.REDIRECT_UPDATE,
        rank: urlData.count_404s,
        status: 'NEW',
        data: {
          url: urlData.path,
          count_404s: urlData.count_404s,
          full_url: urlData.fullUrl,
          siteDomain: new URL(site.getBaseURL()).hostname,
        },
      }),
      log,
    });

    const suggestions = await opportunity.getSuggestions();
    const suggestionIdMap = new Map();
    suggestions.forEach((s) => {
      const d = s.getData();
      if (d.url) {
        suggestionIdMap.set(d.url, s.getId());
      }
    });

    const mystiqueStats = await sendToMystique(
      context,
      site,
      auditId,
      urlsWithCounts,
      opportunity.getId(),
      suggestionIdMap,
    );

    const { audit } = context;
    if (audit && mystiqueStats.messagesSent > 0) {
      audit.setDataValue('mystique', {
        expected: mystiqueStats.messagesSent,
        received: 0,
      });
      await audit.save();
      log.info(`[${LLM_404_BLOCKED_AUDIT}] Audit ${auditId} updated with expected suggestion count: ${mystiqueStats.messagesSent}`);
    }

    const updatedAuditData = {
      ...auditData,
      auditResult: {
        ...auditResult,
        mystiqueIntegration: {
          messagesSent: mystiqueStats.messagesSent,
          successfulMessages: mystiqueStats.successfulMessages,
          failedMessages: mystiqueStats.failedMessages,
          opportunityCreated: 1,
          suggestionsCreated: urlsWithCounts.length,
          successRate: mystiqueStats.messagesSent > 0
            ? `${((mystiqueStats.successfulMessages / mystiqueStats.messagesSent) * 100).toFixed(1)}%` : '0%',
        },
      },
    };

    log.info(`[${LLM_404_BLOCKED_AUDIT}] Post-processing complete for site ${siteId}: 1 opportunity updated with ${urlsWithCounts.length} suggestions, ${mystiqueStats.messagesSent} messages sent to Mystique`);

    return updatedAuditData;
  } catch (error) {
    log.error(`[${LLM_404_BLOCKED_AUDIT}] Error in post-processor for site ${siteId}: ${error.message}`, error);
    return auditData;
  }
}
