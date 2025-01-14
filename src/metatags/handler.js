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
import { composeAuditURL } from '@adobe/spacecat-shared-utils';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import SeoChecks from './seo-checks.js';
import syncOpportunityAndSuggestions from './opportunityHandler.js';
import { getRUMDomainkey } from '../support/utils.js';
import { wwwUrlResolver } from '../common/audit.js';

const DEFAULT_CPC = 1; // $1

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
  const trafficSum = target.total;
  log.info(`Found ${trafficSum} page views for ${endpoint}`);
  return trafficSum;
}

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
    try {
      const organicTraffic = getOrganicTrafficForEndpoint(endpoint, rumTrafficDataMap, log);
      Object.values((tags)).forEach((tagIssueDetails) => {
        const multiplier = tagIssueDetails.issue.includes('Missing') ? 0.01 : 0.005;
        projectedTraffic += organicTraffic * multiplier;
      });
    } catch (err) {
      log.warn(`Error while calculating projected traffic for ${endpoint}`, err);
    }
  });
  return projectedTraffic;
}

export default async function auditMetaTags(message, context) {
  const { type, auditContext = {} } = message;
  const siteId = message.siteId || message.url;
  const {
    dataAccess, log, s3Client,
  } = context;
  const { Audit, Configuration } = dataAccess;

  try {
    const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
    if (!site) {
      return notFound('Site not found');
    }
    if (!site.getIsLive()) {
      log.info(`Site ${siteId} is not live`);
      return ok();
    }
    const configuration = await Configuration.findLatest();
    if (!configuration.isHandlerEnabledForSite(type, site)) {
      log.info(`Audit type ${type} disabled for site ${siteId}`);
      return ok();
    }
    try {
      auditContext.finalUrl = await composeAuditURL(site.getBaseURL());
    } catch (e) {
      log.error(`Get final URL for siteId ${siteId} failed with error: ${e.message}`, e);
      return internalServerError(`Internal server error: ${e.message}`);
    }
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
      seoChecks.performChecks(pageUrl || '/', pageTags);
    }
    seoChecks.finalChecks();
    const detectedTags = seoChecks.getDetectedTags();
    const projectedTraffic = calculateProjectedTraffic(context, site, detectedTags, log);
    const projectedTrafficValue = projectedTraffic * DEFAULT_CPC;
    // Prepare Audit result
    const auditResult = {
      detectedTags,
      sourceS3Folder: `${bucketName}/${prefix}`,
      finalUrl: auditContext.finalUrl,
      projectedTraffic,
      projectedTrafficValue,
    };
    const auditData = {
      siteId: site.getId(),
      isLive: site.getIsLive(),
      auditedAt: new Date().toISOString(),
      auditType: type,
      fullAuditRef: '',
      auditResult,
    };
    // Persist Audit result
    const audit = await Audit.create(auditData);
    log.info(`Successfully audited ${siteId} for ${type} type audit`);
    await syncOpportunityAndSuggestions(
      siteId,
      audit.getId(),
      auditData,
      dataAccess,
      log,
    );
    return noContent();
  } catch (e) {
    log.error(`${type} type audit for ${siteId} failed with error: ${e.message}`, e);
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
