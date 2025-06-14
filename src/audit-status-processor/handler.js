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

const AUDIT_TYPE = 'audit-status-processor';

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
    organizationId, auditTypes, slackContext,
  } = auditContext;

  log.info('Processing audit status for site:', {
    siteId,
    organizationId,
    auditType: AUDIT_TYPE,
    auditTypes,
  });

  await sendSlackMessage(env, log, slackContext, 'Checking audit status');
  try {
    // Check latest audit status for each audit type in parallel
    const auditStatusPromises = auditTypes.map(async (auditType) => {
      const latestAudit = await Audit.getLatestAuditByAuditType(auditType);
      log.info(`Latest audit for site ${siteId} and audit type ${auditType}: ${JSON.stringify(latestAudit)}`);
      if (latestAudit) {
        const auditResult = latestAudit.getAuditResult();
        if (auditResult.success) {
          log.info(`Latest audit for site ${siteId} was successful for audit type ${auditType}`);
          const slackMessage = `:check_mark: Latest audit for site ${siteId} was successful for audit type ${auditType}`;
          return sendSlackMessage(env, log, slackContext, slackMessage);
        } else {
          log.warn(`Latest audit for site ${siteId} failed for audit type ${auditType}: ${auditResult.error || 'Unknown error'}`);
          const slackMessage = `:x: Latest audit for site ${siteId} failed for audit type ${auditType}: ${auditResult.error || 'Unknown error'}`;
          return sendSlackMessage(env, log, slackContext, slackMessage);
        }
      } else {
        log.info(`No previous ${auditType} audit found for site ${siteId}`);
        return null;
      }
    });
    await Promise.all(auditStatusPromises);
    log.info('Audit status checking completed');
    await sendSlackMessage(env, log, slackContext, 'Audit status checking completed');
  } catch (error) {
    log.error('Error in audit status checking:', {
      error: error.message,
      stack: error.stack,
      errorType: error.name,
    });
  }
}

// Export the built handler for use with AuditBuilder
export default new AuditBuilder()
  .withRunner(runAuditStatusProcessor)
  .withUrlResolver((site) => site.getBaseURL())
  .build();
