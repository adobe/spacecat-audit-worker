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
import { ok } from '@adobe/spacecat-shared-http-utils';

/**
 * Processes the audit status and sends notifications to Slack
 * @param {object} message - The message object received from SQS
 * @param {object} context - The context object containing configurations and services
 * @returns {Promise<object>} - Returns a response object
 */
export async function processAuditStatus(message, context) {
  const { log } = context;
  const { siteId, auditContext } = message;

  try {
    // Log the status processing message
    log.info(`Processing audit status for site ${siteId}`);
    log.info(`Audit context: ${JSON.stringify(auditContext)}`);

    // Create Slack client using the context from the audit context
    const slackClient = BaseSlackClient.createFrom(auditContext.slackContext);

    // Send status message to Slack
    const slackMessage = {
      text: `Audit Status Update for site ${siteId}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Audit Status Update*\nSite ID: ${siteId}\nOrganization ID: ${auditContext.organizationId}\nStatus: Processing`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Experience URL: ${auditContext.experienceUrl}`,
            },
          ],
        },
      ],
    };

    // If we have a thread timestamp, use it to reply in the thread
    if (auditContext.slackContext.threadTs) {
      slackMessage.thread_ts = auditContext.slackContext.threadTs;
    }

    await slackClient.sendMessage(slackMessage);
    log.info(`Sent audit status notification to Slack for site ${siteId}`);

    return ok();
  } catch (error) {
    log.error(`Failed to process audit status for site ${siteId}: ${error.message}`, error);
    throw error;
  }
}

export default {
  run: processAuditStatus,
};
