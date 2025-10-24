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

export { SLACK_TARGETS };
