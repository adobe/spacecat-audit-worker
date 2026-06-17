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

import { resolveRumDomainKey } from '@adobe/spacecat-shared-rum-api-client';
import { ok, internalServerError } from '@adobe/spacecat-shared-http-utils';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';

const STALENESS_DAYS = 7;
const STALENESS_MS = STALENESS_DAYS * 24 * 60 * 60 * 1000;

/**
 * Periodic refresh handler for site RUM domain key availability.
 * Skips sites whose rumConfig was checked within the last 7 days.
 * Re-runs the domain key check for stale sites and persists the result.
 *
 * Triggered by an external orchestration service sending an SQS message:
 *   { type: 'rum-config-refresh', siteId: '<uuid>' }
 */
export default async function rumConfigRefresh(message, context) {
  const { log } = context;
  const { siteId } = message;

  if (!siteId) {
    log.error('[rum-config-refresh] Missing siteId in message payload');
    return ok({ skipped: true, reason: 'missing siteId' });
  }

  const { Site } = context.dataAccess;
  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`[rum-config-refresh] Site not found: ${siteId}`);
    return ok({ skipped: true, reason: 'site not found' });
  }

  const siteConfig = site.getConfig();
  const rumConfig = siteConfig.getRumConfig();
  if (rumConfig?.lastCheckedAt) {
    const age = Date.now() - new Date(rumConfig.lastCheckedAt).getTime();
    if (age < STALENESS_MS) {
      log.info(`[rum-config-refresh] Skipping site ${siteId}: checked ${Math.floor(age / 86400000)}d ago`);
      return ok({ skipped: true, reason: 'recently checked' });
    }
  }

  const { hasDomainKey, timedOut } = await resolveRumDomainKey(site, context);

  if (timedOut) {
    return ok({ skipped: true, reason: 'timeout' });
  }

  try {
    siteConfig.updateRumConfig(hasDomainKey);
    site.setConfig(Config.toDynamoItem(siteConfig));
    await site.save();
    log.info(`[rum-config-refresh] Updated rumConfig for site ${siteId}: hasDomainKey=${hasDomainKey}`);
    return ok({ hasDomainKey, updated: true });
  } catch (e) {
    log.error(`[rum-config-refresh] Failed to save rumConfig for site ${siteId}: ${e.message}`);
    return internalServerError(`Failed to save rumConfig: ${e.message}`);
  }
}
