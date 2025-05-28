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
import { BaseSlackClient, SLACK_TARGETS } from '@adobe/spacecat-shared-slack-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { sendSlackMessage } from '../support/slack-utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_TYPE = Audit.AUDIT_TYPES.AUDIT_STATUS_PROCESSOR;

/** Prepare demo url for the site */
function prepareDemoUrl(experienceUrl, organizationId, siteId) {
  return `${experienceUrl}?organizationId=${organizationId}#/@aemrefdemoshared/sites-optimizer/sites/${siteId}/home`;
}

/**
 * Runs the audit status processor
 * @param {object} auditStatusMessage - The auditStatusMessage object
 * @param {object} context - The context object
 * @returns {Promise<object>} The audit result
 */
export async function runAuditStatusProcessor(auditStatusMessage, context) {
  const { log, env } = context;
  log.info('Running audit status processor');
  const { siteId, auditContext } = auditStatusMessage;
  const {
    experienceUrl: siteUrl, organizationId, auditTypes, slackContext,
  } = auditContext;
  try {
    log.info('Processing audit status for site:', {
      siteId,
      siteUrl,
      organizationId,
      auditType: AUDIT_TYPE,
      auditTypes,
    });

    // Create Slack client
    const slackClientContext = {
      channelId: slackContext.channelId,
      threadTs: slackContext.threadTs,
      env: {
        SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
        SLACK_SIGNING_SECRET: env.SLACK_SIGNING_SECRET,
        SLACK_TOKEN_WORKSPACE_INTERNAL: env.SLACK_TOKEN_WORKSPACE_INTERNAL,
        SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL: env.SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL,
      },
    };
    const slackTarget = SLACK_TARGETS.WORKSPACE_INTERNAL;
    const slackClient = BaseSlackClient.createFrom(slackClientContext, slackTarget);

    log.info('Audit status processor completed');
    await sendSlackMessage(slackClient, slackContext, 'Audit status processor completed');
    // prepare demo url
    const demoUrl = prepareDemoUrl(siteUrl, organizationId, siteId);
    log.info(`Demo url is ready ${demoUrl}`);
    await sendSlackMessage(slackClient, slackContext, `:tada: Demo url: ${demoUrl}`);

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
  .addStep('run-audit-status', runAuditStatusProcessor, AUDIT_STEP_DESTINATIONS.AUDIT_WORKER)
  .build();
