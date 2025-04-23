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
import { noopUrlResolver } from '../common/index.js';
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

export async function fetchAndProcessPageObject(
  s3Client,
  bucketName,
  key,
  prefix,
  log,
) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!hasText(object?.scrapeResult?.rawBody)) {
    log.debug(`[${AUDIT_TYPE}]: No raw HTML content found in S3 ${key} object`);
    return null;
  }

  // Parse HTML content
  const dom = new JSDOM(object.scrapeResult.rawBody);
  const imageElements = dom.window.document.getElementsByTagName('img');
  const images = Array.from(imageElements).map((img) => ({
    isPresentational: isImagePresentational(img),
    src: img.getAttribute('src'),
    alt: img.getAttribute('alt'),
    xpath: getXpath(img),
  })).filter((img) => img.src);

  const pageUrl = key.slice(prefix.length - 1).replace('/scrape.json', '');
  return {
    [pageUrl]: {
      images,
      dom,
    },
  };
}

export async function prepareScrapingStep(context) {
  const { site, log, finalUrl } = context;

  log.info(`[${AUDIT_TYPE}] [Site Id: ${site.getId()}] preparing scraping step`);

  return {
    processingType: 'alt-text', // TO-DO: Is this needed?
    jobId: site.getId(),
    urls: [{ url: finalUrl }],
    siteId: site.getId(),
  };
}

export async function processAltTextAuditStep(context) {
  const {
    log, finalUrl, s3Client, audit, siteId: siteIdFromContext,
  } = context;
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;

  // Temporary workaround to get the siteId from the audit
  const auditId = audit.getId() || context.auditId;
  const siteId = AuditModel.findById(auditId).getSite() || siteIdFromContext;
  log.info(`[${AUDIT_TYPE}] [AuditId: ${auditId}] [Site Id: ${siteId}]`);

  const prefix = `scrapes/${siteId}/`;

  log.info(`[${AUDIT_TYPE}] [Site Id: ${siteId}] processing scraped content`);

  const scrapedObjectKeys = await getObjectKeysUsingPrefix(
    s3Client,
    bucketName,
    prefix,
    log,
  );

  if (scrapedObjectKeys.length === 0) {
    log.error(`[${AUDIT_TYPE}] [Site Id: ${siteId}] no scraped content found, cannot proceed with audit`);
  }

  log.info(`[${AUDIT_TYPE}] [Site Id: ${siteId}] found ${scrapedObjectKeys.length} scraped pages to analyze`);

  const extractedTags = {};
  const pageAuditResults = await Promise.all(
    scrapedObjectKeys.map(
      (key) => fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log),
    ),
  );

  pageAuditResults.forEach((pageAudit) => {
    if (pageAudit) {
      Object.assign(extractedTags, pageAudit);
    }
  });
  const extractedTagsCount = Object.entries(extractedTags).length;
  if (extractedTagsCount === 0) {
    log.info(
      `[${AUDIT_TYPE}]: Found no images with issues from the scraped content in bucket ${bucketName} with path ${prefix}`,
    );
  }
  log.info(
    `[${AUDIT_TYPE}]: Performing image alt text audit for ${extractedTagsCount} elements`,
  );

  const auditEngine = new AuditEngine(log);
  for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
    auditEngine.performPageAudit(pageUrl, pageTags);
  }
  await auditEngine.filterImages(finalUrl, tracingFetch);
  auditEngine.finalizeAudit();
  const detectedTags = auditEngine.getAuditedTags();

  // Process opportunity
  log.info(`[${AUDIT_TYPE}] [Site Id: ${siteId}] processing opportunity`);
  const auditResult = audit.getAuditResult();

  await convertToOpportunity(finalUrl, auditResult, context);
  log.info(`[${AUDIT_TYPE}] [Site Id: ${siteId}] opportunity identified`);

  return {
    detectedTags,
    sourceS3Folder: `${bucketName}/${prefix}`,
    fullAuditRef: prefix,
    finalUrl,
    status: 'complete',
  };
}

export async function processImportStep(context) {
  const { site } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;

  return {
    auditResult: { status: 'preparing' },
    fullAuditRef: s3BucketPath,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .addStep('processImport', processImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('prepareScraping', prepareScrapingStep, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('processAltTextAudit', processAltTextAuditStep)
  .build();
