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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { getTopAgenticUrlsFromAthena } from '../utils/agentic-urls.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const SCRAPE_AVAILABILITY_THRESHOLD = 0.5; // 50%
// TEMP: hard-limit URLs for PR validation only; remove before prod merge.
const MAX_TOP_PAGES = 15;
// TEMP: hard-limit URLs for PR validation only; remove before prod merge.
const MAX_PAGES_TO_MYSTIQUE = 15;

/**
 * Step 1: Import top pages (Athena first, then Ahrefs fallback)
 */
export async function importTopPages(context) {
  const { site, dataAccess, log } = context;
  const { SiteTopPage } = dataAccess;

  try {
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

    if (topPages.length === 0) {
      log.warn('[SUMMARIZATION] No top pages found for site');
      return {
        type: 'top-pages',
        siteId: site.getId(),
        auditResult: {
          success: false,
          topPages: [],
        },
        fullAuditRef: site.getBaseURL(),
      };
    }

    log.info(`[SUMMARIZATION] Found ${topPages.length} top pages for site ${site.getId()}`);

    return {
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: {
        success: true,
        topPages: topPages.slice(0, MAX_TOP_PAGES).map((page) => page.getUrl()),
      },
      fullAuditRef: site.getBaseURL(),
    };
  } catch (error) {
    log.error(`[SUMMARIZATION] Failed to import top pages: ${error.message}`, error);
    return {
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: {
        success: false,
        error: error.message,
        topPages: [],
      },
      fullAuditRef: site.getBaseURL(),
    };
  }
}

/**
 * Step 2: Submit top pages for scraping
 */
export async function submitForScraping(context) {
  const {
    site, dataAccess, audit, log,
  } = context;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    log.warn('[SUMMARIZATION] Audit failed, skipping scraping');
    throw new Error('Audit failed, skipping scraping');
  }

  // Try to get top agentic URLs from Athena first
  let topPageUrls = await getTopAgenticUrlsFromAthena(site, context);

  // Fallback to Ahrefs if Athena returns no data
  if (!topPageUrls || topPageUrls.length === 0) {
    log.info('[SUMMARIZATION] No agentic URLs from Athena, falling back to Ahrefs');
    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    topPageUrls = topPages.map((page) => page.getUrl());
  }

  if (topPageUrls.length === 0) {
    log.warn('[SUMMARIZATION] No top pages to submit for scraping');
    throw new Error('No top pages to submit for scraping');
  }
  const topPagesToScrape = topPageUrls.slice(0, MAX_TOP_PAGES);

  log.info(`[SUMMARIZATION] Submitting ${topPagesToScrape.length} pages for scraping`);

  return {
    urls: topPagesToScrape.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'summarization',
  };
}

/**
 * Step 3: Send to Mystique for AI processing
 */
export async function sendToMystique(context) {
  const {
    site, audit, dataAccess, log, sqs, env, scrapeResultPaths,
  } = context;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    log.warn('[SUMMARIZATION] Audit failed, skipping Mystique message');
    throw new Error('Audit failed, skipping Mystique message');
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('[SUMMARIZATION] SQS or Mystique queue not configured, skipping message');
    throw new Error('SQS or Mystique queue not configured');
  }

  // Try to get top agentic URLs from Athena first
  let topPageUrls = await getTopAgenticUrlsFromAthena(site, context);

  // Fallback to Ahrefs if Athena returns no data
  if (!topPageUrls || topPageUrls.length === 0) {
    log.info('[SUMMARIZATION] No agentic URLs from Athena, falling back to Ahrefs');
    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    topPageUrls = topPages.map((page) => page.getUrl());
  }

  if (topPageUrls.length === 0) {
    log.warn('[SUMMARIZATION] No top pages found, skipping Mystique message');
    throw new Error('No top pages found');
  }
  const topPagesScraped = topPageUrls.slice(0, MAX_TOP_PAGES);

  // Verify scrape availability before sending to Mystique
  if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
    log.warn('[SUMMARIZATION] No scrape results available');
    throw new Error('No scrape results available');
  }

  const availableCount = scrapeResultPaths.size;
  const totalCount = topPagesScraped.length;
  const availabilityPercentage = availableCount / totalCount;

  log.info(
    `[SUMMARIZATION] Scrape availability: ${availableCount}/${totalCount} `
    + `(${(availabilityPercentage * 100).toFixed(1)}%)`,
  );

  if (availabilityPercentage < SCRAPE_AVAILABILITY_THRESHOLD) {
    throw new Error(
      `Insufficient scrape data: only ${availableCount}/${totalCount} URLs have scrape data available`,
    );
  }

  // Use URLs from scrapeResultPaths Map (these are the URLs that actually have scrape data)
  const scrapedUrls = Array.from(scrapeResultPaths.keys());
  const scrapedUrlsToSend = scrapedUrls.slice(0, MAX_PAGES_TO_MYSTIQUE);
  const topPagesPayload = scrapedUrlsToSend.map((url) => ({
    page_url: url,
    keyword: '',
    questions: [],
  }));

  const message = {
    type: 'guidance:summarization',
    siteId: site.getId(),
    url: site.getBaseURL(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: { pages: topPagesPayload },
  };

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info(`[SUMMARIZATION] Sent ${topPagesPayload.length} pages to Mystique for site ${site.getId()}`);

  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('send-to-mystique', sendToMystique)
  .build();
