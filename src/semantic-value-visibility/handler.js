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

export async function auditRunner(auditUrl, context, site) {
  const { log, dataAccess } = context;
  const siteId = site.getId();

  const result = await getMergedAuditInputUrls({
    site,
    dataAccess,
    auditType: AUDIT_TYPE,
    getAgenticUrls: () => getTopAgenticUrlsFromAthena(site, context, MAX_TOP_PAGES),
    getTopPages: async () => {
      const topPages = await dataAccess?.SiteTopPage?.allBySiteIdAndSourceAndGeo?.(
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
  const fetchResults = await Promise.all(result.urls.map(async (url) => {
    try {
      const response = await fetch(url);
      const html = await response.text();
      return /<img/i.test(html) ? url : null;
    } catch (err) {
      log.warn(`[semantic-value-visibility] Failed to fetch ${url}: ${err.message}`);
      return null;
    }
  }));
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

  await Promise.all(urls.map((url) => sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, {
    type: GUIDANCE_TYPE,
    siteId,
    auditId,
    url,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: { url },
  })));

  log.info(`[semantic-value-visibility] Sent ${urls.length} requests to Mystique`);
  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .withPostProcessors([sendToMystique])
  .build();
