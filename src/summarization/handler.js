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

const { AUDIT_STEP_DESTINATIONS } = Audit;
const SCRAPE_AVAILABILITY_THRESHOLD = 0.5; // 50%
const MAX_TOP_PAGES = 200;
const MAX_PAGES_TO_MYSTIQUE = 100;

/**
 * Step 1: Import top pages from Ahrefs
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
  const { SiteTopPage } = dataAccess;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    log.warn('[SUMMARIZATION] Audit failed, skipping scraping');
    throw new Error('Audit failed, skipping scraping');
  }

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  if (topPages.length === 0) {
    log.warn('[SUMMARIZATION] No top pages to submit for scraping');
    throw new Error('No top pages to submit for scraping');
  }
  const topPagesToScrape = topPages.slice(0, MAX_TOP_PAGES);

  log.info(`[SUMMARIZATION] Submitting ${topPagesToScrape.length} pages for scraping`);

  return {
    urls: topPagesToScrape.map((topPage) => ({ url: topPage.getUrl() })),
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
  const { SiteTopPage } = dataAccess;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    log.warn('[SUMMARIZATION] Audit failed, skipping Mystique message');
    throw new Error('Audit failed, skipping Mystique message');
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('[SUMMARIZATION] SQS or Mystique queue not configured, skipping message');
    throw new Error('SQS or Mystique queue not configured');
  }

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  if (topPages.length === 0) {
    log.warn('[SUMMARIZATION] No top pages found, skipping Mystique message');
    throw new Error('No top pages found');
  }
  const topPagesScraped = topPages.slice(0, MAX_TOP_PAGES);

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
