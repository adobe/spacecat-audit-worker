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
import { Audit, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { calculateCPCValue } from '../support/utils.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import SeoChecks from './seo-checks.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getIssueRanking, trimTagValue, normalizeTagValue } from '../utils/seo-utils.js';
import { getBaseUrl } from '../utils/url-utils.js';
import {
  DESCRIPTION,
  H1,
  PROJECTED_VALUE_THRESHOLD,
  TITLE,
} from './constants.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { validateDetectedIssues } from './ssr-meta-validator.js';

const auditType = Audit.AUDIT_TYPES.META_TAGS;
const { AUDIT_STEP_DESTINATIONS } = Audit;

export const buildKey = (data) => `${data.url}|${data.issue}|${data.tagContent || ''}`;

export async function opportunityAndSuggestions(finalUrl, auditData, context) {
  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: auditData.siteId, id: auditData.auditId },
    context,
    createOpportunityData,
    auditType,
    {
      projectedTrafficLost: auditData.auditResult.projectedTrafficLost,
      projectedTrafficValue: auditData.auditResult.projectedTrafficValue,
    },
  );
  const { log } = context;
  const { detectedTags } = auditData.auditResult;
  log.debug(`started to audit metatags for site url: ${auditData.auditResult.finalUrl}`);
  let useHostnameOnly = false;
  try {
    const siteId = opportunity.getSiteId();
    const site = await context.dataAccess.Site.findById(siteId);
    useHostnameOnly = site?.getDeliveryConfig?.()?.useHostnameOnly ?? false;
  } catch (error) {
    log.error('Error in meta-tags configuration:', error);
  }
  const suggestions = [];
  // Generate suggestions data to be inserted in meta-tags opportunity suggestions
  Object.keys(detectedTags)
    .forEach((endpoint) => {
      [TITLE, DESCRIPTION, H1].forEach((tag) => {
        if (detectedTags[endpoint]?.[tag]?.issue) {
          suggestions.push({
            ...detectedTags[endpoint][tag],
            tagName: tag,
            url: getBaseUrl(auditData.auditResult.finalUrl, useHostnameOnly) + endpoint,
            rank: getIssueRanking(tag, detectedTags[endpoint][tag].issue),
          });
        }
      });
    });

  // Custom merge function to preserve user-edited fields
  const mergeDataFunction = (existingData, newData) => {
    const merged = {
      ...existingData,
      ...newData,
    };

    // Preserve editedSuggestion and is_edited flag if user has made a selection (AI or custom)
    // eslint-disable-next-line max-len
    if (existingData.editedSuggestion !== undefined && existingData.editedSuggestion !== null && existingData.is_edited !== null) {
      merged.editedSuggestion = existingData.editedSuggestion;
      merged.is_edited = existingData.is_edited;
    } else {
      // Explicitly remove editedSuggestion if not present or flag is null
      delete merged.editedSuggestion;
    }

    return merged;
  };

  // Sync the suggestions from new audit with old ones
  await syncSuggestions({
    opportunity,
    newData: suggestions,
    context,
    buildKey,
    mergeDataFunction,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: 'METADATA_UPDATE',
      rank: suggestion.rank,
      data: { ...suggestion },
    }),
  });
  log.debug(`Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and ${auditType} audit type.`);
}

export async function fetchAndProcessPageObject(s3Client, bucketName, url, key, log) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!object?.scrapeResult?.tags || typeof object.scrapeResult.tags !== 'object') {
    log.error(`No Scraped tags found in S3 ${key} object`);
    return null;
  }

  // Check for error pages by content
  const { tags } = object.scrapeResult;
  const title = normalizeTagValue(tags.title);
  const h1Text = normalizeTagValue(tags.h1);
  const httpStatusCodes = ['400', '401', '403', '404', '405', '500', '502', '503', '504'];

  const hasErrorKeyword = title.includes('error') || h1Text.includes('error');
  const hasStatusCode = httpStatusCodes.some(
    (code) => title.includes(code) || h1Text.includes(code),
  );

  if (hasErrorKeyword || hasStatusCode) {
    const h1Display = Array.isArray(tags.h1) ? tags.h1[0] : tags.h1;
    log.info(`[metatags] Skipping error page for ${url} (title: "${tags.title}", h1: "${h1Display}")`);
    return null;
  }

  // if the scrape result is empty, skip the page for metatags audit
  if (object?.scrapeResult?.rawBody?.length < 300) {
    log.error(`Scrape result is empty for ${key}`);
    return null;
  }

  const pageUrl = object.finalUrl ? new URL(object.finalUrl).pathname
    : new URL(url).pathname;
  // handling for homepage
  return {
    [pageUrl]: {
      title: trimTagValue(object.scrapeResult.tags.title),
      description: trimTagValue(object.scrapeResult.tags.description),
      h1: trimTagValue(object.scrapeResult.tags.h1) || [],
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
  return target.earned + target.paid;
}

// Calculate the projected traffic lost for a site
async function calculateProjectedTraffic(context, site, detectedTags, log) {
  const options = {
    domain: await wwwUrlResolver(site, context),
    interval: 30,
    granularity: 'DAILY',
  };
  try {
    const rumAPIClient = RUMAPIClient.createFrom(context);
    const queryResultsMonthly = await rumAPIClient.query('traffic-acquisition', options);
    const queryResultsBiMonthly = await rumAPIClient.query('traffic-acquisition', {
      ...options,
      interval: 60,
    });

    const { rumDataMapMonthly, rumDataMapBiMonthly } = preprocessRumData(
      queryResultsMonthly,
      queryResultsBiMonthly,
    );

    let projectedTrafficLost = 0;
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
        projectedTrafficLost += organicTraffic * multiplier;
      });
    });

    const cpcValue = await calculateCPCValue(context, site.getId());
    log.debug(`Calculated cpc value: ${cpcValue} for site: ${site.getId()}`);
    const projectedTrafficValue = projectedTrafficLost * cpcValue;

    // Skip updating projected traffic data if lost traffic value is insignificant
    return projectedTrafficValue > PROJECTED_VALUE_THRESHOLD
      ? { projectedTrafficLost, projectedTrafficValue } : {};
  } catch (err) {
    log.warn(`Error while calculating projected traffic for ${site.getId()}`, err);
    return {};
  }
}

