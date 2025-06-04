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

import { Site } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { sendSlackMessage } from '../support/slack-utils.js';

const AUDIT_TYPE = 'disable-import-audit-processor';

/**
 * Runs the disable import and audit processor
 * @param {object} message - The message object containing siteId and auditContext
 * @param {object} context - The context object
 * @returns {Promise<object>} The result
 */
export async function runDisableImportAuditProcessor(message, context) {
  const { log, env, dataAccess } = context;
  const { siteId, siteUrl, auditContext } = message;
  const { Configuration } = dataAccess;
  const {
    organizationId, importTypes = [], auditTypes = [], slackContext,
  } = auditContext;

  log.info('Processing disable import and audit request:', {
    auditType: AUDIT_TYPE,
    siteId,
    organizationId,
    importTypes,
    auditTypes,
  });
  await sendSlackMessage(env, log, slackContext, ':broom: Disabling imports and audits...');
  try {
    // Database operations
    log.info('Starting database operations');
    const site = await Site.findByBaseURL(siteUrl);
    if (!site) {
      throw new Error(`Site not found for siteId: ${siteId}`);
    }
    const siteConfig = site.getConfig();
    for (const importType of importTypes) {
      log.info(`:broom: Disabling import type: ${importType}`);
      siteConfig.disableImport(importType);
    }
    log.info('Import types disabled');

    const configuration = await Configuration.findLatest();
    for (const auditType of auditTypes) {
      log.info(`:broom: Disabling audit type: ${auditType}`);
      configuration.disableHandlerForSite(auditType, site);
    }
    log.info('Audit types disabled');

    await site.save();
    await configuration.save();
    log.info('Database changes saved successfully');

    const slackMessage = `:check_mark: Disabled imports ${JSON.stringify(importTypes)} and audits ${JSON.stringify(auditTypes)} for site ${siteId}`;
    await sendSlackMessage(env, log, slackContext, slackMessage);

    return {
      siteId,
      result: {
        status: 'Completed',
        siteId,
        organizationId,
        disabledImports: importTypes,
        disabledAudits: auditTypes,
        success: true,
      },
    };
  } catch (error) {
    log.error('Error in disable import and audit processor:', {
      error: error.message,
      stack: error.stack,
      errorType: error.name,
    });

    return {
      siteId,
      result: {
        status: 'error',
        siteId,
        error: `Disable import and audit processing failed for ${siteId}: ${error.message}`,
        success: false,
      },
    };
  }
}

// Export the built handler for use with AuditBuilder
export default new AuditBuilder()
  .withRunner(runDisableImportAuditProcessor)
  .withUrlResolver((site) => site.getBaseURL())
  .build();
