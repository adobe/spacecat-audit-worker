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
import { hasText } from '@adobe/spacecat-shared-utils';
import { calculateCPCValue } from '../support/utils.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import ProductSeoChecks from './seo-checks.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import productMetatagsAutoSuggest from './product-metatags-auto-suggest.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getIssueRanking } from '../utils/seo-utils.js';
import { getBaseUrl } from '../utils/url-utils.js';
import {
  DESCRIPTION,
  H1,
  PROJECTED_VALUE_THRESHOLD,
  TITLE,
} from './constants.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { getCommerceConfig } from '../utils/saas.js';

const auditType = Audit.AUDIT_TYPES.PRODUCT_METATAGS;
const { AUDIT_STEP_DESTINATIONS } = Audit;

export function buildSuggestionKey(data) {
  const url = data?.url || 'unknown-url';
  const issue = data?.issue || 'unknown-issue';
  const tagContent = data?.tagContent || '';
  return `${url}|${issue}|${tagContent}`;
}

/**
 * Extracts locale from URL based on product URL template pattern.
 * @param {string} url - The full URL to extract locale from
 * @param {string} productUrlTemplate - Template like "%baseUrl/%locale/products/%urlKey"
 * @param {Object} log - Logger instance
 * @returns {string} Extracted locale or empty string if not found
 */
export function extractLocaleFromUrl(url, productUrlTemplate, log) {
  if (!hasText(productUrlTemplate) || !hasText(url)) {
    log.debug(`[PRODUCT-METATAGS] No product URL template or URL provided, using empty locale for url: ${url}`);
    return '';
  }

  try {
    // Parse the URL to get pathname
    const { pathname } = new URL(url);

    // Split template and pathname by '/'
    const templateParts = productUrlTemplate.split('/').filter((part) => part);
    const pathParts = pathname.split('/').filter((part) => part);

    // Find the index of %locale in the template
    const localeIndex = templateParts.findIndex((part) => part === '%locale');

    if (localeIndex === -1) {
      log.debug('[PRODUCT-METATAGS] No %locale found in product URL template, using empty locale');
      return '';
    }

    // Account for %baseUrl which doesn't appear in pathname
    const baseUrlIndex = templateParts.findIndex((part) => part === '%baseUrl');
    const offset = baseUrlIndex !== -1 && baseUrlIndex < localeIndex ? 1 : 0;
    const actualLocaleIndex = localeIndex - offset;

    // Extract locale from the corresponding position in the pathname
    if (actualLocaleIndex >= 0 && actualLocaleIndex < pathParts.length) {
      const locale = pathParts[actualLocaleIndex];
      log.debug(`[PRODUCT-METATAGS] Extracted locale "${locale}" from URL ${url} using template ${productUrlTemplate}`);
      return locale;
    }

    log.debug(`[PRODUCT-METATAGS] Could not extract locale from URL ${url}, using empty locale`);
    return '';
  } catch (error) {
    log.warn(`[PRODUCT-METATAGS] Error extracting locale from URL ${url}: ${error.message}`);
    return '';
  }
}

/**
 * Creates a memoized version of getCommerceConfig to avoid redundant fetches.
 * @param {Function} getCommerceConfigFn - The original getCommerceConfig function
 * @returns {Function} Memoized version of the function
 */
