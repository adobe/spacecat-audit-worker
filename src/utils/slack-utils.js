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

import { BaseSlackClient, SLACK_TARGETS } from '@adobe/spacecat-shared-slack-client';
import { formatAllowlistMessage, hasText } from '@adobe/spacecat-shared-utils';

/**
 * Sends a message to Slack using the provided context and slackContext.
 * Mirrors the say() utility in spacecat-task-processor for consistent Slack
 * messaging across audit-triggered flows. Only sends when both channelId and
 * threadTs are present.
 *
 * Why both `say` and `postMessageOptional` (below) exist:
 *   - `say(env, log, slackContext, message)` is the canonical helper for
 *     audit-triggered Slack threads: takes a curated env subset, mirrors the
 *     task-processor signature, posts with `unfurl_links: false`.
 *   - `postMessageOptional(context, channelId, text, options)` is the general
 *     non-audit Slack sender used by other code paths in this repo: takes a
 *     full Lambda context, configurable target workspace, blocks/attachments.
 *
 * Both guard on `channelId` + `threadTs` and build a `WORKSPACE_INTERNAL`
 * client by default; if a future change makes one of them strictly more
 * capable than the other, prefer consolidating onto a single entry point.
 *
 * @param {object} env - The environment variables
 * @param {object} log - The logger
 * @param {object} slackContext - The Slack context containing channelId and threadTs
 * @param {string} message - The message text to send
 * @returns {Promise<void>}
 */
export async function say(env, log, slackContext, message) {
  // No-op when not triggered from Slack (no channel/thread to reply on).
  if (!hasText(slackContext?.channelId) || !hasText(slackContext?.threadTs)) {
    return;
  }
  try {
    const slackClientContext = {
      channelId: slackContext.channelId,
      threadTs: slackContext.threadTs,
      log,
      env: {
        SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
        SLACK_SIGNING_SECRET: env.SLACK_SIGNING_SECRET,
        SLACK_TOKEN_WORKSPACE_INTERNAL: env.SLACK_TOKEN_WORKSPACE_INTERNAL,
        SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL: env.SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL,
      },
    };
    const slackTarget = SLACK_TARGETS.WORKSPACE_INTERNAL;
    const slackClient = BaseSlackClient.createFrom(slackClientContext, slackTarget);
    await slackClient.postMessage({
      channel: slackContext.channelId,
      thread_ts: slackContext.threadTs,
      text: message,
      unfurl_links: false,
    });
  } catch (error) {
    if (log) {
      log.error('Error sending Slack message:', {
        error: error.message,
        stack: error.stack,
        errorType: error.name,
      });
    }
  }
}

/**
 * Sends a message to a Slack channel.
 * @param {object} context - The context object
 * @param {string} channelId - The Slack channel ID (e.g., 'C1234567890')
 * @param {string} text - The message text
 * @param {object} options - Additional options
 * @param {string} options.target - Target workspace (default: WORKSPACE_INTERNAL)
 * @param {string} options.threadTs - Thread timestamp for replying to a thread
 * @param {Array} options.blocks - Slack Block Kit blocks for rich formatting
 * @param {Array} options.attachments - Slack message attachments
 * @returns {Promise<{channelId: string, threadId: string}>} Channel and thread IDs
 */
export async function postMessage(context, channelId, text, options = {}) {
  const {
    target = SLACK_TARGETS.WORKSPACE_INTERNAL,
    threadTs,
    blocks,
    attachments,
  } = options;

  const slackClient = BaseSlackClient.createFrom(context, target);

  const message = {
    channel: channelId,
    text,
  };

  if (threadTs) {
    message.thread_ts = threadTs;
  }

  if (blocks) {
    message.blocks = blocks;
  }

  if (attachments) {
    message.attachments = attachments;
  }

  return slackClient.postMessage(message);
}

/**
 * Sends a message to a Slack channel with error handling and logging.
 * @param {object} context - The context object
 * @param {string} channelId - The Slack channel ID
 * @param {string} text - The message text
 * @param {object} options - Additional options (same as postMessage)
 * @returns {Promise<{success: boolean, result?: object, error?: Error}>} Operation result
 */