export async function metatagsAutoDetect(site, pagesMap, context) {
  const { log, s3Client } = context;
  // Fetch site's scraped content from S3
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const extractedTags = {};
  const pageMetadataResults = await Promise.all([...pagesMap]
    .map(([url, path]) => fetchAndProcessPageObject(s3Client, bucketName, url, path, log)));
  pageMetadataResults.forEach((pageMetadata) => {
    if (pageMetadata) {
      Object.assign(extractedTags, pageMetadata);
    }
  });
  const extractedTagsCount = Object.entries(extractedTags).length;
  if (extractedTagsCount === 0) {
    log.error(`Failed to extract tags from scraped content for bucket ${bucketName}`);
  }

  // Perform SEO checks
  const seoChecks = new SeoChecks(log);
  for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
    seoChecks.performChecks(pageUrl, pageTags);
  }
  seoChecks.finalChecks();
  const detectedTags = seoChecks.getDetectedTags();
  return {
    seoChecks,
    detectedTags,
    extractedTags,
  };
}

export async function runAuditAndGenerateSuggestions(context) {
  const {
    site, audit, finalUrl, log, scrapeResultPaths,
  } = context;

  log.info(`[metatags] scrapeResultPaths for ${site.getId()}: ${JSON.stringify(scrapeResultPaths)}`);
  log.info(`[metatags] Start runAuditAndGenerateSuggestions step for: ${site.getId()}`);

  const {
    seoChecks,
    detectedTags,
    extractedTags,
  } = await metatagsAutoDetect(site, scrapeResultPaths, context);

  // Validate detected issues using SSR fallback to eliminate false positives
  log.debug('Validating detected issues via SSR to remove false positives...');
  const validatedDetectedTags = await validateDetectedIssues(
    detectedTags,
    site.getBaseURL(),
    log,
  );

  // Check if there are any detected tags BEFORE proceeding
  if (!validatedDetectedTags || Object.keys(validatedDetectedTags).length === 0) {
    log.info(`[metatags] No valid metatag issues detected for ${site.getId()}, skipping opportunity creation`);
    return {
      status: 'complete',
    };
  }

  // Calculate projected traffic lost
  const {
    projectedTrafficLost,
    projectedTrafficValue,
  } = await calculateProjectedTraffic(
    context,
    site,
    validatedDetectedTags,
    log,
  );

  // Generate AI suggestions for detected tags if auto-suggest enabled for site
  const allTags = {
    detectedTags: validatedDetectedTags,
    healthyTags: seoChecks.getFewHealthyTags(),
    extractedTags,
  };

  // Mystique (asynchronous with chunking)
  // Create opportunity first (needed for Mystique)
  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    auditType,
    {
      projectedTrafficLost,
      projectedTrafficValue,
    },
  );

  // Get useHostnameOnly setting
  let useHostnameOnly = false;
  try {
    const siteId = opportunity.getSiteId();
    const siteObj = await context.dataAccess.Site.findById(siteId);
    useHostnameOnly = siteObj?.getDeliveryConfig?.()?.useHostnameOnly ?? false;
  } catch (error) {
    log.error('Error in meta-tags configuration:', error);
  }

  // Build ALL suggestions list first
  const suggestionsList = [];
  Object.keys(validatedDetectedTags).forEach((endpoint) => {
    [TITLE, DESCRIPTION, H1].forEach((tag) => {
      if (validatedDetectedTags[endpoint]?.[tag]?.issue) {
        suggestionsList.push({
          ...validatedDetectedTags[endpoint][tag],
          tagName: tag,
          url: getBaseUrl(finalUrl, useHostnameOnly) + endpoint,
          rank: getIssueRanking(tag, validatedDetectedTags[endpoint][tag].issue),
        });
      }
    });
  });

  log.info(`[metatags] Built ${suggestionsList.length} suggestions for Mystique`);

  // Custom merge function to preserve user-edited fields
  const mergeDataFunction = (existingData, newData) => {
    const merged = {
      ...existingData,
      ...newData,
    };

    // Preserve editedSuggestion and is_edited flag if user has made a selection (AI or custom)
    // eslint-disable-next-line max-len
    if (existingData.editedSuggestion !== undefined && existingData.editedSuggestion !== null && existingData.is_edited !== null) {
      merged.editedSuggestion = existingData.editedSuggestion;
      merged.is_edited = existingData.is_edited;
    } else {
      // Explicitly remove editedSuggestion if not present or flag is null
      delete merged.editedSuggestion;
    }

    return merged;
  };

  // Sync ALL suggestions to database first (before chunking)
  await syncSuggestions({
    opportunity,
    newData: suggestionsList,
    context,
    buildKey,
    mergeDataFunction,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: 'METADATA_UPDATE',
      rank: suggestion.rank,
      data: { ...suggestion },
    }),
  });

  // Get synced suggestions from database (with IDs)
  const { Suggestion, Configuration } = context.dataAccess;
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('meta-tags-auto-suggest', site)) {
    log.info('Metatags auto-suggest is disabled for site');
    return {
      status: 'complete',
    };
  }

  const syncedSuggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionModel.STATUSES.NEW,
  );

  // Build suggestion map with actual DB IDs
  const suggestionMap = syncedSuggestions.map((s) => {
    const suggestionUrl = s.getData().url;
    // Extract endpoint from full URL (e.g., "https://example.com/page1" -> "/page1")
    const endpoint = new URL(suggestionUrl).pathname;
    return {
      suggestionId: s.getId(),
      endpoint,
      tagName: s.getData().tagName,
    };
  });

  // Build unique pageUrls from all suggestions
  const pageUrls = [...new Set(suggestionMap.map((s) => `${site.getBaseURL()}${s.endpoint}`))];

  log.info(`[metatags] Sending ${suggestionMap.length} suggestions to Mystique (${pageUrls.length} unique pages)`);

  // Send single SQS message with all suggestions
  const { sqs, env } = context;
  const message = {
    type: 'guidance:metatags',
    siteId: site.getId(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      detectedTags: validatedDetectedTags,
      healthyTags: allTags.healthyTags,
      suggestionMap,
      baseUrl: site.getBaseURL(),
      pageUrls,
      opportunityId: opportunity.getId(),
    },
  };

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info(`[metatags] Successfully sent all ${suggestionMap.length} suggestions to Mystique`);

  log.info(`[metatags] Finish runAuditAndGenerateSuggestions step for: ${site.getId()}`);

  return {
    status: 'complete',
  };
}

