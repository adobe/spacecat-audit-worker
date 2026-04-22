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

import { postMessageOptional } from '../utils/slack-utils.js';

/**
 * Wraps a guidance handler to send a Slack notification when the audit completes
 * successfully and the originating audit was triggered from Slack.
 *
 * The wrapper looks up the persisted audit record, extracts `slackContext`
 * (stored by `AuditBuilder.withSlackContext()`), and posts a thread reply.
 *
 * @param {string} auditType - Audit type label for the Slack message
 * @param {Function} handler - Guidance handler function (message, context) => result
 * @returns {Function} Wrapped handler with the same signature
 */
export function withSlackNotification(auditType, handler) {
  return async (message, context) => {
    const result = await handler(message, context);

    if (result?.status === 200 && message.auditId) {
      try {
        const { Audit } = context.dataAccess;
        const audit = await Audit.findById(message.auditId);
        const slackContext = audit?.getAuditResult()?.slackContext;

        if (slackContext) {
          const { channelId, threadTs } = slackContext;
          const url = message.url || message.data?.url || '';
          await postMessageOptional(
            context,
            channelId,
            `:white_check_mark: *${auditType}* audit finished for *${url}*`,
            { threadTs },
          );
        }
      } catch (e) {
        context.log?.warn?.(`[audit-notifier] Failed to send Slack notification for ${auditType}: ${e.message}`);
      }
    }

    return result;
  };
}
