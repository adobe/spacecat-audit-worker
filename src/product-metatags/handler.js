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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { calculateCPCValue } from '../support/utils.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';
import ProductSeoChecks from './seo-checks.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import productMetatagsAutoSuggest from './product-metatags-auto-suggest.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { getIssueRanking, getBaseUrl } from './opportunity-utils.js';
import {
  DESCRIPTION,
  H1,
  PROJECTED_VALUE_THRESHOLD,
  TITLE,
} from './constants.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const auditType = 'product-metatags'; // New opportunity type
const { AUDIT_STEP_DESTINATIONS } = Audit;

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
  log.info(`started to audit product-metatags for site url: ${auditData.auditResult.finalUrl}`);
  let useHostnameOnly = false;
  try {
    const siteId = opportunity.getSiteId();
    const site = await context.dataAccess.Site.findById(siteId);
    useHostnameOnly = site?.getDeliveryConfig?.()?.useHostnameOnly ?? false;
  } catch (error) {
    log.error('Error in product-metatags configuration:', error);
  }
  const suggestions = [];
  // Generate suggestions data to be inserted in product-metatags opportunity suggestions
  Object.keys(detectedTags)
    .forEach((endpoint) => {
      [TITLE, DESCRIPTION, H1].forEach((tag) => {
        if (detectedTags[endpoint]?.[tag]?.issue) {
          const suggestion = {
            ...detectedTags[endpoint][tag],
            tagName: tag,
            url: getBaseUrl(auditData.auditResult.finalUrl, useHostnameOnly) + endpoint,
            rank: getIssueRanking(tag, detectedTags[endpoint][tag].issue),
          };

          // Add product-specific data (SKU and image) to each suggestion
          if (detectedTags[endpoint]?.productTags) {
            suggestion.productTags = detectedTags[endpoint].productTags;
          }

          suggestions.push(suggestion);
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
      type: 'PRODUCT_METADATA_UPDATE',
      rank: suggestion.rank,
      data: { ...suggestion },
    }),
  });
  log.info(`Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and ${auditType} audit type.`);
}