export async function postMessageSafe(context, channelId, text, options = {}) {
  try {
    const result = await postMessage(context, channelId, text, options);
    context.log?.info(`Successfully sent Slack message to channel ${channelId}`);
    return { success: true, result };
  } catch (error) {
    context.log?.error(`Failed to send Slack message to channel ${channelId}:`, error);
    return { success: false, error };
  }
}

/**
 * Act as a wrapper around postMessageSafe() to optionally send a message.
 * @param {object} context - The context object
 * @param {string} channelId - The Slack channel ID
 * @param {string} text - The message text
 * @param {object} options - Additional options (same as postMessage)
 * @returns {Promise<{success: boolean, result?: object, error?: Error}>} Operation result
 */
export async function postMessageOptional(context, channelId, text, options = {}) {
  const { threadTs } = options;
  if (hasText(channelId) && hasText(threadTs)) {
    return postMessageSafe(context, channelId, text, options);
  } else {
    return { success: false, result: null };
  }
}

/**
 * Formats HTTP status codes for the bot-protection Slack message.
 * @param {number|string} status
 * @returns {string}
 */
function formatHttpStatus(status) {
  const statusMap = {
    403: '🚫 403 Forbidden',
    200: '⚠️ 200 OK (Challenge Page)',
    unknown: '❓ Unknown Status',
  };
  return statusMap[String(status)] || `⚠️ ${status}`;
}

/**
 * Formats a blocker type name for display.
 * @param {string} type
 * @returns {string}
 */
function formatBlockerType(type) {
  const typeMap = {
    cloudflare: 'Cloudflare',
    akamai: 'Akamai',
    imperva: 'Imperva',
    fastly: 'Fastly',
    cloudfront: 'AWS CloudFront',
    unknown: 'Unknown Blocker',
  };
  return typeMap[type] || type;
}

/**
 * Formats a count-by-category object into a Slack bullet list.
 * @param {Object} data
 * @param {Function} formatter
 * @returns {string}
 */
function formatBreakdown(data, formatter) {
  return Object.entries(data || {})
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `  • ${formatter(key)}: ${count} URL${count > 1 ? 's' : ''}`)
    .join('\n');
}

/**
 * Formats a bot-protection abort into a rich Slack message including allowlist instructions.
 * Compatible with the task-processor's formatBotProtectionSlackMessage so both services
 * produce consistent output.
 *
 * @param {Object} options
 * @param {string} options.auditType - Audit type (e.g. 'cwv')
 * @param {string} options.siteUrl - The site URL
 * @param {Object} options.details - Bot-protection details from abort.details
 * @param {string[]} options.allowlistIps - IP addresses to allowlist
 * @param {string} options.allowlistUserAgent - User-Agent to allowlist
 * @returns {string}
 */
