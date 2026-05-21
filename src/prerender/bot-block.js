/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { detectBotBlocker } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';

const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const DOMAIN_STICKY_BOT_SKIP_MS = 3 * 24 * 60 * 60 * 1000;
const STICKY_BOT_FORBIDDEN_RATIO = 0.5;
const KNOWN_BOT_BLOCKER_TYPES = ['cloudflare', 'imperva', 'akamai', 'fastly', 'cloudfront'];
const LOG_PREFIX = 'Prerender -';

function isKnownBotBlockerResult({ crawlable, confidence, type }) {
  return !crawlable
    && confidence >= 0.99
    && KNOWN_BOT_BLOCKER_TYPES.includes(type);
}

/**
 * Returns true if the mode allows sticky bot-block and status.json records a confirmed
 * bot-block within the 3-day window. CSV and Slack modes bypass so operators can force
 * a re-scrape.
 * @param {{ isCsv: boolean, isSlack: boolean }} mode
 * @param {{ scrapeForbidden: boolean, scrapeForbiddenSince: string }} status
 * @returns {boolean}
 */
export function isStickyBotBlocked(mode, status) {
  if (mode.isCsv || mode.isSlack) {
    return false;
  }
  if (!status.scrapeForbidden || !status.scrapeForbiddenSince) {
    return false;
  }
  const sinceMs = Date.parse(status.scrapeForbiddenSince);
  if (Number.isNaN(sinceMs)) {
    return false;
  }
  return (Date.now() - sinceMs) < DOMAIN_STICKY_BOT_SKIP_MS;
}

/**
 * Logs the sticky bot-block skip and returns the step-2 result that signals domainBlocked.
 * @param {Object} context - Handler context (site, log)
 * @param {{ scrapeForbiddenSince: string }} status
 * @returns {Object}
 */
export function buildBotBlockedResult(context, status) {
  const { site, log } = context;
  const siteId = site.getId();
  log.info(`${LOG_PREFIX} Sticky scrapeForbidden within 3d window, skipping. baseUrl=${site.getBaseURL()}, siteId=${siteId}, blockedSince=${status.scrapeForbiddenSince}`);
  return {
    urls: [],
    siteId,
    processingType: AUDIT_TYPE,
    maxScrapeAge: 0,
    options: { pageLoadTimeout: 20000, storagePrefix: AUDIT_TYPE },
    auditContext: { domainBlocked: true },
  };
}

/**
 * Reactive post-scrape bot-block detection.
 * When the 403 ratio meets the threshold, probes the CDN to confirm the block.
 *
 * @param {Object} context - Handler context (log + site)
 * @param {{ isDomainBlocked: boolean, urlsSubmittedForScraping: number,
 *   scrapeForbiddenCount: number }} stats
 * @returns {Promise<{ scrapeForbidden: boolean, scrapeForbiddenSince?: string }>}
 */
export async function detectBotBlock(context, stats) {
  const { log, site } = context;
  const siteId = site.getId();
  const { isDomainBlocked, urlsSubmittedForScraping, scrapeForbiddenCount } = stats;

  let scrapeForbidden = isDomainBlocked;
  let scrapeForbiddenSince;

  if (!isDomainBlocked && urlsSubmittedForScraping > 0) {
    const ratio403 = scrapeForbiddenCount / urlsSubmittedForScraping;
    if (ratio403 >= STICKY_BOT_FORBIDDEN_RATIO) {
      try {
        const botBlocker = await detectBotBlocker({ baseUrl: site.getBaseURL(), log });
        if (isKnownBotBlockerResult(botBlocker)) {
          scrapeForbidden = true;
          scrapeForbiddenSince = new Date().toISOString();
        }
      } catch (e) {
        log.warn(`${LOG_PREFIX} detectBotBlocker failed after high 403 ratio: ${e.message}. baseUrl=${site.getBaseURL()}`);
      }
      log.info(`${LOG_PREFIX} Bot-block detection result: ratio403=${ratio403}, scrapeForbidden=${scrapeForbidden}, scrapeForbiddenSince=${scrapeForbiddenSince ?? 'n/a'}. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);
    }
  }

  return { scrapeForbidden, scrapeForbiddenSince };
}
