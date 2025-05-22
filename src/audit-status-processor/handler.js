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

// import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { sendSlackMessage } from '../support/slack-utils.js';

// const auditType = Audit.AUDIT_TYPES.AUDIT_STATUS;

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
 * Processes the audit status and sends notifications to Slack
 * @param {object} message - The SQS message containing auditStatusJob
 * @param {object} context - The context object containing configurations and services
 * @returns {Promise<object>} - Returns a response object
 */
export async function processAuditStatus(message, context) {
  const { log } = context;
  const { auditStatusJob } = message;
  const { siteId, auditContext } = auditStatusJob;

  try {
    // Log the status processing message
    log.info(`Processing audit status for site ${siteId}`);
    log.debug('Audit status job:', JSON.stringify(auditStatusJob));

    // Create and send the status message
    const { text, blocks } = createAuditStatusMessage(
      siteId,
      auditContext.organizationId,
      auditContext.experienceUrl,
      'Processing',
    );

    await sendSlackMessage(
      context,
      auditContext.slackContext,
      text,
      blocks,
    );

    return {
      fullAuditRef: auditContext.experienceUrl,
      auditResult: {
        status: 'processing',
        siteId,
        organizationId: auditContext.organizationId,
        experienceUrl: auditContext.experienceUrl,
      },
    };
  } catch (error) {
    log.error(`Failed to process audit status for site ${siteId}: ${error.message}`, error);
    return {
      fullAuditRef: auditContext.experienceUrl,
      auditResult: {
        error: error.message,
        success: false,
      },
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('audit-status-processor', processAuditStatus)
  .build();
