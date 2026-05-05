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
import writeDrsPromptsToLlmoConfig from './drs-config-writer.js';
import { postMessageSafe } from '../utils/slack-utils.js';
import { isBrandalfOrMigrationEnabled } from '../utils/feature-flags.js';

const RUNBOOK_URL = 'https://github.com/adobe/spacecat-audit-worker/blob/main/docs/runbooks/resubmit-drs-prompt-generation.md';

/**
 * Resolves whether the org behind a site is under brandalf or brandalf_migration.
 * When either flag is on, v1 LLMO config writes (and the llmo-customer-analysis
 * fan-out that follows) must be skipped — the v1 config bucket is read-only for
 * those orgs (LLMO-4587 / LLMO-4743).
 *
 * Fail-open: any lookup or API failure returns false so non-brandalf orgs keep
 * working. Matches the fail-open posture of isBrandalfOrMigrationEnabled.
 */
async function isV1WriteBlockedByBrandalf(siteId, dataAccess, env, log) {
  try {
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    const orgId = site?.getOrganizationId?.();
    if (!orgId) {
      log.warn(`Cannot determine brandalf flag for site ${siteId}: no organization`);
      return false;
    }
    return await isBrandalfOrMigrationEnabled(orgId, env, log);
  } catch (error) {
    log.warn(`Error resolving brandalf flag for site ${siteId}: ${error.message}`);
    return false;
  }
}

/**
 * Sends a Slack alert to the LLMO onboarding channel when prompt generation fails.
 */
async function alertPromptGenerationFailure(context, siteId, drsJobId, reason) {
  const channelId = context.env?.SLACK_CHANNEL_LLMO_ONBOARDING_ID;
  if (!channelId) {
    return;
  }

  await postMessageSafe(context, channelId, '', {
    attachments: [{
      color: '#CB3837',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'AI Prompt Generation Failed',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Site ID:*\n\`${siteId}\`` },
            { type: 'mrkdwn', text: `*DRS Job:*\n\`${drsJobId || 'N/A'}\`` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Reason:* ${reason}`,
          },
        },
        {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `<${RUNBOOK_URL}|Runbook: Resubmit DRS Prompt Generation>`,
          }],
        },
        { type: 'divider' },
      ],
    }],
  });
}

/**
 * Downloads DRS result and writes prompts to the LLMO config as aiTopics.
 * Non-fatal — returns a result object so the handler can continue even on failure.
 *
 * @param {string} resultLocation - Presigned URL to the DRS result JSON
 * @param {string} jobId - DRS job ID
 * @param {string} siteId - Site identifier
 * @param {object} context - Universal context (env, s3Client, log)
 * @returns {Promise<{success: boolean, configVersion?: string}>}
 */
async function processDrsResult(resultLocation, jobId, siteId, context) {
  const { env, s3Client, log } = context;

  try {
    log.info(`Downloading DRS result from presigned URL for job ${jobId}`);
    const response = await fetch(resultLocation);

    if (!response.ok) {
      throw new Error(`Failed to download DRS result: ${response.status} ${response.statusText}`);
    }

    const drsResult = await response.json();
    const prompts = drsResult.prompts || drsResult;
    const drsPrompts = Array.isArray(prompts) ? prompts : [];

    if (drsPrompts.length === 0) {
      log.warn(`DRS job ${jobId} returned no prompts for site ${siteId}`);
      return { success: false };
    }

    const bucket = env.S3_IMPORTER_BUCKET_NAME;
    const writeResult = await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId, s3Client, s3Bucket: bucket, log,
    });

    log.info(`Wrote ${drsPrompts.length} DRS prompts to LLMO config for site ${siteId}`);
    return { success: true, configVersion: writeResult?.version };
  } catch (error) {
    log.error(`DRS result processing failed for job ${jobId}, site ${siteId}: ${error.message}`);
    return { success: false };
  }
}

function resolveOnboardingMode(auditContext = {}) {
  return auditContext.onboardingMode || auditContext.onboarding_mode || null;
}

/**
 * Handles DRS prompt generation job completion notifications.
 * When a prompt_generation_base_url job completes in the Data Retrieval Service,
 * the SNS notification is routed to the audit-jobs SQS queue and dispatched here.
 *
 * On JOB_COMPLETED: downloads DRS result, writes prompts to LLMO config as aiTopics.
 * On JOB_COMPLETED + source=onboarding: additionally triggers llmo-customer-analysis.
 * On JOB_FAILED: logs the failure and sends a Slack alert.
 *
 * Processing is non-fatal — if the download or config write fails, the handler
 * still triggers the downstream audit.
 *
 * LLMO-1819: https://jira.corp.adobe.com/browse/LLMO-1819
 *
 * @param {object} message - Normalized SQS message with DRS notification data
 * @param {object} context - Universal context
 * @returns {Response}
 */
export default async function drsPromptGenerationHandler(message, context) {
  const {
    log, sqs, dataAccess, env,
  } = context;
  const { siteId, auditContext = {} } = message;
  const {
    drsEventType, drsJobId, resultLocation, source,
  } = auditContext;
  const onboardingMode = resolveOnboardingMode(auditContext);

  if (!siteId) {
    log.error('DRS prompt generation notification missing site_id in metadata');
    return ok();
  }

  if (drsEventType === 'JOB_FAILED') {
    log.error(`DRS prompt generation job ${drsJobId} failed for site ${siteId}. Prompts can be generated manually via DRS dashboard.`);
    await alertPromptGenerationFailure(context, siteId, drsJobId, 'DRS job failed');
    return ok();
  }

  if (drsEventType !== 'JOB_COMPLETED') {
    log.warn(`Unexpected DRS event type: ${drsEventType} for site ${siteId}`);
    return ok();
  }

  log.info(`DRS prompt generation completed for site ${siteId}, job ${drsJobId}, result: ${resultLocation}`);

  // Single org lookup: drives both the v1 write gate and the fan-out gate.
  // Under brandalf / brandalf_migration the v1 config bucket is read-only and
  // the llmo-customer-analysis fan-out is owned by the brandalf-migration path.
  const brandalfBlocksV1 = await isV1WriteBlockedByBrandalf(siteId, dataAccess, env, log);

  let configVersion;
  const shouldWriteLegacyConfig = !brandalfBlocksV1
    && (source !== 'onboarding' || onboardingMode !== 'v2');

  if (shouldWriteLegacyConfig) {
    // Download DRS result and write prompts to LLMO config (non-fatal)
    const drsResult = await processDrsResult(resultLocation, drsJobId, siteId, context);
    const { success } = drsResult;
    configVersion = drsResult.configVersion;

    if (!success) {
      await alertPromptGenerationFailure(
        context,
        siteId,
        drsJobId,
        'Failed to download or write prompts to LLMO config',
      );
    }
  } else if (brandalfBlocksV1) {
    log.info(`Skipping v1 LLMO config write for site ${siteId} because brandalf or brandalf_migration is enabled`);
  } else {
    log.info(`Skipping v1 LLMO config write for site ${siteId} because onboarding_mode is v2`);
  }

  if (brandalfBlocksV1) {
    log.info(`Skipping llmo-customer-analysis trigger for site ${siteId} because brandalf or brandalf_migration is enabled`);
    return ok();
  }

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
      ...(configVersion && { configVersion }),
      ...(onboardingMode && { onboardingMode }),
      ...(auditContext.imsOrgId && { imsOrgId: auditContext.imsOrgId }),
    },
  });

  log.info(`Triggered llmo-customer-analysis for site ${siteId} after DRS prompt generation job ${drsJobId}`);
  return ok();
}
