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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { ok, internalServerError } from '@adobe/spacecat-shared-http-utils';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';

const STALENESS_DAYS = 7;
const STALENESS_MS = STALENESS_DAYS * 24 * 60 * 60 * 1000;
const RUM_CHECK_TIMEOUT_MS = 3000;

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

  const overrideBaseURL = siteConfig.getFetchConfig()?.overrideBaseURL;
  let overrideHostname = null;
  if (overrideBaseURL) {
    try {
      overrideHostname = new URL(overrideBaseURL).hostname;
    } catch {
      log.warn(`[rum-config-refresh] Malformed overrideBaseURL for site ${siteId}: ${overrideBaseURL}, falling back to baseURL`);
    }
  }

  let baseHostname;
  try {
    baseHostname = new URL(site.getBaseURL()).hostname;
  } catch {
    log.error(`[rum-config-refresh] Malformed baseURL for site ${siteId}: ${site.getBaseURL()}, skipping`);
    return ok({ skipped: true, reason: 'malformed baseURL' });
  }

  // override-first: overrideBaseURL is the site's canonical RUM domain when set
  const domains = [...new Set([overrideHostname, baseHostname].filter(Boolean))];

  let hasDomainKey = false;
  let timeoutId;
  let timedOut = false;
  let cancelled = false;

  const rumApiClient = RUMAPIClient.createFrom(context);

  // RUM_CHECK_TIMEOUT_MS is a shared budget for the full candidate loop,
  // not a per-domain limit, so total RUM check time stays bounded.
  try {
    await Promise.race([
      (async () => {
        for (const domain of domains) {
          if (cancelled) {
            break;
          }
          try {
            // eslint-disable-next-line no-await-in-loop
            await rumApiClient.retrieveDomainkey(domain);
            hasDomainKey = true;
            return;
          } catch (e) {
            log.info(`[rum-config-refresh] RUM check failed for ${domain}: ${e.message}`);
          }
        }
      })(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          cancelled = true;
          reject(new Error('RUM check timed out'));
        }, RUM_CHECK_TIMEOUT_MS);
      }),
    ]);
    if (!hasDomainKey) {
      log.warn(`[rum-config-refresh] No domain key found for site ${siteId} across all candidates: ${domains.join(', ')}`);
    }
  } catch (e) {
    if (timedOut) {
      log.error(`[rum-config-refresh] RUM check timed out for ${domains.join(', ')}, skipping config update`);
      return ok({ skipped: true, reason: 'timeout' });
    /* c8 ignore next 3 */
    } else {
      log.warn(`[rum-config-refresh] Unexpected error during RUM check for site ${siteId}: ${e.message}`);
    }
  } finally {
    clearTimeout(timeoutId);
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
