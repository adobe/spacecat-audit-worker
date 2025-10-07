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

const auditType = Audit.AUDIT_TYPES.PRODUCT_METATAGS;
const { AUDIT_STEP_DESTINATIONS } = Audit;

export async function opportunityAndSuggestions(finalUrl, auditData, context) {
  const { log } = context;

  log.info(`[PRODUCT-METATAGS] Starting opportunityAndSuggestions for finalUrl: ${finalUrl}`);
  log.info('[PRODUCT-METATAGS] AuditData:', {
    siteId: auditData.siteId,
    auditId: auditData.auditId,
    hasAuditResult: !!auditData.auditResult,
    finalUrl: auditData.auditResult?.finalUrl,
    projectedTrafficLost: auditData.auditResult?.projectedTrafficLost,
    projectedTrafficValue: auditData.auditResult?.projectedTrafficValue,
  });

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

  log.info(`[PRODUCT-METATAGS] Opportunity created/updated with id: ${opportunity.getId()}`);

  const { detectedTags } = auditData.auditResult;
  log.info(`[PRODUCT-METATAGS] Started to audit product-metatags for site url: ${auditData.auditResult.finalUrl}`);

  // Add null check for detectedTags
  if (!detectedTags || typeof detectedTags !== 'object') {
    log.warn('[PRODUCT-METATAGS] No detected tags found or invalid detectedTags format, skipping suggestions generation');
    log.info(`[PRODUCT-METATAGS] Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and ${auditType} audit type.`);
    return;
  }
  let useHostnameOnly = false;
  try {
    const siteId = opportunity.getSiteId();
    const site = await context.dataAccess.Site.findById(siteId);
    useHostnameOnly = site?.getDeliveryConfig?.()?.useHostnameOnly ?? false;
  } catch (error) {
    log.error('[PRODUCT-METATAGS] Error in product-metatags configuration:', error);
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
  log.info(`[PRODUCT-METATAGS] Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and ${auditType} audit type.`);
}

// Extract product-specific meta tags from raw HTML
export function extractProductTagsFromHTML(rawBody, log) {
  const productTags = {};

  if (!rawBody || typeof rawBody !== 'string') {
    return productTags;
  }

  try {
    // Extract SKU meta tag (standard format)
    let skuMatch = rawBody.match(/<meta\s+name=["']sku["']\s+content=["']([^"']+)["']/i);
    if (skuMatch) {
      [, productTags.sku] = skuMatch;
    }

    // Try alternative SKU meta tag formats if not found
    if (!productTags.sku) {
      // Try product:sku property
      skuMatch = rawBody.match(/<meta\s+property=["']product:sku["']\s+content=["']([^"']+)["']/i);
      if (skuMatch) {
        [, productTags.sku] = skuMatch;
      }
    }

    // Try to extract SKU from JSON-LD structured data
    if (!productTags.sku) {
      const jsonLdMatch = rawBody.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdMatch) {
        for (const jsonLdScript of jsonLdMatch) {
          try {
            const jsonContent = jsonLdScript.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const data = JSON.parse(jsonContent);

            // Handle both single objects and arrays
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
              // Check for Product schema
              if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product'))) {
                if (item.sku) {
                  productTags.sku = item.sku;
                  break;
                }
                if (item.productID) {
                  productTags.sku = item.productID;
                  break;
                }
                if (item.mpn) {
                  productTags.sku = item.mpn;
                  break;
                }
              }
            }

            if (productTags.sku) break;
          } catch (jsonError) {
            // Continue to next JSON-LD block if parsing fails
            log.debug(`[PRODUCT-METATAGS] Failed to parse JSON-LD block: ${jsonError.message}`);
          }
        }
      }
    }

    // Try to extract SKU from common data attributes
    if (!productTags.sku) {
      const dataSkuMatch = rawBody.match(/data-(?:product-)?(?:sku|id|code)=["']([^"']+)["']/i);
      if (dataSkuMatch) {
        [, productTags.sku] = dataSkuMatch;
      }
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
    const productImageMatch = rawBody.match(/<meta\s+(?:name|property)=["']product:image["']\s+content=["']([^"']+)["']/i);
    if (productImageMatch) {
      [, productTags['product:image']] = productImageMatch;
    }

    // Extract generic image meta tag
    const imageMatch = rawBody.match(/<meta\s+name=["']image["']\s+content=["']([^"']+)["']/i);
    if (imageMatch) {
      [, productTags.image] = imageMatch;
    }

    // Try to extract image from JSON-LD structured data as fallback
    if (!productTags['og:image'] && !productTags['twitter:image'] && !productTags['product:image'] && !productTags.image) {
      const jsonLdMatch = rawBody.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdMatch) {
        for (const jsonLdScript of jsonLdMatch) {
          try {
            const jsonContent = jsonLdScript.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const data = JSON.parse(jsonContent);

            // Handle both single objects and arrays
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
              // Check for Product schema
              if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product'))) {
                // Try to get image from various possible fields
                if (item.image) {
                  // image can be a string, object with url property, or array
                  if (typeof item.image === 'string') {
                    productTags['og:image'] = item.image;
                    break;
                  } else if (typeof item.image === 'object' && item.image.url) {
                    productTags['og:image'] = item.image.url;
                    break;
                  } else if (Array.isArray(item.image) && item.image.length > 0) {
                    const firstImage = item.image[0];
                    productTags['og:image'] = typeof firstImage === 'string' ? firstImage : firstImage.url;
                    break;
                  }
                }
              }
            }

            if (productTags['og:image']) break;
          } catch (jsonError) {
            // Continue to next JSON-LD block if parsing fails
            log.debug(`[PRODUCT-METATAGS] Failed to parse JSON-LD block for image: ${jsonError.message}`);
          }
        }
      }
    }

    log.debug('[PRODUCT-METATAGS] Extracted product tags from HTML:', Object.keys(productTags));
  } catch (error) {
    log.warn(`[PRODUCT-METATAGS] Error extracting product tags from HTML: ${error.message}`);
  }

  return productTags;
}

export async function fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log) {
  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  if (!object?.scrapeResult?.tags || typeof object.scrapeResult.tags !== 'object') {
    log.error(`[PRODUCT-METATAGS] No Scraped tags found in S3 ${key} object`);
    return null;
  }
  // if the scrape result is empty, skip the page for product-metatags audit
  if (object?.scrapeResult?.rawBody?.length < 300) {
    log.error(`[PRODUCT-METATAGS] Scrape result is empty for ${key}`);
    return null;
  }

  let pageUrl = object.finalUrl ? new URL(object.finalUrl).pathname
    : key.slice(prefix.length - 1).replace('/scrape.json', ''); // Remove the prefix and scrape.json suffix
  // handling for homepage
  if (pageUrl === '') {
    pageUrl = '/';
  }

  // Debug: Log available tags to understand what scraper extracted
  log.debug(`[PRODUCT-METATAGS] Available tags in ${key}:`, Object.keys(object.scrapeResult.tags || {}));

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
export function extractEndpoint(url) {
  const urlObj = new URL(url);
  return urlObj.pathname.replace(/\/$/, '');
}

// Preprocess RUM data into a map with endpoint as the key
export function preprocessRumData(rumDataMonthly, rumDataBiMonthly) {
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
export function getOrganicTrafficForEndpoint(
  endpoint,
  rumDataMapMonthly,
  rumDataMapBiMonthly,
  log,
) {
  // remove trailing slash from endpoint, if present, and then find in the datamap
  const target = rumDataMapMonthly.get(endpoint.replace(/\/$/, ''))
    || rumDataMapBiMonthly.get(endpoint.replace(/\/$/, ''));
  if (!target) {
    log.warn(`[PRODUCT-METATAGS] No rum data found for ${endpoint}.`);
    return 0;
  }
  const trafficSum = target.earned + target.paid;
  log.info(`[PRODUCT-METATAGS] Found ${trafficSum} page views for ${endpoint}.`);
  return trafficSum;
}

// Calculate the projected traffic lost for a site
export async function calculateProjectedTraffic(context, site, detectedTags, log) {
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
    log.info(`[PRODUCT-METATAGS] Calculated cpc value: ${cpcValue} for site: ${site.getId()}`);
    const projectedTrafficValue = projectedTrafficLost * cpcValue;

    // Skip updating projected traffic data if lost traffic value is insignificant
    return projectedTrafficValue > PROJECTED_VALUE_THRESHOLD
      ? { projectedTrafficLost, projectedTrafficValue } : {};
  } catch (err) {
    log.warn(`[PRODUCT-METATAGS] Error while calculating projected traffic for ${site.getId()}`, err);
    return {};
  }
}

export async function productMetatagsAutoDetect(site, pagesSet, context) {
  const { log, s3Client } = context;

  log.info(`[PRODUCT-METATAGS] Starting auto-detection for site: ${site.getId()}`);
  log.info(`[PRODUCT-METATAGS] Pages to process: ${pagesSet.size}`);

  // Fetch site's scraped content from S3
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;

  log.info(`[PRODUCT-METATAGS] Fetching scraped content from S3 bucket: ${bucketName}, prefix: ${prefix}`);
  const scrapedObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, prefix, log);
  log.info(`[PRODUCT-METATAGS] Found ${scrapedObjectKeys.length} scraped objects in S3`);

  const extractedTags = {};
  const filteredKeys = scrapedObjectKeys.filter((key) => pagesSet.has(key));
  log.info(`[PRODUCT-METATAGS] Filtered to ${filteredKeys.length} keys that match our pages set`);

  if (filteredKeys.length === 0) {
    log.warn(`[PRODUCT-METATAGS] No matching scraped content found for any of the ${pagesSet.size} pages`);
    log.info('[PRODUCT-METATAGS] Pages set sample (first 5):', Array.from(pagesSet).slice(0, 5));
    log.info('[PRODUCT-METATAGS] S3 keys sample (first 5):', scrapedObjectKeys.slice(0, 5));
    log.warn('[PRODUCT-METATAGS] PATH MISMATCH DETECTED - Pages set and S3 keys do not overlap');
  } else {
    log.info('[PRODUCT-METATAGS] Successfully matched pages. Sample filtered keys:', filteredKeys.slice(0, 3));
  }

  const pageMetadataResults = await Promise.all(filteredKeys
    .map((key) => fetchAndProcessPageObject(s3Client, bucketName, key, prefix, log)));

  pageMetadataResults.forEach((pageMetadata) => {
    if (pageMetadata) {
      Object.assign(extractedTags, pageMetadata);
    }
  });

  const extractedTagsCount = Object.entries(extractedTags).length;
  log.info(`[PRODUCT-METATAGS] Extracted tags from ${extractedTagsCount} pages`);

  if (extractedTagsCount === 0) {
    log.error(`[PRODUCT-METATAGS] Failed to extract tags from scraped content for bucket ${bucketName} and prefix ${prefix}`);
  }

  // Perform SEO checks with product filtering
  log.info(`[PRODUCT-METATAGS] Performing product SEO checks for ${extractedTagsCount} tags`);
  const seoChecks = new ProductSeoChecks(log);
  let productPagesProcessed = 0;
  const totalPagesSet = new Set(Object.keys(extractedTags));

  for (const [pageUrl, pageTags] of Object.entries(extractedTags)) {
    // Check if page has product tags before processing
    const hasProductTags = ProductSeoChecks.hasProductTags(pageTags);

    log.debug(`[PRODUCT-METATAGS] Checking page ${pageUrl}: hasProductTags=${hasProductTags}, sku=${pageTags.sku || 'none'}`);

    if (hasProductTags) {
      log.info(`[PRODUCT-METATAGS] Processing product page: ${pageUrl}`);
      seoChecks.performChecks(pageUrl, pageTags);
      productPagesProcessed += 1;

      // Store product tags in detected tags for forwarding to suggestions
      const productTags = ProductSeoChecks.extractProductTags(pageTags);
      if (Object.keys(productTags).length > 0) {
        seoChecks.detectedTags[pageUrl] ??= {};
        seoChecks.detectedTags[pageUrl].productTags = productTags;
        log.info(`[PRODUCT-METATAGS] Extracted product tags for ${pageUrl}:`, Object.keys(productTags));
      }
    } else {
      log.debug(`[PRODUCT-METATAGS] Skipping non-product page: ${pageUrl} (no SKU found)`);
    }
  }

  log.info(`[PRODUCT-METATAGS] Product pages processed: ${productPagesProcessed} out of ${totalPagesSet.size} total pages`);

  seoChecks.finalChecks();
  const detectedTags = seoChecks.getDetectedTags();
  log.info(`[PRODUCT-METATAGS] Found ${Object.keys(detectedTags).length} product pages with issues out of ${productPagesProcessed} product pages processed (${extractedTagsCount} total pages)`);

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
export function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

export async function runAuditAndGenerateSuggestions(context) {
  const {
    site, audit, finalUrl, log, dataAccess,
  } = context;

  log.info('[PRODUCT-METATAGS] Starting runAuditAndGenerateSuggestions');
  log.info('[PRODUCT-METATAGS] Context:', {
    siteId: site.getId(),
    auditId: audit.getId(),
    finalUrl,
    hasDataAccess: !!dataAccess,
  });

  // Get top pages for a site
  const siteId = site.getId();
  log.info(`[PRODUCT-METATAGS] Getting top pages for siteId: ${siteId}`);

  const topPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
  log.info(`[PRODUCT-METATAGS] Retrieved ${topPages.length} top pages`);

  const includedURLs = await site?.getConfig()?.getIncludedURLs(auditType) || [];
  log.info(`[PRODUCT-METATAGS] Retrieved ${includedURLs.length} included URLs from site config`);

  // Transform URLs into scrape.json paths and combine them into a Set
  const topPagePaths = topPages.map((page) => getScrapeJsonPath(page.url, siteId));
  const includedUrlPaths = includedURLs.map((url) => getScrapeJsonPath(url, siteId));
  const totalPagesSet = new Set([...topPagePaths, ...includedUrlPaths]);

  log.info(`[PRODUCT-METATAGS] Received topPages: ${topPagePaths.length}, includedURLs: ${includedUrlPaths.length}, totalPages to process after removing duplicates: ${totalPagesSet.size}`);
  log.info('[PRODUCT-METATAGS] Sample generated paths:', Array.from(totalPagesSet).slice(0, 3));

  log.info('[PRODUCT-METATAGS] Starting product metatags auto-detection');
  const {
    seoChecks,
    detectedTags,
    extractedTags,
  } = await productMetatagsAutoDetect(site, totalPagesSet, context);

  log.info('[PRODUCT-METATAGS] Auto-detection completed:', {
    detectedTagsCount: Object.keys(detectedTags).length,
    extractedTagsCount: Object.keys(extractedTags).length,
    hasSeoChecks: !!seoChecks,
  });

  // Calculate projected traffic lost
  log.info('[PRODUCT-METATAGS] Calculating projected traffic');
  const {
    projectedTrafficLost,
    projectedTrafficValue,
  } = await calculateProjectedTraffic(
    context,
    site,
    detectedTags,
    log,
  );

  log.info('[PRODUCT-METATAGS] Projected traffic calculated:', {
    projectedTrafficLost,
    projectedTrafficValue,
  });

  // Generate AI suggestions for detected tags if auto-suggest enabled for site
  log.info('[PRODUCT-METATAGS] Starting AI auto-suggest');
  const allTags = {
    detectedTags,
    healthyTags: seoChecks.getFewHealthyTags(),
    extractedTags,
  };
  const updatedDetectedTags = await productMetatagsAutoSuggest(allTags, context, site);
  log.info(`[PRODUCT-METATAGS] AI auto-suggest completed, updated detected tags count: ${Object.keys(updatedDetectedTags || {}).length}`);

  const auditResult = {
    detectedTags: updatedDetectedTags || {},
    sourceS3Folder: `${context.env.S3_SCRAPER_BUCKET_NAME}/scrapes/${site.getId()}/`,
    fullAuditRef: '',
    finalUrl,
    ...(projectedTrafficLost && { projectedTrafficLost }),
    ...(projectedTrafficValue && { projectedTrafficValue }),
  };

  log.info('[PRODUCT-METATAGS] Audit result prepared:', {
    detectedTagsCount: Object.keys(auditResult.detectedTags).length,
    hasProjectedTrafficLost: !!auditResult.projectedTrafficLost,
    hasProjectedTrafficValue: !!auditResult.projectedTrafficValue,
    finalUrl: auditResult.finalUrl,
  });

  log.info('[PRODUCT-METATAGS] Creating opportunity and suggestions');
  await opportunityAndSuggestions(finalUrl, {
    siteId: site.getId(),
    auditId: audit.getId(),
    auditResult,
  }, context);

  log.info('[PRODUCT-METATAGS] Audit completed successfully');
  return {
    status: 'complete',
  };
}

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`[PRODUCT-METATAGS] Step 1: importTopPages started for site: ${site.getId()}`);
  log.info(`[PRODUCT-METATAGS] Final URL: ${finalUrl}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  const result = {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
  };

  log.info('[PRODUCT-METATAGS] Step 1: importTopPages completed, returning:', result);
  return result;
}

export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
  } = context;

  log.info(`[PRODUCT-METATAGS] Step 2: submitForScraping started for site: ${site.getId()}`);

  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  log.info(`[PRODUCT-METATAGS] Retrieved ${topPages.length} top pages from database`);

  const topPagesUrls = topPages.map((page) => page.getUrl());
  // Combine includedURLs and topPages URLs to scrape
  const includedURLs = await site?.getConfig()?.getIncludedURLs(auditType) || [];
  log.info(`[PRODUCT-METATAGS] Retrieved ${includedURLs.length} included URLs from site config`);

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(`[PRODUCT-METATAGS] Total top pages: ${topPagesUrls.length}, Total included URLs: ${includedURLs.length}, Final URLs to scrape after removing duplicates: ${finalUrls.length}`);

  if (finalUrls.length === 0) {
    log.error(`[PRODUCT-METATAGS] No URLs found for site ${site.getId()} - neither top pages nor included URLs`);
    throw new Error('No URLs found for site neither top pages nor included URLs');
  }

  const result = {
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'product-metatags',
  };

  log.info(`[PRODUCT-METATAGS] Step 2: submitForScraping completed, returning ${result.urls.length} URLs for scraping`);
  return result;
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
