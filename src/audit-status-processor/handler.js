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
import { BaseSlackClient } from '@adobe/spacecat-shared-slack-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { sendSlackMessage } from '../support/slack-utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_TYPE = 'audit-status-processor';

/**
 * Creates a standard audit status message for Slack
 * @param {string} siteId - The site ID
 * @param {string} organizationId - The organization ID
 * @param {string} experienceUrl - The experience URL
 * @param {string} status - The status to display
 * @returns {string} The message text
 */
function createAuditStatusMessage(siteId, organizationId, experienceUrl, status) {
  return `Audits ${status} for ${siteId} in ${organizationId} at ${experienceUrl}`;
}

/**
 * Runs the audit status processor
 * @param {object} auditStatusMessage - The auditStatusMessage object
 * @param {object} context - The context object
 * @returns {Promise<object>} The audit result
 */
export async function run(auditStatusMessage, context) {
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

  const {
    siteId,
    auditContext,
    type,
  } = auditStatusMessage;

  const {
    experienceUrl: siteUrl,
    organizationId,
    slackContext,
  } = auditContext;

  const {
    threadTs,
    channelId,
  } = slackContext;

  log.info('auditStatusMessage:', {
    siteId,
    type,
    siteUrl,
    organizationId,
    threadTs,
    channelId,
  });

  if (!channelId) {
    log.error('Missing channelId in slackContext:', slackContext);
    throw new Error('Missing required channelId in slackContext');
  }
  if (!threadTs) {
    log.error('Missing threadTs in slackContext:', slackContext);
    throw new Error('Missing required threadTs in slackContext');
  }

  log.info('Processing audit status for site:', {
    siteId,
    siteUrl,
    organizationId,
    auditType: AUDIT_TYPE,
  });

  try {
    // Create Slack client
    const slackClient = BaseSlackClient.createFrom({
      channelId: slackContext.channelId,
      threadTs: slackContext.threadTs,
      env: {
        SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
        SLACK_SIGNING_SECRET: env.SLACK_SIGNING_SECRET,
      },
    }, 'internal');

    // Create and send the status message
    const slackMessage = createAuditStatusMessage(
      siteId,
      organizationId,
      siteUrl,
      'Completed',
    );

    log.info('Sending Slack message:', {
      slackMessage,
      channelId,
      threadTs,
    });

    await sendSlackMessage(slackClient, slackContext, slackMessage);

    return {
      siteId,
      auditResult: {
        status: 'Completed',
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