export function formatBotProtectionSlackMessage({
  auditType,
  siteUrl,
  details = {},
  allowlistIps = [],
  allowlistUserAgent = '',
}) {
  const {
    blockedUrlsCount = 0,
    totalUrlsCount = 0,
    byHttpStatus = {},
    byBlockerType = {},
    blockedUrls = [],
  } = details;

  const statusBreakdown = formatBreakdown(byHttpStatus, formatHttpStatus);
  const blockerBreakdown = formatBreakdown(byBlockerType, formatBlockerType);

  const sampleUrls = blockedUrls
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 3)
    .map((u) => {
      const label = (u.confidence || 0) >= 0.95 ? '(high confidence)' : '';
      return `  • ${u.url}\n    ${formatHttpStatus(u.httpStatus)} · ${formatBlockerType(u.blockerType)} ${label}`;
    })
    .join('\n');

  const ipList = allowlistIps.map((ip) => `  • \`${ip}\``).join('\n');

  let message = ':rotating_light: :warning: *Bot Protection Detected*\n\n'
    + `*Audit Type:* \`${auditType}\`\n`
    + `*Site:* ${siteUrl}\n`
    + `*Summary:* ${blockedUrlsCount}/${totalUrlsCount} URLs blocked\n\n`
    + '*📊 Detection Statistics*\n'
    + '*By HTTP Status:*\n'
    + `${statusBreakdown || '  • No status data available'}\n\n`
    + '*By Blocker Type:*\n'
    + `${blockerBreakdown || '  • No blocker data available'}\n\n`;

  if (sampleUrls) {
    message += `*🔍 Sample Blocked URLs*\n${sampleUrls}\n`;
    if (blockedUrlsCount > 3) {
      message += `  ... and ${blockedUrlsCount - 3} more URLs\n`;
    }
    message += '\n';
  }

  message += '*✅ How to Resolve*\n'
    + 'Allowlist SpaceCat Bot in your CDN/WAF:\n\n'
    + '*User-Agent:*\n'
    + `  • \`${allowlistUserAgent}\`\n\n`
    + '*IP Addresses:*\n'
    + `${ipList || '  • (no IPs configured)'}\n\n`
    + ':bulb: _After allowlisting, re-run onboarding or trigger a new audit._';

  return message;
}

/**
 * Formats a generic (non-bot-protection) audit failure message.
 *
 * @param {string} auditType - Audit type (e.g. 'cwv')
 * @param {string} siteUrl - The site URL
 * @param {Error} error - The caught error
 * @returns {string}
 */
export function formatAuditFailureMessage(auditType, siteUrl, error) {
  return ':x: *Audit Failed*\n\n'
    + `*Audit Type:* \`${auditType}\`\n`
    + `*Site:* ${siteUrl}\n`
    + `*Reason:* ${error?.message || 'Unknown error'}`;
}

/**
 * Formats a warning message for partial bot-protection blocks. The audit
 * continues with all URLs (including blocked ones) — Mystique still runs —
 * but the originator should know some scraped data may be incomplete.
 *
 * @param {Object} options
 * @param {string} options.auditType
 * @param {string} options.siteUrl
 * @param {Object} options.details - abort.details
 * @returns {string}
 */
export function formatBotProtectionPartialBlockMessage({
  auditType,
  siteUrl,
  details = {},
}) {
  const { blockedUrlsCount = 0, totalUrlsCount = 0, byBlockerType = {} } = details;
  const blockerBreakdown = formatBreakdown(byBlockerType, formatBlockerType);
  let message = ':warning: *Bot Protection — Partial Block*\n\n'
    + `*Audit Type:* \`${auditType}\`\n`
    + `*Site:* ${siteUrl}\n`
    + `*Summary:* ${blockedUrlsCount}/${totalUrlsCount} URLs blocked — continuing audit for all URLs\n`;
  if (blockerBreakdown) {
    message += `\n*By Blocker Type:*\n${blockerBreakdown}\n`;
  }
  message += '\n:bulb: _Allowlist SpaceCat Bot in your CDN/WAF for the blocked URLs to ensure reliable data on the next run._';
  return message;
}

/**
 * Formats an audit-completion message.
 *
 * @param {string} auditType - Audit type (e.g. 'cwv')
 * @param {string} siteUrl - The site URL
 * @returns {string}
 */
export function formatAuditCompletionMessage(auditType, siteUrl) {
  return ':white_check_mark: *Audit Completed*\n\n'
    + `*Audit Type:* \`${auditType}\`\n`
    + `*Site:* ${siteUrl}`;
}

/**
 * Converts a kebab-case, snake_case, or camelCase step identifier into a
 * human-readable Title Case label. Acronym runs are preserved (CWVData stays
 * "CWV Data", not "C W V Data").
 *
 * Examples:
 *   'send-to-mystique'                   -> 'Send To Mystique'
 *   'run-audit-and-generate-suggestions' -> 'Run Audit And Generate Suggestions'
 *   'sync_opportunity_and_suggestions_step' -> 'Sync Opportunity And Suggestions Step'
 *   'collectCWVDataAndImportCode'        -> 'Collect CWV Data And Import Code'
 *
 * @param {string} stepName
 * @returns {string}
 */
