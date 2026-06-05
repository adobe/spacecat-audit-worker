/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { fetch } from '@adobe/spacecat-shared-utils';

const SLACK_API = 'https://slack.com/api/chat.postMessage';
const PRODUCT_CODE_ASO = 'ASO';
const TIER_PLG = 'PLG';
export const PLG_SUGGESTION_THRESHOLD = 3;

/**
 * Escapes mrkdwn control characters and truncates to prevent injection
 * when embedding untrusted strings in Slack messages.
 *
 * @param {string} text
 * @param {number} [maxLength=500]
 * @returns {string}
 */
function sanitizeForSlack(text, maxLength = 500) {
  return String(text ?? '')
    .slice(0, maxLength)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Returns true if the site has an ASO PLG entitlement.
 *
 * @param {object} site
 * @param {object} log
 * @returns {Promise<boolean>}
 */
async function isSitePlgTier(site, log) {
  try {
    const enrollments = await site.getSiteEnrollments();
    if (!enrollments?.length) {
      return false;
    }
    const entitlements = await Promise.all(enrollments.map((e) => e.getEntitlement()));
    return entitlements.some(
      (e) => e?.getProductCode() === PRODUCT_CODE_ASO && e?.getTier() === TIER_PLG,
    );
  } catch (err) {
    log.warn(`Failed to determine ASO PLG tier for site ${site.getId()}: ${err.message}`);
    return false;
  }
}

/**
 * Posts a JSON body message to a Slack channel via the Web API.
 *
 * @param {string} channelId
 * @param {string} message
 * @param {string} token
 * @returns {Promise<void>}
 */
async function postSlackMessage(channelId, message, token) {
  const resp = await fetch(SLACK_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: channelId,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: message } }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Slack API HTTP error: ${resp.status}`);
  }

  const json = await resp.json();
  if (!json.ok) {
    throw new Error(`Slack API error: ${json.error}`);
  }
}

/**
 * Sends a Slack alert when an audit for a PLG site surfaces fewer than
 * PLG_SUGGESTION_THRESHOLD new suggestions.
 * Only fires for PLG-tier sites and the three audit types visible to PLG customers:
 * cwv, alt-text, broken-backlinks.
 * Fails silently — never throws.
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN                    – Slack bot OAuth token
 *   SLACK_AUDIT_LOW_SUGGESTION_CHANNEL – channel ID for low-suggestion alerts
 *
 * @param {object} site           - The Site model instance.
 * @param {string} auditType      - The audit type (e.g. 'cwv', 'alt-text').
 * @param {number} suggestionCount - Number of NEW suggestions surfaced after the audit.
 * @param {object} context        - Lambda context ({ env, log }).
 * @returns {Promise<void>}
 */
export async function sendLowSuggestionCountAlert(site, auditType, suggestionCount, context) {
  const { env, log } = context;
  const token = env?.SLACK_BOT_TOKEN;
  const channelId = env?.SLACK_AUDIT_LOW_SUGGESTION_CHANNEL;

  if (!token || !channelId) {
    return;
  }

  if (suggestionCount >= PLG_SUGGESTION_THRESHOLD) {
    return;
  }

  try {
    const isPlg = await isSitePlgTier(site, log);
    if (!isPlg) {
      return;
    }

    const siteBaseURL = sanitizeForSlack(site.getBaseURL?.() ?? site.getId());
    const safeAuditType = sanitizeForSlack(auditType);

    const message = ':warning: *Low Suggestion Count for PLG Site*\n\n'
      + `• *Site:* \`${siteBaseURL}\`\n`
      + `• *Site ID:* \`${site.getId()}\`\n`
      + `• *Audit Type:* \`${safeAuditType}\`\n`
      + `• *New Suggestions:* \`${suggestionCount}\` (threshold: ${PLG_SUGGESTION_THRESHOLD})`;

    await postSlackMessage(channelId, message, token);
  } catch (alertError) {
    log.error(`Failed to send low suggestion count Slack alert: ${alertError.message}`);
  }
}
