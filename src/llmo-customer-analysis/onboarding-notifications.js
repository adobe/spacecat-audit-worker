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

import { postMessageSafe } from '../utils/slack-utils.js';

/**
 * Creates modern Slack blocks for onboarding notifications with Adobe colors
 */
function createOnboardingBlocks(eventType, siteId, baseUrl, details = {}) {
  switch (eventType) {
    case 'first_configuration':
      return [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚙️ First Configuration Provided!',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Site:*\n<${baseUrl}|${baseUrl}>`,
            },
            {
              type: 'mrkdwn',
              text: `*Site ID:*\n\`${siteId}\``,
            },
            {
              type: 'mrkdwn',
              text: `*Config Version:*\n${details.configVersion ? `\`${details.configVersion}\`` : '_Not specified_'}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🎯 *First configuration received*',
          },
        },
        {
          type: 'divider',
        },
      ];

    case 'cdn_provisioning': {
      const configText = details.cdnBucketConfig && Object.keys(details.cdnBucketConfig).length > 0
        ? `\`\`\`${JSON.stringify(details.cdnBucketConfig, null, 2)}\`\`\``
        : '_No specific configuration provided_';

      return [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚀 CDN Provisioning Requested!',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Site:*\n<${baseUrl}|${baseUrl}>`,
            },
            {
              type: 'mrkdwn',
              text: `*Site ID:*\n\`${siteId}\``,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*CDN Configuration Changes:*\n${configText}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '⚡ *CDN provisioning requested*',
          },
        },
        {
          type: 'divider',
        },
      ];
    }

    default:
      return [];
  }
}

/**
 * Sends Slack notification for customer onboarding events
 * @param {object} context - The context object
 * @param {object} site - The site object
 * @param {string} eventType - Type of event (first_configuration, cdn_provisioning)
 * @param {object} details - Additional event details
 */
export async function sendOnboardingNotification(context, site, eventType, details = {}) {
  const { log } = context;
  const siteId = site.getSiteId();
  const baseUrl = site.getBaseURL();

  const blocks = createOnboardingBlocks(eventType, siteId, baseUrl, details);

  if (blocks.length === 0) {
    log.warn(`Unknown onboarding event type: ${eventType}`);
    return;
  }

  const colors = {
    first_configuration: '#1473E6', // Adobe Blue
    cdn_provisioning: '#FF6B35', // Adobe Orange
  };

  const result = await postMessageSafe(context, process.env.SLACK_CHANNEL_LLMO_ONBOARDING_ID, '', {
    attachments: [{
      color: colors[eventType],
      blocks,
    }],
  });

  if (result.success) {
    log.info(`Successfully sent ${eventType} notification to Slack for site ${siteId}`);
  } else {
    log.error(`Failed to send ${eventType} notification to Slack for site ${siteId}:`, result.error);
  }
}