// Extract product-specific meta tags from raw HTML
function extractProductTagsFromHTML(rawBody, log) {
  const productTags = {};

  if (!rawBody || typeof rawBody !== 'string') {
    return productTags;
  }

  try {
    // Extract SKU meta tag
    const skuMatch = rawBody.match(/<meta\s+name=["']sku["']\s+content=["']([^"']+)["']/i);
    if (skuMatch) {
      [, productTags.sku] = skuMatch;
    }

    // Extract og:image meta tag
    const ogImageMatch = rawBody.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogImageMatch) {
      [, productTags['og:image']] = ogImageMatch;
    }

    // Extract twitter:image meta tag
    const twitterImageMatch = rawBody.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    if (twitterImageMatch) {
      [, productTags['twitter:image']] = twitterImageMatch;
    }

    // Extract product:image meta tag
    const productImageMatch = rawBody.match(/<meta\s+name=["']product:image["']\s+content=["']([^"']+)["']/i);
    if (productImageMatch) {
      [, productTags['product:image']] = productImageMatch;
    }

    // Extract generic image meta tag
    const imageMatch = rawBody.match(/<meta\s+name=["']image["']\s+content=["']([^"']+)["']/i);
    if (imageMatch) {
      [, productTags.image] = imageMatch;
    }

    log.debug('Extracted product tags from HTML:', Object.keys(productTags));
  } catch (error) {
    log.warn(`Error extracting product tags from HTML: ${error.message}`);
  }

  return productTags;
}

export async function fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!object?.scrapeResult?.tags || typeof object.scrapeResult.tags !== 'object') {
    log.error(`No Scraped tags found in S3 ${key} object`);
    return null;
  }
  // if the scrape result is empty, skip the page for product-metatags audit
  if (object?.scrapeResult?.rawBody?.length < 300) {
    log.error(`Scrape result is empty for ${key}`);
    return null;
  }

  let pageUrl = object.finalUrl ? new URL(object.finalUrl).pathname
    : key.slice(prefix.length - 1).replace('/scrape.json', ''); // Remove the prefix and scrape.json suffix
  // handling for homepage
  if (pageUrl === '') {
    pageUrl = '/';
  }

  // Debug: Log available tags to understand what scraper extracted
  log.debug(`Available tags in ${key}:`, Object.keys(object.scrapeResult.tags || {}));

  // Extract product-specific meta tags
  // from raw HTML since scraper doesn't support custom extraction
  const productTags = extractProductTagsFromHTML(object.scrapeResult.rawBody, log);

  return {
    [pageUrl]: {
      title: object.scrapeResult.tags.title,
      description: object.scrapeResult.tags.description,
      h1: object.scrapeResult.tags.h1 || [],
      // Use client-side extracted product tags
      sku: productTags.sku,
      'og:image': productTags['og:image'],
      'twitter:image': productTags['twitter:image'],
      'product:image': productTags['product:image'],
      image: productTags.image,
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
        // Skip productTags from traffic calculation
        if (tagIssueDetails.tagName === 'productTags') return;

        // Multiplying by 1% for missing tags, and 0.5% for other tag issues
        // For duplicate tags, each page's traffic is multiplied by .5% so
        // it amounts to 0.5% * number of duplicates.
        const multiplier = tagIssueDetails.issue.includes('Missing') ? 0.01 : 0.005;
        projectedTrafficLost += organicTraffic * multiplier;
      });
    });

    const cpcValue = await calculateCPCValue(context, site.getId());
    log.info(`Calculated cpc value: ${cpcValue} for site: ${site.getId()}`);
    const projectedTrafficValue = projectedTrafficLost * cpcValue;

    // Skip updating projected traffic data if lost traffic value is insignificant
    return projectedTrafficValue > PROJECTED_VALUE_THRESHOLD
      ? { projectedTrafficLost, projectedTrafficValue } : {};
  } catch (err) {
    log.warn(`Error while calculating projected traffic for ${site.getId()}`, err);
    return {};
  }
}

export async function productMetatagsAutoDetect(site, pagesSet, context) {
  const { log, s3Client } = context;
  // Fetch site's scraped content from S3
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;
  const scrapedObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, prefix, log);
  const extractedTags = {};
  const pageMetadataResults = await Promise.all(scrapedObjectKeys
    .filter((key) => pagesSet.has(key))
    .map((key) => fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log)));
  pageMetadataResults.forEach((pageMetadata) => {
    if (pageMetadata) {
      Object.assign(extractedTags, pageMetadata);
    }
  });
  const extractedTagsCount = Object.entries(extractedTags).length;
  if (extractedTagsCount === 0) {
    log.error(`Failed to extract tags from scraped content for bucket ${bucketName} and prefix ${prefix}`);
  }

  // Perform SEO checks with product filtering
  log.info(`Performing product SEO checks for ${extractedTagsCount} tags`);
  const seoChecks = new ProductSeoChecks(log);
  let productPagesProcessed = 0;

  for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
    // Check if page has product tags before processing
    if (ProductSeoChecks.hasProductTags(pageTags)) {
      seoChecks.performChecks(pageUrl, pageTags);
      productPagesProcessed += 1;

      // Store product tags in detected tags for forwarding to suggestions
      const productTags = ProductSeoChecks.extractProductTags(pageTags);
      if (Object.keys(productTags).length > 0) {
        seoChecks.detectedTags[pageUrl] ??= {};
        seoChecks.detectedTags[pageUrl].productTags = productTags;
      }
    }
  }

  seoChecks.finalChecks();
  const detectedTags = seoChecks.getDetectedTags();
  log.info(`Found ${Object.keys(detectedTags).length} product pages with issues out of ${productPagesProcessed} product pages processed (${extractedTagsCount} total pages)`);

  return {
    seoChecks,
    detectedTags,
    extractedTags,
  };
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

export async function runAuditAndGenerateSuggestions(context) {
  const {
    site, audit, finalUrl, log, dataAccess,
  } = context;
  // Get top pages for a site
  const siteId = site.getId();
  const topPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
  const includedURLs = await site?.getConfig()?.getIncludedURLs('product-metatags') || [];

  // Transform URLs into scrape.json paths and combine them into a Set
  const topPagePaths = topPages.map((page) => getScrapeJsonPath(page.url, siteId));
  const includedUrlPaths = includedURLs.map((url) => getScrapeJsonPath(url, siteId));
  const totalPagesSet = new Set([...topPagePaths, ...includedUrlPaths]);

  log.info(`Received topPages: ${topPagePaths.length}, includedURLs: ${includedUrlPaths.length}, totalPages to process after removing duplicates: ${totalPagesSet.size}`);

  const {
    seoChecks,
    detectedTags,
    extractedTags,
  } = await productMetatagsAutoDetect(site, totalPagesSet, context);

  // Calculate projected traffic lost
  const {
    projectedTrafficLost,
    projectedTrafficValue,
  } = await calculateProjectedTraffic(
    context,
    site,
    detectedTags,
    log,
  );

  // Generate AI suggestions for detected tags if auto-suggest enabled for site
  const allTags = {
    detectedTags,
    healthyTags: seoChecks.getFewHealthyTags(),
    extractedTags,
  };
  const updatedDetectedTags = await productMetatagsAutoSuggest(allTags, context, site);

  const auditResult = {
    detectedTags: updatedDetectedTags,
    sourceS3Folder: `${context.env.S3_SCRAPER_BUCKET_NAME}/scrapes/${site.getId()}/`,
    fullAuditRef: '',
    finalUrl,
    ...(projectedTrafficLost && { projectedTrafficLost }),
    ...(projectedTrafficValue && { projectedTrafficValue }),
  };

  await opportunityAndSuggestions(finalUrl, {
    siteId: site.getId(),
    auditId: audit.getId(),
    auditResult,
  }, context);

  return {
    status: 'complete',
  };
}

export async function importTopPages(context) {
  const { site, finalUrl } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;
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
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  const topPagesUrls = topPages.map((page) => page.getUrl());
  // Combine includedURLs and topPages URLs to scrape
  const includedURLs = await site?.getConfig()?.getIncludedURLs('product-metatags') || [];

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(`Total top pages: ${topPagesUrls.length}, Total included URLs: ${includedURLs.length}, Final URLs to scrape after removing duplicates: ${finalUrls.length}`);

  if (finalUrls.length === 0) {
    throw new Error('No URLs found for site neither top pages nor included URLs');
  }

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'product-metatags',
  };
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