export function createMemoizedCommerceConfig(getCommerceConfigFn) {
  const cache = new Map();

  return async function memoizedGetCommerceConfig(site, auditTypeParam, finalUrlParam, log, locale = '') {
    // Create cache key from all parameters
    const cacheKey = `${site.getId()}|${auditTypeParam}|${finalUrlParam}|${locale}`;

    if (cache.has(cacheKey)) {
      log.debug(`[PRODUCT-METATAGS] Using cached commerce config for site "${site.getId()}", url "${finalUrlParam}", locale "${locale}"`);
      return cache.get(cacheKey);
    }

    try {
      const result = await getCommerceConfigFn(site, auditTypeParam, finalUrlParam, log, locale);
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      log.debug(`[PRODUCT-METATAGS] Failed to fetch commerce config for site "${site.getId()}", url "${finalUrlParam}", locale "${locale}": ${error.message}`);
      // Cache empty object for failed fetches to avoid retrying
      cache.set(cacheKey, {});
      return {};
    }
  };
}

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

  // Fetch site configuration once for all suggestions
  let useHostnameOnly = false;
  let site = null;
  let customConfig = null;
  let productUrlTemplate = null;
  let memoizedGetCommerceConfig = null;

  try {
    const siteId = opportunity.getSiteId();
    site = await context.dataAccess.Site.findById(siteId);
    useHostnameOnly = site?.getDeliveryConfig?.()?.useHostnameOnly ?? false;

    // Get handler configuration for locale extraction and commerce config
    customConfig = site?.getConfig?.()?.getHandlers?.()?.[auditType];
    productUrlTemplate = customConfig?.product_url_template;

    // Initialize memoized commerce config function
    memoizedGetCommerceConfig = createMemoizedCommerceConfig(getCommerceConfig);

    log.debug('[PRODUCT-METATAGS] Site configuration loaded:', {
      hasCustomConfig: !!customConfig,
      hasProductUrlTemplate: !!productUrlTemplate,
    });
  } catch (error) {
    log.error('[PRODUCT-METATAGS] Error loading site configuration:', error);
  }

  const suggestions = [];
  const invalidSuggestions = [];

  // Generate suggestions data to be inserted in product-metatags opportunity suggestions
  for (const endpoint of Object.keys(detectedTags)) {
    // Construct full URL once per endpoint
    const baseUrl = getBaseUrl(auditData.auditResult.finalUrl, useHostnameOnly);
    const fullUrl = baseUrl + endpoint;

    // Fetch commerce configuration once per endpoint (with locale extraction and memoization)
    // eslint-disable-next-line no-await-in-loop
    let endpointConfig = {};
    if (site && memoizedGetCommerceConfig) {
      try {
        const locale = extractLocaleFromUrl(fullUrl, productUrlTemplate, log);
        // eslint-disable-next-line no-await-in-loop
        const config = await memoizedGetCommerceConfig(
          site,
          auditType,
          finalUrl,
          log,
          locale,
        );
        endpointConfig = config || {};

        // Log extracted config details
        const configKeys = Object.keys(endpointConfig);
        if (configKeys.length > 0) {
          log.debug(`[PRODUCT-METATAGS] Extracted config for ${fullUrl} (locale: "${locale}"): ${JSON.stringify(config)}`);
        } else {
          log.debug(`[PRODUCT-METATAGS] Empty config for ${fullUrl} (locale: "${locale}")`);
        }
      } catch (configError) {
        log.debug(`[PRODUCT-METATAGS] Failed to fetch config for ${fullUrl}: ${configError.message}`);
        endpointConfig = {};
      }
    } else {
      log.debug(`[PRODUCT-METATAGS] No site or memoized config function available for ${fullUrl}`);
    }

    for (const tag of [TITLE, DESCRIPTION, H1]) {
      if (detectedTags[endpoint]?.[tag]?.issue) {
        try {
          const tagData = detectedTags[endpoint][tag];
          const rank = getIssueRanking(tag, tagData.issue);

          // Validate required fields
          let isValid = true;
          if (!hasText(tagData.issue)) {
            log.warn(`[PRODUCT-METATAGS] Missing issue for ${fullUrl}, tag: ${tag}`);
            invalidSuggestions.push({ endpoint, tag, reason: 'missing issue' });
            isValid = false;
          } else if (rank === undefined || rank === null || rank < 0) {
            log.warn(`[PRODUCT-METATAGS] Invalid rank (${rank}) for ${fullUrl}, tag: ${tag}, issue: ${tagData.issue}`);
            invalidSuggestions.push({ endpoint, tag, reason: `invalid rank: ${rank}` });
            isValid = false;
          } else if (!hasText(fullUrl)) {
            /* c8 ignore next 3 */ // fullUrl is constructed via concatenation and is a string
            log.warn(`[PRODUCT-METATAGS] Invalid URL for endpoint: ${endpoint}, tag: ${tag}`);
            invalidSuggestions.push({ endpoint, tag, reason: 'invalid URL' });
            isValid = false;
          }

          if (isValid) {
            // Build suggestion object with validated data
            const suggestion = {
              ...tagData,
              tagName: tag,
              url: fullUrl,
              rank,
            };

            // Add product-specific data (SKU and image) to each suggestion
            if (detectedTags[endpoint]?.productTags) {
              suggestion.productTags = detectedTags[endpoint].productTags;
            }

            // Add commerce configuration (fetched once per endpoint)
            suggestion.config = endpointConfig;

            // Log suggestion details for debugging
            log.debug(`[PRODUCT-METATAGS] Created suggestion for ${fullUrl}: issue="${tagData.issue}", rank=${rank}, tagName=${tag}`);

            suggestions.push(suggestion);
          }
        } catch (error) {
          log.error(`[PRODUCT-METATAGS] Error creating suggestion for endpoint ${endpoint}, tag ${tag}:`, error);
          invalidSuggestions.push({ endpoint, tag, reason: error.message });
        }
      }
    }
  }

  log.info(`[PRODUCT-METATAGS] Generated ${suggestions.length} valid suggestions and ${invalidSuggestions.length} invalid suggestions`);

  if (invalidSuggestions.length > 0) {
    log.warn('[PRODUCT-METATAGS] Invalid suggestions summary:', invalidSuggestions.slice(0, 10));
  }

  if (suggestions.length === 0) {
    log.warn('[PRODUCT-METATAGS] No valid suggestions to sync');
    log.info(`[PRODUCT-METATAGS] Successfully synced Opportunity And Suggestions for site: ${auditData.siteId} and ${auditType} audit type.`);
    return;
  }

  const buildKey = buildSuggestionKey;

  // Sync the suggestions from new audit with old ones
  try {
    await syncSuggestions({
      opportunity,
      newData: suggestions,
      context,
      buildKey,
      mapNewSuggestion: (suggestion) => {
        // Validate suggestion before mapping
        if (suggestion.rank === undefined || suggestion.rank === null || suggestion.rank < 0) {
          log.error(`[PRODUCT-METATAGS] Invalid rank in mapNewSuggestion: ${suggestion.rank}`, { url: suggestion.url, issue: suggestion.issue });
        }

        // Destructure rank out to avoid duplicate in data field
        const { rank, ...suggestionData } = suggestion;

        return {
          opportunityId: opportunity.getId(),
          type: 'METADATA_UPDATE',
          rank,
          data: suggestionData,
        };
      },
    });
    log.info(`[PRODUCT-METATAGS] Successfully synced ${suggestions.length} suggestions for site: ${auditData.siteId} and ${auditType} audit type.`);
  } catch (error) {
    log.error(`[PRODUCT-METATAGS] Error syncing suggestions for site ${auditData.siteId}:`, error);
    throw error;
  }
}

