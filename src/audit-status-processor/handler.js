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

const auditType = Audit.AUDIT_TYPES.AUDIT_STATUS_PROCESSOR;

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
 * @param {string} auditUrl - The audit URL
 * @param {object} context - The context object.
 * @param {object} site - The site object
 * @returns {Promise<object>} The audit result
 */
export async function auditStatusRunner(auditUrl, context, site) {
  const { log } = context;
  const siteId = site.getId();

  log.info('auditStatusRunner called with:', { auditUrl, siteId, auditType });
  log.info('Context keys:', Object.keys(context));
  log.info('Message keys:', Object.keys(context.message || {}));

  try {
    // Log the status processing message
    log.info(`Processing audit status for site ${siteId} with audit type ${auditType}`);

    // Get the audit context from the message
    const { auditStatusJob } = context;
    log.info('Audit status job:', JSON.stringify(auditStatusJob, null, 2));

    // Create and send the status message
    const { text, blocks } = createAuditStatusMessage(
      siteId,
      context.organizationId,
      context.siteUrl,
      'Processing',
    );

    await sendSlackMessage(
      context,
      context.slackContext,
      text,
      blocks,
    );

    return {
      fullAuditRef: context.siteUrl,
      auditResult: {
        status: 'processing',
        siteId,
        organizationId: context.organizationId,
        experienceUrl: context.siteUrl,
        success: true,
      },
    };
  } catch (error) {
    log.error('Error in auditStatusRunner:', error);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        status: 'error',
        siteId,
        error: `Audit status processing failed for ${siteId}: ${error.message}`,
        success: false,
      },
    };
  }
}

/**
 * Runs the audit and processes the status
 * @param {object} context - The context object.
 * @returns {Promise<object>} The audit result
 */
export async function runAuditStatus(context) {
  const { log } = context;
  log.info('runAuditStatus called with context keys:', Object.keys(context));

  const { site, siteUrl } = context;
  const result = await auditStatusRunner(siteUrl, context, site);

  log.info('runAuditStatus completed with result:', result);
  return {
    siteId: site.getId(),
    auditResult: result.auditResult,
    fullAuditRef: result.fullAuditRef,
  };
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('run-audit-status', runAuditStatus)
  .build();
