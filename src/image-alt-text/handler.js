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

import { JSDOM } from 'jsdom';
import getXpath from 'get-xpath';
import { hasText, tracingFetch } from '@adobe/spacecat-shared-utils';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import {
  getObjectFromKey,
  getObjectKeysUsingPrefix,
} from '../utils/s3-utils.js';
import AuditEngine from './auditEngine.js';
import { AuditBuilder } from '../common/audit-builder.js';
import convertToOpportunity from './opportunityHandler.js';
import {
  shouldShowImageAsSuggestion,
  isImageDecorative,
} from './utils.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

export async function processImportStep(context) {
  const { site, finalUrl } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;

  return {
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Transforms a URL into a scrape.json path for a given site
 * @param {string} url - The URL to transform
 * @param {string} siteId - The site ID
 * @returns {string} The path to the scrape.json file
 */
function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

export async function prepareScrapingStep(context) {
  const { site, log, dataAccess } = context;
  log.info(`[${AUDIT_TYPE}] [Site Id: ${site.getId()}] preparing scraping step`);

  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  const topPagesUrls = topPages.map((topPage) => topPage.getUrl());
  // Combine includedURLs and topPages URLs to scrape
  const includedURLs = await site?.getConfig?.()?.getIncludedURLs('alt-text') || [];

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(`[${AUDIT_TYPE}] Total top pages: ${topPagesUrls.length}, Total included URLs: ${includedURLs.length}, Final URLs to scrape after removing duplicates: ${finalUrls.length}`);

  if (finalUrls.length === 0) {
    throw new Error('No URLs found for site neither top pages nor included URLs');
  }

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'alt-text',
  };
}

export async function fetchPageScrapeAndRunAudit(
  s3Client,
  bucketName,
  scrapedPageFullPathFilename,
  prefix,
  log,
) {
  const pageScrape = await getObjectFromKey(s3Client, bucketName, scrapedPageFullPathFilename, log);
  if (!hasText(pageScrape?.scrapeResult?.rawBody)) {
    log.debug(`[${AUDIT_TYPE}]: No raw HTML content found in S3 ${scrapedPageFullPathFilename} object`);
    return null;
  }

  const dom = new JSDOM(pageScrape.scrapeResult.rawBody);
  const imageElements = dom.window.document.getElementsByTagName('img');
  const images = Array.from(imageElements).map((img) => ({
    shouldShowAsSuggestion: shouldShowImageAsSuggestion(img),
    isDecorative: isImageDecorative(img),
    src: img.getAttribute('src'),
    alt: img.getAttribute('alt'),
    xpath: getXpath(img),
  })).filter((img) => img.src);

  const pageUrl = scrapedPageFullPathFilename.slice(prefix.length - 1).replace('/scrape.json', '');
  return {
    [pageUrl]: {
      images,
      dom,
    },
  };
}

export async function processAltTextAuditStep(context) {
  const {
    log, s3Client, audit, site, finalUrl, dataAccess,
  } = context;
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const siteId = site.getId();
  const auditUrl = finalUrl;

  log.info(`[${AUDIT_TYPE}] [Site Id: ${siteId}] [Audit Url: ${auditUrl}] processing scraped content`);

  // Get top pages for a site (similar to metatags handler)
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
  const includedURLs = await site?.getConfig?.()?.getIncludedURLs('alt-text') || [];

  // Transform URLs into scrape.json paths and combine them into a Set
  const topPagePaths = topPages.map((page) => getScrapeJsonPath(page.getUrl(), siteId));
  const includedUrlPaths = includedURLs.map((url) => getScrapeJsonPath(url, siteId));
  const totalPagesSet = new Set([...topPagePaths, ...includedUrlPaths]);

  log.info(
    `[${AUDIT_TYPE}] Received topPages: ${topPagePaths.length}, includedURLs: ${includedUrlPaths.length}, totalPages to process after removing duplicates: ${totalPagesSet.size}`,
  );

  const s3BucketPath = `scrapes/${siteId}/`;
  const scrapedPagesFullPathFilenames = await getObjectKeysUsingPrefix(
    s3Client,
    bucketName,
    s3BucketPath,
    log,
  );

  // Filter scraped pages to only process the ones we want (top pages + included URLs)
  const filteredScrapedPages = scrapedPagesFullPathFilenames.filter(
    (key) => totalPagesSet.has(key),
  );

  if (filteredScrapedPages.length === 0) {
    log.error(
      `[${AUDIT_TYPE}] [Site Id: ${siteId}] no relevant scraped content found for specified pages, cannot proceed with audit`,
    );
  }

  log.info(
    `[${AUDIT_TYPE}] [Site Id: ${siteId}] found ${filteredScrapedPages.length} relevant scraped pages to analyze out of ${scrapedPagesFullPathFilenames.length} total scraped pages`,
  );

  const PageToImagesWithoutAltTextMap = {};
  const pageAuditResults = await Promise.all(
    filteredScrapedPages.map(
      async (scrape) => fetchPageScrapeAndRunAudit(s3Client, bucketName, scrape, s3BucketPath, log),
    ),
  );

  pageAuditResults.forEach((pageAudit) => {
    if (pageAudit) {
      Object.assign(PageToImagesWithoutAltTextMap, pageAudit);
    }
  });

  const imagesWithoutAltTextCount = Object
    .values(PageToImagesWithoutAltTextMap).reduce((acc, page) => acc + page.images.length, 0);
  if (imagesWithoutAltTextCount === 0) {
    log.info(
      `[${AUDIT_TYPE}]: Found no images without alt text from the scraped content in bucket ${bucketName} with path ${s3BucketPath}`,
    );
  }
  log.info(
    `[${AUDIT_TYPE}]: Identified ${imagesWithoutAltTextCount} images (before filtering)`,
  );

  const auditEngine = new AuditEngine(log);
  for (const [pageUrl, pageImages] of Object.entries(PageToImagesWithoutAltTextMap)) {
    auditEngine.performPageAudit(pageUrl, pageImages);
  }
  await auditEngine.filterImages(auditUrl, tracingFetch);
  auditEngine.finalizeAudit();
  const detectedImages = auditEngine.getAuditedTags();
  log.info(
    `[${AUDIT_TYPE}]: Identified ${detectedImages.imagesWithoutAltText.length} images (after filtering)`,
  );

  // Process opportunity
  log.info(`[${AUDIT_TYPE}] [Site Id: ${siteId}] processing opportunity`);
  const auditResult = {
    detectedImages,
    siteId,
    auditId: audit.getId(),
  };

  await convertToOpportunity(auditUrl, auditResult, context);

  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('processImport', processImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('prepareScraping', prepareScrapingStep, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('processAltTextAudit', processAltTextAuditStep)
  .build();
