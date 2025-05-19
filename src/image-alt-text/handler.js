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

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

const isImagePresentational = (img) => {
  const isHiddenForScreenReader = img.getAttribute('aria-hidden') === 'true';
  const hasRolePresentation = img.getAttribute('role') === 'presentation';
  const hasAltAttribute = img.hasAttribute('alt');
  // For presentational images, an image MUST have the alt attribute WITH a falsy value
  // Not having it at all is not the same, the image is not considered presentational
  const isAltEmpty = hasAltAttribute && !img.getAttribute('alt');
  return isHiddenForScreenReader || hasRolePresentation || isAltEmpty;
};

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

export async function prepareScrapingStep(context) {
  const { site, log, dataAccess } = context;
  log.info(`[${AUDIT_TYPE}] [Site Id: ${site.getId()}] preparing scraping step`);

  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  if (topPages.length === 0) {
    throw new Error('No top pages found for site');
  }

  return {
    urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
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
    isPresentational: isImagePresentational(img),
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
    log, s3Client, audit, site, finalUrl,
  } = context;
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const siteId = site.getId();
  const auditUrl = finalUrl;

  log.info(`[${AUDIT_TYPE}] [Site Id: ${siteId}] [Audit Url: ${auditUrl}] processing scraped content`);

  const s3BucketPath = `scrapes/${siteId}/`;
  const scrapedPagesFullPathFilenames = await getObjectKeysUsingPrefix(
    s3Client,
    bucketName,
    s3BucketPath,
    log,
  );

  if (scrapedPagesFullPathFilenames.length === 0) {
    log.error(`[${AUDIT_TYPE}] [Site Id: ${siteId}] no scraped content found, cannot proceed with audit`);
  }

  log.info(`[${AUDIT_TYPE}] [Site Id: ${siteId}] found ${scrapedPagesFullPathFilenames.length} scraped pages to analyze`);

  const PageToImagesWithoutAltTextMap = {};
  const pageAuditResults = await Promise.all(
    scrapedPagesFullPathFilenames.map(
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
