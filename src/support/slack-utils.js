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
    blocks: JSON.stringify(blocks, null, 2),
    options: JSON.stringify(options, null, 2),
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
      tokenLength: env.SLACK_BOT_TOKEN?.length,
      signingSecretLength: env.SLACK_SIGNING_SECRET?.length,
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
      messageLength: JSON.stringify(slackMessage).length,
      blocksLength: JSON.stringify(blocks).length,
      textLength: text.length,
    });

    // Send the message
    const result = await slackClient.sendMessage(slackMessage);
    log.info('Slack message sent successfully:', {
      result: JSON.stringify(result, null, 2),
      channel: channelId,
      thread: threadTs || 'new thread',
      messageId: result?.ts,
    });
    return result;
  } catch (error) {
    // Log the raw error first
    log.error('Raw Slack error:', {
      error,
      errorMessage: error.message,
      errorStack: error.stack,
      errorType: error.name,
    });

    // Try to safely stringify the message for logging
    let messageStr;
    try {
      messageStr = JSON.stringify({
        channel: channelId,
        text,
        blocks,
        ...options,
        thread_ts: threadTs,
      }, null, 2);
    } catch (stringifyError) {
      messageStr = 'Failed to stringify message';
      log.error('Failed to stringify message for logging:', {
        stringifyError: stringifyError.message,
        stringifyErrorType: stringifyError.name,
      });
    }

    // Log the error with safe message string
    log.error('Failed to send Slack message:', {
      error: error.message,
      stack: error.stack,
      errorType: error.name,
      channelId,
      threadTs,
      hasToken: !!env.SLACK_BOT_TOKEN,
      hasSigningSecret: !!env.SLACK_SIGNING_SECRET,
      tokenLength: env.SLACK_BOT_TOKEN?.length,
      signingSecretLength: env.SLACK_SIGNING_SECRET?.length,
      message: messageStr,
    });

    throw error;
  }
}
