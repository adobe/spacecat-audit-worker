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
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import SeoChecks from './seo-checks.js';

async function fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!object?.scrapeResult?.tags || typeof object.scrapeResult.tags !== 'object') {
    log.error(`No Scraped tags found in S3 ${key} object`);
    return null;
  }
  const pageUrl = key.slice(prefix.length - 1).replace('/scrape.json', ''); // Remove the prefix and scrape.json suffix
  return {
    [pageUrl]: {
      title: object.scrapeResult.tags.title,
      description: object.scrapeResult.tags.description,
      h1: object.scrapeResult.tags.h1 || [],
    },
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
    // const configuration = await dataAccess.getConfiguration();
    // if (!configuration.isHandlerEnabledForSite(type, site)) {
    //   log.info(`Audit type ${type} disabled for site ${siteId}`);
    //   return ok();
    // }
    // Fetch site's scraped content from S3
    const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
    const prefix = `scrapes/${siteId}/`;
    const scrapedObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, prefix, log);
    const extractedTags = {};
    const pageMetadataResults = await Promise.all(scrapedObjectKeys.map(
      (key) => fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log),
    ));
    pageMetadataResults.forEach((pageMetadata) => {
      if (pageMetadata) {
        Object.assign(extractedTags, pageMetadata);
      }
    });
    const extractedTagsCount = Object.entries(extractedTags).length;
    if (extractedTagsCount === 0) {
      log.error(`Failed to extract tags from scraped content for bucket ${bucketName} and prefix ${prefix}`);
      return notFound('Site tags data not available');
    }
    log.info(`Performing SEO checks for ${extractedTagsCount} tags`);
    // Perform SEO checks
    const seoChecks = new SeoChecks(log);
    for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
      seoChecks.performChecks(pageUrl, pageTags);
    }
    seoChecks.finalChecks();
    const detectedTags = seoChecks.getDetectedTags();
    log.info(`Detected tags are ${detectedTags}`);
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
