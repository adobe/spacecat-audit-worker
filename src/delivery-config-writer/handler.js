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
import { hasText } from '@adobe/spacecat-shared-utils';

import detectCdn from '../detect-cdn/handler.js';
import identifyRedirects from '../identify-redirects/handler.js';

/**
 * delivery-config-writer handler.
 *
 * Runs CDN detection followed by redirect identification sequentially,
 * eliminating the race condition that occurs when both are queued concurrently
 * during site onboarding. Each step reads fresh site state from the DB, so
 * CDN changes persisted in step 1 are visible to step 2.
 *
 * Redirect identification requires Slack context (identifyRedirects posts
 * results to Slack) and AEM CS params (programId, environmentId). When either
 * is absent, only CDN detection runs.
 *
 * @param {Object} message - The SQS message payload.
 * @param {string} [message.siteId] - The site ID to update deliveryConfig on.
 * @param {string} [message.baseURL] - The URL to probe for CDN and redirects.
 * @param {string} [message.programId] - AEM Cloud Manager program ID (redirects only).
 * @param {string} [message.environmentId] - AEM Cloud Manager environment ID (redirects only).
 * @param {number} [message.minutes] - Splunk lookback window in minutes (redirects only).
 * @param {boolean} [message.updateRedirects] - Whether to persist the detected redirect mode.
 * @param {Object} [message.slackContext] - Slack context for posting results.
 * @param {Object} context - The Lambda context.
 * @returns {Promise<Response>}
 */
export default async function deliveryConfigWriter(message, context) {
  const { log } = context;
  const {
    siteId,
    baseURL,
    programId,
    environmentId,
    minutes,
    updateRedirects,
    slackContext = {},
  } = message || {};

  const { channelId, threadTs } = slackContext;
  const slackEnabled = hasText(channelId) && hasText(threadTs);

  // Step 1: CDN detection — always runs (supports both Slack and non-Slack modes)
  await detectCdn({ siteId, baseURL, slackContext }, context);
  log.info('[delivery-config-writer] CDN detection complete');

  // Step 2: Redirect identification — requires Slack context (identifyRedirects posts results
  // to Slack) and AEM CS params (programId + environmentId)
  if (slackEnabled && hasText(programId) && hasText(environmentId)) {
    await identifyRedirects({
      siteId,
      baseURL,
      programId,
      environmentId,
      minutes,
      updateRedirects,
      slackContext,
    }, context);
    log.info('[delivery-config-writer] Redirect identification complete');
  } else {
    log.info(
      `[delivery-config-writer] Skipping redirect identification${!slackEnabled ? ' (no Slack context)' : ' (missing programId or environmentId)'}`,
    );
  }

  return ok({ status: 'ok' });
}
