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
import { getMergedAuditInputUrls, sortTopPagesByTraffic } from '../utils/audit-input-urls.js';
import { detectExistingContent } from './existing-content-detector.js';
import { filterOutDynamicUrls } from './dynamic-content-filter.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_TYPE = 'summarization';
const AUDIT_CONTEXT_URLS_KEY = 'summarizationUrls';
const SCRAPE_AVAILABILITY_THRESHOLD = 0.5; // 50%
const MAX_TOP_PAGES = 200;
const MAX_PAGES_TO_MYSTIQUE = 100;

async function getSummarizationInputUrls(context) {
  const { site, dataAccess, log } = context;
  const result = await getMergedAuditInputUrls({
    site,
    dataAccess,
    auditType: AUDIT_TYPE,
    getAgenticUrls: () => getTopAgenticUrlsFromAthena(site, context, MAX_TOP_PAGES),
    getTopPages: async () => {
      const topPages = await dataAccess?.SiteTopPage?.allBySiteIdAndSourceAndGeo?.(
        site.getId(),
        'ahrefs',
        'global',
      );
      return sortTopPagesByTraffic(topPages || []);
    },
    topOrganicLimit: MAX_TOP_PAGES,
  });

  log.info(
    `[SUMMARIZATION] URL inputs: topPages=${result.topPagesUrls.length}, `
    + `agentic=${result.agenticUrls.length}, includedURLs=${result.includedURLs.length}, `
    + `filteredOutUrls=${result.filteredCount}, finalUrls=${result.urls.length}`,
  );

  return result;
}

/**
 * Step 1: Import Ahrefs top pages metadata for reporting.
 * Downstream URL selection may still proceed with included or agentic URLs when Ahrefs is empty.
 */
/* c8 ignore next 1 - function declaration line often not attributed when called from tests */
export async function importTopPages(context) {
  const {
    site, dataAccess, log,
  } = context;
  const { SiteTopPage } = dataAccess;

  try {
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

    if (topPages.length === 0) {
      log.info('[SUMMARIZATION] No Ahrefs top pages found for site; continuing with fallback URL sources');
      return {
        type: 'top-pages',
        siteId: site.getId(),
        auditResult: {
          success: true,
          topPages: [],
        },
        fullAuditRef: site.getBaseURL(),
      };
    }

    log.info(`[SUMMARIZATION] Found ${topPages.length} top pages for site ${site.getId()} (using max ${MAX_TOP_PAGES})`);

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
    site, audit, log,
  } = context;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    log.warn('[SUMMARIZATION] Audit failed, skipping scraping');
    throw new Error('Audit failed, skipping scraping');
  }

  const { urls } = await getSummarizationInputUrls(context);
  if (urls.length === 0) {
    log.warn('[SUMMARIZATION] No URLs to submit for scraping');
    throw new Error('No URLs to submit for scraping');
  }

  const staticUrls = filterOutDynamicUrls(urls);
  const excludedCount = urls.length - staticUrls.length;
  if (excludedCount > 0) {
    log.info(`[SUMMARIZATION] Excluded ${excludedCount} dynamic page(s) from summarization`);
  }
  if (staticUrls.length === 0) {
    log.warn('[SUMMARIZATION] No static pages left after filtering dynamic content');
    throw new Error('No URLs to submit for scraping (all excluded as dynamic)');
  }
  const topPagesToScrape = staticUrls.slice(0, MAX_TOP_PAGES);

  log.info(`[SUMMARIZATION] Submitting ${topPagesToScrape.length} pages for scraping`);

  return {
    auditContext: {
      [AUDIT_CONTEXT_URLS_KEY]: topPagesToScrape,
    },
    urls: topPagesToScrape.map((url) => ({ url })),
    siteId: site.getId(),
    /* c8 ignore next 3 - return object tail covered by submitForScraping tests */
    type: 'summarization',
  };
}

/**
 * Step 3: Send to Mystique for AI processing
 */
export async function sendToMystique(context) {
  const {
    site, audit, auditContext, log, sqs, env, scrapeResultPaths, s3Client,
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

  const submittedUrls = auditContext?.[AUDIT_CONTEXT_URLS_KEY];
  if (!Array.isArray(submittedUrls) || submittedUrls.length === 0) {
    log.warn('[SUMMARIZATION] No submitted URLs found in audit context, skipping Mystique message');
    throw new Error('No submitted URLs found');
  }
  const urlsToCheck = submittedUrls;

  // Verify scrape availability before sending to Mystique
  if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
    log.warn('[SUMMARIZATION] No scrape results available');
    throw new Error('No scrape results available');
  }

  const availableUrls = urlsToCheck.filter((url) => scrapeResultPaths.has(url));
  const availableCount = availableUrls.length;
  const totalCount = urlsToCheck.length;
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

  // Use URLs from scrapeResultPaths Map; exclude dynamic pages (defense in depth)
  const scrapedUrls = availableUrls;
  const staticScrapedUrls = filterOutDynamicUrls(scrapedUrls);

  // Pre-check: exclude pages that already have both summary and key points (LLMO-3493)
  let urlsToSend = staticScrapedUrls;
  if (s3Client && env?.S3_SCRAPER_BUCKET_NAME) {
    const existingContent = await detectExistingContent(
      s3Client,
      env.S3_SCRAPER_BUCKET_NAME,
      scrapeResultPaths,
      log,
    );
    urlsToSend = urlsToSend.filter((url) => {
      const detected = existingContent.get(url);
      const hasBoth = detected?.hasSummary && detected?.hasKeyPoints;
      return !hasBoth;
    });
  }
  urlsToSend = urlsToSend.slice(0, MAX_PAGES_TO_MYSTIQUE);

  const topPagesPayload = urlsToSend.map((url) => ({
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
