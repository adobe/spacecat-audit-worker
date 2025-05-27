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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { sendSlackMessage } from '../support/slack-utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * Creates a standard audit status message for Slack
 * @param {string} siteId - The site ID
 * @param {string} organizationId - The organization ID
 * @param {string} experienceUrl - The experience URL
 * @param {string} status - The status to display
 * @returns {object} The message text and blocks
 */
function createAuditStatusMessage(siteId, organizationId, experienceUrl, status) {
  const text = `Audit Status Update for site ${siteId}`;
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Audit Status Update*\nSite ID: ${siteId}\nOrganization ID: ${organizationId}\nStatus: ${status}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Experience URL: ${experienceUrl}`,
        },
      ],
    },
  ];

  return { text, blocks };
}

/**
 * Runs the audit status processor
 * @param {object} message - The message object
 * @param {object} context - The context object
 * @returns {Promise<object>} The audit result
 */
export async function run(message, context) {
  const { log } = context;

  log.info('Handler received message:', {
    messageKeys: Object.keys(message),
    messageValues: Object.entries(message).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'object' ? JSON.stringify(value) : value;
      return acc;
    }, {}),
  });

  const {
    siteId,
    organizationId,
    auditStatusJob,
    slackContext,
  } = message;

  // Get the site URL from the audit status job
  const siteUrl = auditStatusJob?.siteUrl || message.siteUrl;

  if (!siteUrl) {
    log.error('Missing siteUrl in message:', message);
    throw new Error('Missing required siteUrl in message');
  }

  if (!slackContext) {
    log.error('Missing slackContext in message:', message);
    throw new Error('Missing required slackContext in message');
  }

  log.info('Slack context:', {
    slackContextKeys: Object.keys(slackContext),
    slackContextValues: Object.entries(slackContext).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'object' ? JSON.stringify(value) : value;
      return acc;
    }, {}),
  });

  log.info('Processing audit status for site:', {
    siteId,
    siteUrl,
    organizationId,
    auditType: Audit.AUDIT_TYPES.AUDIT_STATUS_PROCESSOR,
  });

  try {
    // Create and send the status message
    const { text, blocks } = createAuditStatusMessage(
      siteId,
      organizationId,
      siteUrl,
      'Processing',
    );

    log.info('Sending Slack message:', {
      text,
      blocks: JSON.stringify(blocks),
      slackContext: JSON.stringify(slackContext),
    });

    const slackResult = await sendSlackMessage(
      context,
      slackContext,
      text,
      blocks,
    );

    log.info('Slack message sent:', slackResult);

    return {
      siteId,
      auditResult: {
        status: 'processing',
        siteId,
        organizationId,
        experienceUrl: siteUrl,
        success: true,
      },
      fullAuditRef: siteUrl,
    };
  } catch (error) {
    log.error('Error in audit status processor:', error);
    // Try to send error message to Slack
    try {
      const { text, blocks } = createAuditStatusMessage(
        siteId,
        organizationId,
        siteUrl,
        `Error: ${error.message}`,
      );
      await sendSlackMessage(
        context,
        slackContext,
        text,
        blocks,
      );
    } catch (slackError) {
      log.error('Failed to send error message to Slack:', slackError);
    }

    return {
      siteId,
      auditResult: {
        status: 'error',
        siteId,
        error: `Audit status processing failed for ${siteId}: ${error.message}`,
        success: false,
      },
      fullAuditRef: siteUrl,
    };
  }
}

// Export the built handler for use with AuditBuilder
export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('run-audit-status', run, AUDIT_STEP_DESTINATIONS.AUDIT_WORKER)
  .build();
