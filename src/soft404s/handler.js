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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { noopUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`Importing top pages for ${finalUrl}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    finalUrl,
  };
}

export async function submitForScraping(context) {
  const { site, dataAccess, log } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(
    site.getId(),
    'ahrefs',
    'global',
  );

  if (topPages.length === 0) {
    throw new Error('No top pages found for site');
  }
  const topPagesUrls = topPages.map((page) => page.getUrl());
  // Combine includedURLs and topPages URLs to scrape
  const includedURLs = (await site?.getConfig()?.getIncludedURLs('soft404s')) || [];

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(
    `Total top pages: ${topPagesUrls.length}, Total included URLs: ${includedURLs.length}, Final URLs to scrape after removing duplicates: ${finalUrls.length}`,
  );

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'soft404s',
  };
}

export async function fetchAndProcessPageObject(
  s3Client,
  bucketName,
  key,
  prefix,
  log,
) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (
    !object?.scrapeResult?.tags
    || typeof object.scrapeResult.tags !== 'object'
  ) {
    log.error(`No Scraped tags found in S3 ${key} object`);
    return null;
  }
  let pageUrl = object.finalUrl
    ? new URL(object.finalUrl).pathname
    : key.slice(prefix.length - 1).replace('/scrape.json', ''); // Remove the prefix and scrape.json suffix
  // handling for homepage
  if (pageUrl === '') {
    pageUrl = '/';
  }
  return {
    [pageUrl]: {
      title: object.scrapeResult.tags.title,
      description: object.scrapeResult.tags.description,
      h1: object.scrapeResult.tags.h1 || [],
      s3key: key,
      rawBody: object.scrapeResult.rawBody,
    },
  };
}

export async function soft404sAutoDetect(site, pagesSet, context) {
  const { log, s3Client } = context;
  // Fetch site's scraped content from S3
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;
  const scrapedObjectKeys = await getObjectKeysUsingPrefix(
    s3Client,
    bucketName,
    prefix,
    log,
  );

  const pageMetadataResults = await Promise.all(
    scrapedObjectKeys
      .filter((key) => pagesSet.has(key))
      .map((key) => fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log)),
  );

  log.info(`Page metadata results: ${JSON.stringify(pageMetadataResults)}`);
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

export async function soft404sAuditRunner(context) {
  const {
    site,
    log,
    dataAccess,
    baseURL,
  } = context;

  const siteId = site.getId();

  log.info(`Starting Soft404s Audit with siteId: ${JSON.stringify(siteId)}`);

  try {
    // Get top pages for a site
    // const siteId = site.getId();
    const topPages = await getTopPagesForSiteId(
      dataAccess,
      siteId,
      context,
      log,
    );
    const includedURLs = (await site?.getConfig()?.getIncludedURLs('soft404s')) || [];

    // Transform URLs into scrape.json paths and combine them into a Set
    const topPagePaths = topPages.map((page) => getScrapeJsonPath(page.url, siteId));
    const includedUrlPaths = includedURLs.map((url) => getScrapeJsonPath(url, siteId));
    const totalPagesSet = new Set([...topPagePaths, ...includedUrlPaths]);

    log.info(
      `Received topPages: ${topPagePaths.length}, includedURLs: ${includedUrlPaths.length}, totalPages to process after removing duplicates: ${totalPagesSet.size}`,
    );

    await soft404sAutoDetect(site, totalPagesSet, context);

    return {};
  } catch (error) {
    return {
      fullAuditRef: baseURL,
      auditResult: {
        error: `Audit failed with error: ${error.message}`,
        success: false,
      },
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .addStep(
    'submit-for-import-top-pages',
    importTopPages,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'submit-for-scraping',
    submitForScraping,
    AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER,
  )
  .addStep('soft404s-audit-runner', soft404sAuditRunner)
  .build();