export function humanizeStepName(stepName) {
  if (!hasText(stepName)) {
    return '';
  }
  return stepName
    // kebab-case and snake_case separators -> spaces
    .replace(/[_-]/g, ' ')
    // camelCase / acronym boundaries — first rule splits lower→Upper ('aB' -> 'a B'),
    // second keeps acronym runs together ('CWVData' -> 'CWV Data', not 'C W V Data').
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    // Title-case every word. \b\w is a no-op on already-uppercase letters,
    // so acronyms in camelCase input survive intact.
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Formats a per-step completion message.
 *
 * @param {string} auditType - Audit type (e.g. 'cwv')
 * @param {string} siteUrl - The site URL
 * @param {string} stepName - The step identifier (auto-humanized for display)
 * @returns {string}
 */
export function formatStepCompletionMessage(auditType, siteUrl, stepName) {
  return `:arrows_counterclockwise: *${humanizeStepName(stepName)} — done*\n`
    + `*Audit Type:* \`${auditType}\`  ·  *Site:* ${siteUrl}`;
}

/**
 * Sends a Slack notification when an audit fails.
 * Detects bot-protection aborts and formats a rich message with allowlist instructions;
 * all other failures get a concise error message.
 *
 * This is the single generic entry point used by RunnerAudit, StepAudit, handleAbort,
 * and the outer dispatch in index.js so every audit/opportunity automatically surfaces
 * failures to the originating Slack thread.
 *
 * @param {Object} context - Lambda context (env, log)
 * @param {Object} params
 * @param {string} params.type - Audit type string
 * @param {string} params.siteUrl - Site base URL (for the message)
 * @param {Object} [params.auditContext] - Audit context; auditContext.slackContext is used
 * @param {Object} [params.abort] - Abort signal with reason/details (bot-protection path)
 * @param {Error}  [params.error] - Caught error (generic failure path)
 * @returns {Promise<void>}
 */
export async function sendAuditFailureNotification(context, {
  type,
  siteUrl,
  auditContext,
  abort,
  error,
}) {
  const { env, log } = context;
  const slackContext = auditContext?.slackContext;

  if (!slackContext?.channelId || !slackContext?.threadTs) {
    return; // No Slack thread to reply to — audit was not triggered from Slack
  }

  // Suppress duplicate Slack alerts when the outermost dispatcher catches an
  // error that an inner audit class (RunnerAudit / StepAudit / handleAbort) has
  // already reported. Without this guard, a single StepAudit failure produces
  // two alerts: one from the step-audit catch and one from the index.js catch
  // on the re-thrown error.
  //
  // The marker lives on `context` (the Lambda invocation object) — NOT on
  // slackContext. slackContext is a serializable payload that gets propagated
  // onto downstream SQS messages via preserveSlackContext, and we don't want
  // dedup state to leak there. context is the in-memory per-invocation handle
  // that every catch site shares; both runner-audit/step-audit and the outer
  // index.js dispatcher read the same reference.
  if (context.slackFailureNotifiedAt) {
    return;
  }

  let message;

  if (abort?.reason === 'bot-protection') {
    const botIps = env?.SPACECAT_BOT_IPS;
    const allowlistInfo = formatAllowlistMessage(botIps);
    message = formatBotProtectionSlackMessage({
      auditType: type,
      siteUrl,
      details: abort.details || {},
      allowlistIps: allowlistInfo.ips,
      allowlistUserAgent: allowlistInfo.userAgent,
    });
  } else {
    message = formatAuditFailureMessage(type, siteUrl, error);
  }

  await say(env, log, slackContext, message);
  // Set the dedup marker so a subsequent re-throw catcher in the same Lambda
  // invocation does not double-fire. Stays in-memory; never serialized.
  context.slackFailureNotifiedAt = new Date().toISOString();
}

export { SLACK_TARGETS };
