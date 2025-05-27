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
  const { log, env } = context;

  // Check for required Slack environment variables
  if (!env.SLACK_BOT_TOKEN) {
    log.error('Missing required SLACK_BOT_TOKEN environment variable');
    throw new Error('Missing required SLACK_BOT_TOKEN environment variable');
  }

  if (!env.SLACK_SIGNING_SECRET) {
    log.error('Missing required SLACK_SIGNING_SECRET environment variable');
    throw new Error('Missing required SLACK_SIGNING_SECRET environment variable');
  }

  // Log raw message without stringifying strings
  log.info('Handler received message:', {
    messageKeys: Object.keys(message),
    messageValues: Object.entries(message).reduce((acc, [key, value]) => {
      // Don't stringify if it's already a string
      acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
      return acc;
    }, {}),
  });

  const {
    siteId,
    auditContext,
  } = message;

  log.info('Raw auditContext:', {
    value: auditContext,
    type: typeof auditContext,
    isObject: typeof auditContext === 'object',
    keys: auditContext ? Object.keys(auditContext) : [],
  });

  // Validate auditContext structure
  if (!auditContext || typeof auditContext !== 'object') {
    log.error('Invalid auditContext:', {
      auditContext,
      type: typeof auditContext,
    });
    throw new Error('Invalid auditContext: must be an object');
  }

  const {
    experienceUrl: siteUrl,
    slackContext,
    organizationId,
  } = auditContext;

  if (!siteUrl) {
    log.error('Missing siteUrl in auditContext:', auditContext);
    throw new Error('Missing required siteUrl in auditContext');
  }

  if (!slackContext) {
    log.error('Missing slackContext in auditContext:', auditContext);
    throw new Error('Missing required slackContext in auditContext');
  }

  if (!slackContext.channelId) {
    log.error('Missing channelId in slackContext:', slackContext);
    throw new Error('Missing required channelId in slackContext');
  }

  log.info('Slack context:', {
    slackContextKeys: Object.keys(slackContext),
    slackContextValues: slackContext, // Don't stringify objects in logs
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
      hasToken: !!env.SLACK_BOT_TOKEN,
      hasSigningSecret: !!env.SLACK_SIGNING_SECRET,
    });

    const slackResult = await sendSlackMessage(
      context,
      slackContext,
      text,
      blocks, // Make sure blocks are passed
    );

    log.info('Slack message sent:', {
      result: JSON.stringify(slackResult),
      channel: slackContext.channelId,
      thread: slackContext.threadTs || 'new thread',
    });

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
    log.error('Error in audit status processor:', {
      error: error.message,
      stack: error.stack,
      errorType: error.name,
    });
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
        blocks, // Make sure blocks are passed
      );
    } catch (slackError) {
      log.error('Failed to send error message to Slack:', {
        error: slackError.message,
        stack: slackError.stack,
        errorType: slackError.name,
      });
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
