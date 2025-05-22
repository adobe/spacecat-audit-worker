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

// eslint-disable-next-line import/no-unresolved
import { BaseSlackClient } from '@adobe/spacecat-shared-slack-client';

/**
 * Sends a message to Slack using the provided context and message details
 * @param {object} context - The context object containing configurations and services
 * @param {object} slackContext - The Slack context containing channelId and threadTs
 * @param {string} text - The main text of the message
 * @param {Array} blocks - The message blocks to display
 * @param {object} options - Additional options for the message (e.g., thread_ts)
 * @returns {Promise<void>}
 */
export async function sendSlackMessage(context, slackContext, text, blocks, options = {}) {
  const { log } = context;
  const { channelId, threadTs } = slackContext;

  try {
    // Create Slack client using the provided context
    const slackClient = BaseSlackClient.createFrom({
      channelId,
      threadTs,
    });

    // Construct the message
    const slackMessage = {
      channel: channelId,
      text,
      blocks,
      ...options,
    };

    // If we have a thread timestamp, use it to reply in the thread
    if (threadTs) {
      slackMessage.thread_ts = threadTs;
    }

    // Send the message
    await slackClient.sendMessage(slackMessage);
    log.info(`Sent Slack message in channel ${channelId}${threadTs ? ` (thread: ${threadTs})` : ''}`);
  } catch (error) {
    log.error(`Failed to send Slack message: ${error.message}`, error);
    throw error;
  }
}
