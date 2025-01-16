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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import SeoChecks from './seo-checks.js';
import convertToOpportunity from './opportunityHandler.js';
import { calculateCPCValue, getRUMDomainkey } from '../support/utils.js';
import { noopUrlResolver, wwwUrlResolver } from '../common/audit.js';
import { AuditBuilder } from '../common/audit-builder.js';

export async function fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log) {
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

// Extract endpoint from a url, removes trailing slash if present
function extractEndpoint(url) {
  const urlObj = new URL(url);
  return urlObj.pathname.replace(/\/$/, '');
}

// Preprocess RUM data into a map with endpoint as the key
function preprocessRumData(rumTrafficData) {
  const dataMap = new Map();
  rumTrafficData.forEach((item) => {
    const endpoint = extractEndpoint(item.url);
    dataMap.set(endpoint, item);
  });
  return dataMap;
}

// Get organic traffic for a given endpoint
function getOrganicTrafficForEndpoint(endpoint, dataMap, log) {
  // remove trailing slash from endpoint, if present, and then find in the datamap
  const target = dataMap.get(endpoint.replace(/\/$/, ''));
  if (!target) {
    log.warn(`No rum data found for ${endpoint}`);
    return 0;
  }
  const trafficSum = target.earned + target.paid;
  log.info(`Found ${trafficSum} page views for ${endpoint}`);
  return trafficSum;
}

// Calculate the projected traffic lost for a site
async function calculateProjectedTraffic(context, site, detectedTags, log) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainKey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: wwwUrlResolver(site),
    domainKey,
    interval: 30,
    granularity: 'hourly',
  };
  const queryResults = await rumAPIClient.query('traffic-acquisition', options);
  const rumTrafficDataMap = preprocessRumData(queryResults, log);
  let projectedTraffic = 0;
  Object.entries(detectedTags).forEach(([endpoint, tags]) => {
    const organicTraffic = getOrganicTrafficForEndpoint(endpoint, rumTrafficDataMap, log);
    Object.values((tags)).forEach((tagIssueDetails) => {
      const multiplier = tagIssueDetails.issue.includes('Missing') ? 0.01 : 0.005;
      projectedTraffic += organicTraffic * multiplier;
    });
  });
  return projectedTraffic;
}

export async function auditMetaTagsRunner(baseURL, context, site) {
  const { log, s3Client } = context;
  // Fetch site's scraped content from S3
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;
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
  }
  log.info(`Performing SEO checks for ${extractedTagsCount} tags`);
  // Perform SEO checks
  const seoChecks = new SeoChecks(log);
  for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
    seoChecks.performChecks(pageUrl || '/', pageTags);
  }
  seoChecks.finalChecks();
  const detectedTags = seoChecks.getDetectedTags();
  const projectedTraffic = await calculateProjectedTraffic(context, site, detectedTags, log);
  const cpcValue = await calculateCPCValue(context, site.getId());
  const projectedTrafficValue = projectedTraffic * cpcValue;
  const auditResult = {
    detectedTags,
    sourceS3Folder: `${bucketName}/${prefix}`,
    fullAuditRef: '',
    finalUrl: baseURL,
    projectedTraffic,
    projectedTrafficValue,
  };
  return {
    auditResult,
    fullAuditRef: baseURL,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditMetaTagsRunner)
  .withPostProcessors([convertToOpportunity])
  .build();
