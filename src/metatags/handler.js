/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  internalServerError, noContent, notFound, ok,
} from '@adobe/spacecat-shared-http-utils';
import { JSDOM } from 'jsdom';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import { DESCRIPTION, H1, TITLE } from './constants.js';
import SeoChecks from './seo-checks.js';

function extractTagsFromHtml(htmlContent) {
  const dom = new JSDOM(htmlContent);
  const doc = dom.window.document;

  const title = doc.querySelector('title')?.textContent;
  const description = doc.querySelector('meta[name="description"]')?.getAttribute('content');
  const h1Tags = Array.from(doc.querySelectorAll('h1')).map((h1) => h1.textContent);
  return {
    [TITLE]: title,
    [DESCRIPTION]: description,
    [H1]: h1Tags,
  };
}

async function fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!object?.Body?.rawBody || typeof object.Body.rawBody !== 'string') {
    log.error(`No Scraped html found in S3 ${key} object`);
    return null;
  }
  const tags = extractTagsFromHtml(object.Body.rawBody);
  const pageUrl = key.slice(prefix.length - 1).replace('.json', ''); // Remove the prefix and .json suffix
  return {
    [pageUrl]: tags,
  };
}

export default async function auditMetaTags(message, context) {
  const { type, url: siteId } = message;
  const {
    dataAccess, log, s3Client,
  } = context;

  try {
    log.info(`Received ${type} audit request for siteId: ${siteId}`);
    const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
    if (!site) {
      return notFound('Site not found');
    }
    if (!site.isLive()) {
      log.info(`Site ${siteId} is not live`);
      return ok();
    }
    const configuration = await dataAccess.getConfiguration();
    if (!configuration.isHandlerEnabledForSite(type, site)) {
      log.info(`Audit type ${type} disabled for site ${siteId}`);
      return ok();
    }
    // Fetch site's scraped content from S3
    const bucketName = context.env.S3_BUCKET_NAME;
    const prefix = `scrapes/${siteId}/`;
    const scrapedObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, prefix);
    const extractedTags = {};
    for (const key of scrapedObjectKeys) {
      // eslint-disable-next-line no-await-in-loop
      const pageMetadata = await fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log);
      if (pageMetadata) {
        Object.assign(extractedTags, pageMetadata);
      }
    }
    if (Object.entries(extractedTags).length === 0) {
      log.error(`Failed to extract tags from scraped content for bucket ${bucketName} and prefix ${prefix}`);
      return notFound('Site tags data not available');
    }
    // Fetch keywords for top pages
    const topPages = await dataAccess.getTopPagesForSite(siteId, 'ahrefs', 'global');
    const keywords = {};
    topPages.forEach((page) => {
      const endpoint = new URL(page.getURL).pathname;
      keywords[endpoint] = page.getTopKeyword();
    });
    // Perform SEO checks
    const seoChecks = new SeoChecks(log, keywords);
    for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
      seoChecks.performChecks(pageUrl, pageTags);
    }
    const detectedTags = seoChecks.getDetectedTags();
    // Prepare Audit result
    const auditResult = {
      detectedTags,
      sourceS3Folder: `${bucketName}/${prefix}`,
      fullAuditRef: 'na',
    };
    const auditData = {
      siteId: site.getId(),
      isLive: site.isLive(),
      auditedAt: new Date().toISOString(),
      auditType: type,
      fullAuditRef: auditResult?.fullAuditRef,
      auditResult,
    };
    // Persist Audit result
    await dataAccess.addAudit(auditData);
    log.info(`Successfully audited ${siteId} for ${type} type audit`);
    return noContent();
  } catch (e) {
    log.error(`${type} type audit for ${siteId} failed with error: ${e.message}`, e);
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
