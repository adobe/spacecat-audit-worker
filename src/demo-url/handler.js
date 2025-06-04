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

import { AuditBuilder } from '../common/audit-builder.js';
import { sendSlackMessage } from '../support/slack-utils.js';

/** Prepare demo url for the site */
function prepareDemoUrl(experienceUrl, organizationId, siteId) {
  return `${experienceUrl}?organizationId=${organizationId}#/@aemrefdemoshared/sites-optimizer/sites/${siteId}/home`;
}

/**
 * Runs the audit status processor
 * @param {object} demoUrlMessage - The demoUrlMessage object
 * @param {object} context - The context object
 * @returns {Promise<object>} The audit result
 */
export async function runDemoUrlProcessor(demoUrlMessage, context) {
  const { log, env } = context;
  log.info('Running demo url processor');
  const { siteId, demoUrlContext } = demoUrlMessage;
  const {
    experienceUrl: siteUrl, organizationId, slackContext,
  } = demoUrlContext;

  log.info('Processing demo url for site:', {
    siteId,
    siteUrl,
    organizationId,
  });

  await sendSlackMessage(env, log, slackContext, 'Preparing demo url');
  try {
    // prepare demo url
    const demoUrl = prepareDemoUrl(siteUrl, organizationId, siteId);
    log.info(`Setup complete! Access your demo environment here: ${demoUrl}`);
    const slackMessage = `:white_check_mark: Setup complete! Access your demo environment here: ${demoUrl}`;
    await sendSlackMessage(env, log, slackContext, slackMessage);
    return {
      siteId,
      demoUrlResult: {
        status: 'Completed',
        siteId,
        organizationId,
        experienceUrl: siteUrl,
        success: true,
      },
      fullAuditRef: siteUrl,
    };
  } catch (error) {
    log.error('Error in preparing demo url:', {
      error: error.message,
      stack: error.stack,
      errorType: error.name,
    });

    return {
      siteId,
      demoUrlResult: {
        status: 'error',
        siteId,
        error: `Preparing demo url failed for ${siteId}: ${error.message}`,
        success: false,
      },
      fullAuditRef: siteUrl,
    };
  }
}

// Export the built handler for use with AuditBuilder
export default new AuditBuilder()
  .withRunner(runDemoUrlProcessor)
  .withUrlResolver((site) => site.getBaseURL())
  .build();
