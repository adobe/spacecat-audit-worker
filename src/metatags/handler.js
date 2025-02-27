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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { calculateCPCValue } from '../support/utils.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import SeoChecks from './seo-checks.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver, wwwUrlResolver } from '../common/index.js';
import metatagsAutoSuggest from './metatags-auto-suggest.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getIssueRanking, removeTrailingSlash } from './opportunity-utils.js';
import { DESCRIPTION, H1, TITLE } from './constants.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const auditType = Audit.AUDIT_TYPES.META_TAGS;

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );
  const { log } = context;
  const { detectedTags } = auditData.auditResult;
  const suggestions = [];
  // Generate suggestions data to be inserted in meta-tags opportunity suggestions
  Object.keys(detectedTags)
    .forEach((endpoint) => {
      [TITLE, DESCRIPTION, H1].forEach((tag) => {
        if (detectedTags[endpoint]?.[tag]?.issue) {
          suggestions.push({
            ...detectedTags[endpoint][tag],
            tagName: tag,
            url: removeTrailingSlash(auditData.auditResult.finalUrl) + endpoint,
            rank: getIssueRanking(tag, detectedTags[endpoint][tag].issue),
          });
        }
      });
    });

  const buildKey = (data) => `${data.url}|${data.issue}|${data.tagContent}`;

  // Sync the suggestions from new audit with old ones
  await syncSuggestions({
    opportunity,
    newData: suggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: 'METADATA_UPDATE',
      rank: suggestion.rank,
      data: { ...suggestion },
    }),
    log,
  });
  log.info(`Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and ${auditType} audit type.`);
}

export async function fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!object?.scrapeResult?.tags || typeof object.scrapeResult.tags !== 'object') {
    log.error(`No Scraped tags found in S3 ${key} object`);
    return null;
  }
  let pageUrl = object.finalUrl ? new URL(object.finalUrl).pathname
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
    },
  };
}

// Extract endpoint from a url, removes trailing slash if present
function extractEndpoint(url) {
  const urlObj = new URL(url);
  return urlObj.pathname.replace(/\/$/, '');
}

// Preprocess RUM data into a map with endpoint as the key
function preprocessRumData(rumDataMonthly, rumDataBiMonthly) {
  const rumDataMapMonthly = new Map();
  const rumDataMapBiMonthly = new Map();
  rumDataMonthly.forEach((item) => {
    const endpoint = extractEndpoint(item.url);
    rumDataMapMonthly.set(endpoint, item);
  });
  rumDataBiMonthly.forEach((item) => {
    const endpoint = extractEndpoint(item.url);
    rumDataMapBiMonthly.set(endpoint, item);
  });
  return {
    rumDataMapMonthly,
    rumDataMapBiMonthly,
  };
}

// Get organic traffic for a given endpoint
function getOrganicTrafficForEndpoint(endpoint, rumDataMapMonthly, rumDataMapBiMonthly, log) {
  // remove trailing slash from endpoint, if present, and then find in the datamap
  const target = rumDataMapMonthly.get(endpoint.replace(/\/$/, ''))
    || rumDataMapBiMonthly.get(endpoint.replace(/\/$/, ''));
  if (!target) {
    log.warn(`No rum data found for ${endpoint}.`);
    return 0;
  }
  const trafficSum = target.earned + target.paid;
  log.info(`Found ${trafficSum} page views for ${endpoint}.`);
  return trafficSum;
}

// Calculate the projected traffic lost for a site
async function calculateProjectedTraffic(context, site, detectedTags, log) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const options = {
    domain: wwwUrlResolver(site),
    interval: 30,
    granularity: 'DAILY',
  };
  const queryResultsMonthly = await rumAPIClient.query('traffic-acquisition', options);
  const queryResultsBiMonthly = await rumAPIClient.query('traffic-acquisition', {
    ...options,
    interval: 60,
  });
  const { rumDataMapMonthly, rumDataMapBiMonthly } = preprocessRumData(
    queryResultsMonthly,
    queryResultsBiMonthly,
  );
  let projectedTraffic = 0;
  Object.entries(detectedTags).forEach(([endpoint, tags]) => {
    const organicTraffic = getOrganicTrafficForEndpoint(
      endpoint,
      rumDataMapMonthly,
      rumDataMapBiMonthly,
      log,
    );
    Object.values((tags)).forEach((tagIssueDetails) => {
      // Multiplying by 1% for missing tags, and 0.5% for other tag issues
      // For duplicate tags, each page's traffic is multiplied by .5% so
      // it amounts to 0.5% * number of duplicates.
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

  // Perform SEO checks
  log.info(`Performing SEO checks for ${extractedTagsCount} tags`);
  const seoChecks = new SeoChecks(log);
  for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
    seoChecks.performChecks(pageUrl, pageTags);
  }
  seoChecks.finalChecks();
  const detectedTags = seoChecks.getDetectedTags();

  // Calculate projected traffic lost
  const projectedTrafficLost = await calculateProjectedTraffic(context, site, detectedTags, log);
  const cpcValue = await calculateCPCValue(context, site.getId());
  log.info(`Calculated cpc value: ${cpcValue} for site: ${site.getId()}`);
  const projectedTrafficValue = projectedTrafficLost * cpcValue;

  // Generate AI suggestions for detected tags if auto-suggest enabled for site
  const allTags = {
    detectedTags: seoChecks.getDetectedTags(),
    healthyTags: seoChecks.getFewHealthyTags(),
    extractedTags,
  };
  const updatedDetectedTags = await metatagsAutoSuggest(allTags, context, site);

  const auditResult = {
    detectedTags: updatedDetectedTags,
    sourceS3Folder: `${bucketName}/${prefix}`,
    fullAuditRef: '',
    finalUrl: baseURL,
    projectedTrafficLost,
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
  .withPostProcessors([opportunityAndSuggestions])
  .build();
