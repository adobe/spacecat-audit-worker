/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { ok } from '@adobe/spacecat-shared-http-utils';

/**
 * Handles DRS prompt generation job completion notifications.
 * When a prompt_generation_base_url job completes in the Data Retrieval Service,
 * the SNS notification is routed to the audit-jobs SQS queue and dispatched here.
 *
 * Only triggers llmo-customer-analysis when the job was submitted during onboarding
 * (source === 'onboarding'). Manually triggered DRS jobs are ignored.
 *
 * On JOB_COMPLETED from onboarding: triggers llmo-customer-analysis audit for the site.
 * On JOB_FAILED: logs the failure (prompts can be generated manually later).
 *
 * LLMO-1819: https://jira.corp.adobe.com/browse/LLMO-1819
 *
 * @param {object} message - Normalized SQS message with DRS notification data
 * @param {object} context - Universal context
 * @returns {Response}
 */
export default async function drsPromptGenerationHandler(message, context) {
  const { log, sqs, dataAccess } = context;
  const { siteId, auditContext = {} } = message;
  const {
    drsEventType, drsJobId, resultLocation, source,
  } = auditContext;

  if (!siteId) {
    log.error('DRS prompt generation notification missing site_id in metadata');
    return ok();
  }

  if (drsEventType === 'JOB_FAILED') {
    log.error(`DRS prompt generation job ${drsJobId} failed for site ${siteId}. Prompts can be generated manually via DRS dashboard.`);
    return ok();
  }

  if (drsEventType !== 'JOB_COMPLETED') {
    log.warn(`Unexpected DRS event type: ${drsEventType} for site ${siteId}`);
    return ok();
  }

  log.info(`DRS prompt generation completed for site ${siteId}, job ${drsJobId}, result: ${resultLocation}`);

  if (source !== 'onboarding') {
    log.info(`DRS job ${drsJobId} was not triggered by onboarding (source: ${source}), skipping llmo-customer-analysis trigger`);
    return ok();
  }

  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();

  await sqs.sendMessage(configuration.getQueues().audits, {
    type: 'llmo-customer-analysis',
    siteId,
    auditContext: {
      drsJobId,
      resultLocation,
    },
  });

  log.info(`Triggered llmo-customer-analysis for site ${siteId} after DRS prompt generation job ${drsJobId}`);
  return ok();
}
