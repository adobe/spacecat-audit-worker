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

import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { getMergedAuditInputUrls, sortTopPagesByTraffic } from '../utils/audit-input-urls.js';
import { getTopAgenticUrlsFromAthena } from '../utils/agentic-urls.js';
import { AUDIT_TYPE, GUIDANCE_TYPE } from './constants.js';

const MAX_TOP_PAGES = 50;
const FETCH_CONCURRENCY = 10;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

// Pre-filter helper: checks whether a URL's raw HTML contains an <img> tag.
// Guards: 10s timeout, HTTP error skip, 5MB response size cap.
async function fetchAndCheck(url, log) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      log.warn(`[semantic-value-visibility] ${url} returned HTTP ${response.status}, skipping`);
      return null;
    }
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_RESPONSE_BYTES) {
      log.warn(`[semantic-value-visibility] ${url} response too large (${contentLength} bytes), skipping`);
      return null;
    }
    const html = await response.text();
    return /<img/i.test(html) ? url : null;
  } catch (err) {
    log.warn(`[semantic-value-visibility] Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

export async function auditRunner(auditUrl, context, site) {
  const { log, dataAccess } = context;
  const siteId = site.getId();

  const result = await getMergedAuditInputUrls({
    site,
    dataAccess,
    auditType: AUDIT_TYPE,
    getAgenticUrls: () => getTopAgenticUrlsFromAthena(site, context, MAX_TOP_PAGES),
    getTopPages: async () => {
      if (!dataAccess?.SiteTopPage?.allBySiteIdAndSourceAndGeo) {
        log.warn('[semantic-value-visibility] SiteTopPage accessor unavailable, falling back to agentic URLs only');
        return [];
      }
      const topPages = await dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo(
        siteId,
        'seo',
        'global',
      );
      return sortTopPagesByTraffic(topPages || []);
    },
    topOrganicLimit: MAX_TOP_PAGES,
  });

  log.info(
    `[semantic-value-visibility] URL inputs: agentic=${result.agenticUrls.length}, `
    + `topPages=${result.topPagesUrls.length}, includedURLs=${result.includedURLs.length}, `
    + `filtered=${result.filteredCount}, final=${result.urls.length}`,
  );

  // Pre-filter: only dispatch pages that contain at least one <img> tag.
  // Uses a plain HTTP GET so we can check raw HTML without a full browser — this works for
  // server-rendered pages and catches the vast majority of cases. JS-rendered images are
  // handled downstream by Mystique's Playwright scraper.
  // Processed in batches of FETCH_CONCURRENCY to avoid overwhelming the target origin.
  const fetchResults = [];
  for (let i = 0; i < result.urls.length; i += FETCH_CONCURRENCY) {
    const batch = result.urls.slice(i, i + FETCH_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(batch.map((url) => fetchAndCheck(url, log)));
    fetchResults.push(...batchResults);
  }
  const qualifyingUrls = fetchResults.filter(Boolean);

  log.info(`[semantic-value-visibility] ${qualifyingUrls.length}/${result.urls.length} URLs qualify (contain <img> tags)`);

  return {
    auditResult: { siteId, urls: qualifyingUrls, status: 'pending-mystique' },
    fullAuditRef: auditUrl,
  };
}

export async function sendToMystique(auditUrl, auditData, context, site) {
  const { log, sqs, env } = context;
  const siteId = site.getId();
  const auditId = auditData.id;
  const urls = auditData.auditResult?.urls || [];

  if (urls.length === 0) {
    log.warn('[semantic-value-visibility] No qualifying URLs to send to Mystique');
    return auditData;
  }

  const results = await Promise.allSettled(urls.map((url) => sqs.sendMessage(
    env.QUEUE_SPACECAT_TO_MYSTIQUE,
    {
      type: GUIDANCE_TYPE,
      siteId,
      auditId,
      url,
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: { url },
    },
  )));

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    failed.forEach((r) => log.error(`[semantic-value-visibility] Failed to send SQS message: ${r.reason}`));
  }

  const sent = results.length - failed.length;
  log.info(`[semantic-value-visibility] Sent ${sent}/${urls.length} requests to Mystique`);
  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .withPostProcessors([sendToMystique])
  .build();
