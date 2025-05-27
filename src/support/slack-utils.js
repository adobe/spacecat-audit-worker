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
  const { log, env } = context;
  const { channelId, threadTs } = slackContext;

  log.info('Preparing to send Slack message:', {
    channelId,
    threadTs,
    text,
    blocks: JSON.stringify(blocks),
    options: JSON.stringify(options),
  });

  try {
    // Create Slack client using the provided context and environment
    const slackClient = BaseSlackClient.createFrom({
      channelId,
      threadTs,
      env: {
        SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
        SLACK_SIGNING_SECRET: env.SLACK_SIGNING_SECRET,
      },
    });

    log.info('Created Slack client with config:', {
      channelId: slackClient.channelId,
      threadTs: slackClient.threadTs,
      hasToken: !!env.SLACK_BOT_TOKEN,
      hasSigningSecret: !!env.SLACK_SIGNING_SECRET,
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

    log.info('Sending Slack message:', {
      message: JSON.stringify(slackMessage, null, 2),
    });

    // Send the message
    const result = await slackClient.sendMessage(slackMessage);
    log.info('Slack message sent successfully:', {
      result: JSON.stringify(result),
      channel: channelId,
      thread: threadTs || 'new thread',
    });
    return result;
  } catch (error) {
    log.error('Failed to send Slack message:', {
      error: error.message,
      stack: error.stack,
      channelId,
      threadTs,
      hasToken: !!env.SLACK_BOT_TOKEN,
      hasSigningSecret: !!env.SLACK_SIGNING_SECRET,
    });
    throw error;
  }
}