export async function importTopPages(context) {
  const { site, log, finalUrl } = context;
  const s3BucketPath = `scrapes/${site.getId()}/`;

  log.info(`[metatags] importTopPages step requested scraping for ${site.getId()}, bucket path: ${s3BucketPath}`);

  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
  };
}

export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
  } = context;
  const { SiteTopPage } = dataAccess;

  log.info(`[metatags] Start submitForScraping step for: ${site.getId()}`);

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  const topPagesUrls = topPages.map((page) => page.getUrl());
  // Combine includedURLs and topPages URLs to scrape
  const includedURLs = await site?.getConfig()?.getIncludedURLs('meta-tags') || [];

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.debug(`Total top pages: ${topPagesUrls.length}, Total included URLs: ${includedURLs.length}, Final URLs to scrape after removing duplicates: ${finalUrls.length}`);

  if (finalUrls.length === 0) {
    throw new Error(`No URLs found for site neither top pages nor included URLs for ${site.getId()}`);
  }

  // Filter out PDF files before scraping
  const isPdfUrl = (url) => {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      return pathname.endsWith('.pdf');
    } catch {
      return false;
    }
  };

  const filteredUrls = finalUrls.filter((url) => {
    if (isPdfUrl(url)) {
      log.info(`[metatags] Skipping PDF file from scraping: ${url}`);
      return false;
    }
    return true;
  });

  log.info(`[metatags] Finish submitForScraping step for: ${site.getId()}`);

  return {
    urls: filteredUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'default',
    allowCache: false,
    maxScrapeAge: 0,
    options: {
      waitTimeoutForMetaTags: 5000,
    },
  };
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