// Extract product-specific meta tags from JSON-LD structured data
export function extractProductTagsFromStructuredData(structuredData, log) {
  const productTags = {};

  if (!structuredData?.jsonld) {
    return productTags;
  }

  try {
    const { Product } = structuredData.jsonld;

    // Extract from the first Product in the array
    if (Array.isArray(Product) && Product.length > 0) {
      const product = Product[0];

      // Extract SKU
      if (product.sku) {
        productTags.sku = product.sku;
      }

      // Extract image (handle different formats: string, object, or array)
      if (product.image) {
        if (typeof product.image === 'string') {
          productTags.thumbnail = product.image;
        } else if (typeof product.image === 'object' && product.image.url) {
          productTags.thumbnail = product.image.url;
        } else if (Array.isArray(product.image) && product.image.length > 0) {
          const firstImage = product.image[0];
          productTags.thumbnail = typeof firstImage === 'string' ? firstImage : firstImage.url;
        }
      }

      log.debug('[PRODUCT-METATAGS] Extracted from structured data:', Object.keys(productTags));
    }
  } catch (error) {
    log.warn(`[PRODUCT-METATAGS] Error extracting from structured data: ${error.message}`);
  }

  return productTags;
}

export async function fetchAndProcessPageObject(s3Client, bucketName, url, key, log) {
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

  // Handle empty or invalid URLs gracefully
  let pageUrl;
  try {
    if (object.finalUrl) {
      pageUrl = new URL(object.finalUrl).pathname;
    } else if (url) {
      pageUrl = new URL(url).pathname;
    } else {
      pageUrl = '/';
    }
  } catch (urlError) {
    // If URL parsing fails, try to extract pathname from S3 key format
    // e.g., 'scrapes/site-id/products/item/scrape.json' -> '/products/item'
    if (url && url.includes('/')) {
      const parts = url.split('/');
      // Remove 'scrapes', site-id, and 'scrape.json' to get the pathname
      const pathParts = parts.slice(2, -1); // Skip first 2 parts and last part
      pageUrl = pathParts.length > 0 ? `/${pathParts.join('/')}` : '/';
    } else {
      pageUrl = '/';
    }
  }

  // Debug: Log available tags to understand what scraper extracted
  log.debug(`[PRODUCT-METATAGS] Available tags in ${key}:`, Object.keys(object.scrapeResult.tags || {}));

  // Extract product-specific meta tags from structured data
  const productTags = extractProductTagsFromStructuredData(object.scrapeResult.structuredData, log);

  // Filter out pages without SKU - only process product pages
  if (!productTags.sku) {
    log.debug(`[PRODUCT-METATAGS] Skipping page ${pageUrl} - no SKU found`);
    return null;
  }

  log.debug(`[PRODUCT-METATAGS] Product page detected: ${pageUrl} (SKU: ${productTags.sku})`);

  return {
    [pageUrl]: {
      title: object.scrapeResult.tags.title,
      description: object.scrapeResult.tags.description,
      h1: object.scrapeResult.tags.h1 || [],
      // Use client-side extracted product tags
      sku: productTags.sku,
      thumbnail: productTags.thumbnail,
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
      // Iterate over tag values, filtering out non-issue properties like productTags
      Object.entries(tags).forEach(([tagName, tagIssueDetails]) => {
        // Skip non-issue properties (like productTags) and tags without issues
        if (tagName === 'productTags' || !tagIssueDetails?.issue) return;

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

export async function productMetatagsAutoDetect(site, pagesMap, context) {
  const { log, s3Client } = context;

  log.info(`[PRODUCT-METATAGS] Starting auto-detection for site: ${site.getId()}`);
  log.info(`[PRODUCT-METATAGS] Pages to process: ${pagesMap?.size || 0}`);

  // Fetch site's scraped content from S3
  const bucketName = context.env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `scrapes/${site.getId()}/`;

  const extractedTags = {};

  // Ensure pagesMap is iterable
  if (!pagesMap || typeof pagesMap[Symbol.iterator] !== 'function') {
    log.error('[PRODUCT-METATAGS] pagesMap is not iterable');
    const emptySeoChecks = new ProductSeoChecks(log);
    return {
      seoChecks: emptySeoChecks,
      detectedTags: {},
      extractedTags: {},
    };
  }

  const pageMetadataResults = await Promise.all([...pagesMap]
    .map(([url, path]) => fetchAndProcessPageObject(s3Client, bucketName, url, path, log)));

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
        // Add the scraped title alongside SKU and thumbnail
        productTags.title = pageTags.title;
        seoChecks.detectedTags[pageUrl].productTags = productTags;
        log.debug(`[PRODUCT-METATAGS] Extracted product tags for ${pageUrl}:`, Object.keys(productTags));
      }
    } else {
      log.debug(`[PRODUCT-METATAGS] Skipping non-product page: ${pageUrl} (no SKU found)`);
    }
  }

  log.info(`[PRODUCT-METATAGS] Product pages processed: ${productPagesProcessed} out of ${totalPagesSet.size} total pages`);

  seoChecks.finalChecks();
  const detectedTags = seoChecks.getDetectedTags();
  log.info(`[PRODUCT-METATAGS] Found ${Object.keys(detectedTags).length} product pages with issues out of ${productPagesProcessed} product pages processed (${extractedTagsCount} total pages)`);

  // Log detailed breakdown of detected issues
  const issueBreakdown = {};
  Object.entries(detectedTags).forEach(([, tags]) => {
    Object.entries(tags).forEach(([tagName, tagData]) => {
      // Skip non-tag entries like 'productTags'
      if (tagName !== 'productTags' && tagData?.issue) {
        const issueType = tagData.issue;
        issueBreakdown[issueType] = (issueBreakdown[issueType] || 0) + 1;
      }
    });
  });

  if (Object.keys(issueBreakdown).length > 0) {
    log.info('[PRODUCT-METATAGS] Issue breakdown:', issueBreakdown);
  }

  return {
    seoChecks,
    detectedTags,
    extractedTags,
  };
}

// Exported helper to make conditional auditResult construction directly testable
export function buildProductMetatagsAuditResult(
  updatedDetectedTags,
  finalUrl,
  projectedTrafficLost,
  projectedTrafficValue,
  context,
  site,
) {
  return {
    detectedTags: updatedDetectedTags || {},
    sourceS3Folder: `${context.env.S3_SCRAPER_BUCKET_NAME}/scrapes/${site.getId()}/`,
    fullAuditRef: '',
    finalUrl,
    ...(projectedTrafficLost && { projectedTrafficLost }),
    ...(projectedTrafficValue && { projectedTrafficValue }),
  };
}

export async function runAuditAndGenerateSuggestions(context) {
  const {
    site, audit, finalUrl, log, scrapeResultPaths,
  } = context;

  log.info('[PRODUCT-METATAGS] Starting runAuditAndGenerateSuggestions');
  log.info('[PRODUCT-METATAGS] Context:', {
    siteId: site.getId(),
    auditId: audit.getId(),
    finalUrl,
    hasScrapeResultPaths: !!scrapeResultPaths,
    scrapeResultPathsSize: scrapeResultPaths?.size || 0,
  });

  log.info(scrapeResultPaths);
  const {
    seoChecks,
    detectedTags,
    extractedTags,
  } = await productMetatagsAutoDetect(site, scrapeResultPaths, context);

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

  const auditResult = buildProductMetatagsAuditResult(
    updatedDetectedTags,
    finalUrl,
    projectedTrafficLost,
    projectedTrafficValue,
    context,
    site,
  );

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
  log.info(`[PRODUCT-METATAGS] reading site config: ${JSON.stringify(site?.getConfig())}`);
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
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
