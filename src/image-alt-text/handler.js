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
import {
  getObjectFromKey,
  getObjectKeysUsingPrefix,
} from '../utils/s3-utils.js';
import AuditEngine from './auditEngine.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';
import generateSuggestions from './suggestion-helper.js';
import convertToOpportunity from './opportunityHandler.js';

export async function fetchAndProcessPageObject(
  s3Client,
  bucketName,
  key,
  prefix,
  log,
) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!object?.scrapeResult?.rawBody) {
    log.error(`No raw HTML content found in S3 ${key} object`);
    return null;
  }

  // Parse HTML content
  const dom = new JSDOM(object.scrapeResult.rawBody);
  const imageElements = dom.window.document.getElementsByTagName('img');
  const images = Array.from(imageElements).map((img) => ({
    src: img.getAttribute('src'),
    alt: img.getAttribute('alt'),
  }));

  const pageUrl = key.slice(prefix.length - 1).replace('/scrape.json', '');
  return {
    [pageUrl]: {
      images,
    },
  };
}

export async function auditImageAltTextRunner(baseURL, context, site) {
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
    log.error(
      `Failed to extract tags from scraped content for bucket ${bucketName} and prefix ${prefix}`,
    );
  }
  log.info(
    `Performing image alt text audit for ${extractedTagsCount} elements`,
  );
  // Perform Image Alt Text audit
  const auditEngine = new AuditEngine(log);
  for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
    auditEngine.performPageAudit(pageUrl || '/', pageTags);
  }
  auditEngine.finalizeAudit();
  const detectedTags = auditEngine.getAuditedTags();

  const auditResult = {
    detectedTags,
    sourceS3Folder: `${bucketName}/${prefix}`,
    fullAuditRef: 'na', // Unclear what value should go here, some use baseURL, some 'na'
    finalUrl: baseURL,
  };

  return {
    auditResult,
    fullAuditRef: baseURL,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditImageAltTextRunner)
  .withPostProcessors([generateSuggestions, convertToOpportunity])
  .build();
