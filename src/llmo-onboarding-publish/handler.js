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

import { badRequest, ok } from '@adobe/spacecat-shared-http-utils';
import { publishToAdminHlx } from '../utils/report-uploader.js';

const LLMO_CUSTOMER_ANALYSIS_AUDIT = 'llmo-customer-analysis';
const LLMO_ONBOARDING_PUBLISH_FILENAME = 'query-index';

function getLlmoDataFolder(site) {
  return site?.getConfig?.()?.getLlmoDataFolder?.() || null;
}

export default async function handler(message, context) {
  const { log, dataAccess, sqs } = context;
  const { siteId, auditContext = {} } = message;
  const { dataFolder, onboardingRunId, triggerSource = 'llmo-onboard' } = auditContext;

  if (!siteId || !dataFolder) {
    log.error('[LLMO Onboarding Publish] Missing required fields', { siteId, dataFolder });
    return badRequest('Missing required fields: siteId and auditContext.dataFolder');
  }

  const { Site, Configuration } = dataAccess;
  const site = await Site.findById(siteId);

  if (!site) {
    log.warn(`[LLMO Onboarding Publish] Site not found. Skipping publish for site ${siteId}`);
    return ok({ skipped: true, reason: 'site-not-found' });
  }

  const currentDataFolder = getLlmoDataFolder(site);
  if (!currentDataFolder) {
    log.warn(`[LLMO Onboarding Publish] Site ${siteId} has no LLMO data folder. Skipping.`);
    return ok({ skipped: true, reason: 'missing-llmo-config' });
  }
  if (currentDataFolder !== dataFolder) {
    log.warn(
      `[LLMO Onboarding Publish] Stale message for site ${siteId}.`,
      { messageDataFolder: dataFolder, currentDataFolder },
    );
    return ok({ skipped: true, reason: 'stale-message' });
  }

  // publishToAdminHlx already swallows/logs Helix errors by design.
  await publishToAdminHlx(LLMO_ONBOARDING_PUBLISH_FILENAME, dataFolder, log);

  const configuration = await Configuration.findLatest();
  const followUpAuditContext = {
    triggerSource,
    dataFolder,
    ...(onboardingRunId ? { onboardingRunId } : {}),
  };
  await sqs.sendMessage(configuration.getQueues().audits, {
    type: LLMO_CUSTOMER_ANALYSIS_AUDIT,
    siteId,
    auditContext: followUpAuditContext,
  });

  log.info(`[LLMO Onboarding Publish] Triggered ${LLMO_CUSTOMER_ANALYSIS_AUDIT} for site ${siteId}`);
  return ok({ queued: true });
}
