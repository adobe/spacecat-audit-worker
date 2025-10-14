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
import { getObjectFromKey } from '../utils/s3-utils.js';
import ProductSeoChecks from './seo-checks.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import productMetatagsAutoSuggest from './product-metatags-auto-suggest.js';
import { convertToOpportunity } from '../common/opportunity.js';
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

export function buildSuggestionKey(data) {
  const url = data?.url || 'unknown-url';
  const issue = data?.issue || 'unknown-issue';
  const tagContent = data?.tagContent || '';
  return `${url}|${issue}|${tagContent}`;
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
  let useHostnameOnly = false;
  try {
    const siteId = opportunity.getSiteId();
    const site = await context.dataAccess.Site.findById(siteId);
    useHostnameOnly = site?.getDeliveryConfig?.()?.useHostnameOnly ?? false;
  } catch (error) {
    log.error('[PRODUCT-METATAGS] Error in product-metatags configuration:', error);
  }
  const suggestions = [];
  const invalidSuggestions = [];

  // Generate suggestions data to be inserted in product-metatags opportunity suggestions
  Object.keys(detectedTags)
    .forEach((endpoint) => {
      [TITLE, DESCRIPTION, H1].forEach((tag) => {
        if (detectedTags[endpoint]?.[tag]?.issue) {
          try {
            const tagData = detectedTags[endpoint][tag];
            const baseUrl = getBaseUrl(auditData.auditResult.finalUrl, useHostnameOnly);
            const fullUrl = baseUrl + endpoint;
            const rank = getIssueRanking(tag, tagData.issue);

            // Validate required fields
            /* c8 ignore next 5 */ // Unreachable due to outer guard
            if (!tagData.issue) {
              log.warn(`[PRODUCT-METATAGS] Missing issue for ${fullUrl}, tag: ${tag}`);
              invalidSuggestions.push({ endpoint, tag, reason: 'missing issue' });
              return;
            }

            if (rank === undefined || rank === null || rank < 0) {
              log.warn(`[PRODUCT-METATAGS] Invalid rank (${rank}) for ${fullUrl}, tag: ${tag}, issue: ${tagData.issue}`);
              invalidSuggestions.push({ endpoint, tag, reason: `invalid rank: ${rank}` });
              return;
            }

            /* c8 ignore next 5 */ // fullUrl is constructed via concatenation and is a string
            if (!fullUrl || typeof fullUrl !== 'string') {
              log.warn(`[PRODUCT-METATAGS] Invalid URL for endpoint: ${endpoint}, tag: ${tag}`);
              invalidSuggestions.push({ endpoint, tag, reason: 'invalid URL' });
              return;
            }

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

            // Log suggestion details for debugging
            log.debug(`[PRODUCT-METATAGS] Created suggestion for ${fullUrl}: issue="${tagData.issue}", rank=${rank}, tagName=${tag}`);

            suggestions.push(suggestion);
          } catch (error) {
            log.error(`[PRODUCT-METATAGS] Error creating suggestion for endpoint ${endpoint}, tag ${tag}:`, error);
            invalidSuggestions.push({ endpoint, tag, reason: error.message });
          }
        }
      });
    });

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

// Extract product-specific meta tags from raw HTML
export function extractProductTagsFromHTML(rawBody, log) {
  const productTags = {};

  if (!rawBody || typeof rawBody !== 'string') {
    return productTags;
  }

  // Track if this is the first page being processed (for detailed logging)
  const isFirstPage = !extractProductTagsFromHTML.hasLoggedSample;

  try {
    // Log HTML sample for debugging (first 500 chars of head section if available)
    const headMatch = rawBody.match(/<head[^>]*>([\s\S]{0,500})/i);
    if (isFirstPage) {
      if (headMatch) {
        log.info(`[PRODUCT-METATAGS] SAMPLE HTML HEAD: ${headMatch[1].substring(0, 400)}...`);
      } else {
        log.warn(`[PRODUCT-METATAGS] SAMPLE PAGE: No <head> tag found. HTML starts: ${rawBody.substring(0, 400)}...`);
      }
      extractProductTagsFromHTML.hasLoggedSample = true;
    }
    if (!headMatch && !isFirstPage) {
      log.debug('[PRODUCT-METATAGS] No <head> tag found in this page');
    }

    // Extract SKU meta tag (standard format)
    let skuMatch = rawBody.match(/<meta\s+name=["']sku["']\s+content=["']([^"']+)["']/i);
    if (skuMatch) {
      [, productTags.sku] = skuMatch;
      log.debug(`[PRODUCT-METATAGS] Extracted SKU from meta tag: ${productTags.sku}`);
    } else {
      // Debug: Check if SKU meta tag exists but doesn't match our pattern
      const skuMetaExists = rawBody.includes('name="sku"') || rawBody.includes("name='sku'");
      if (skuMetaExists) {
        log.warn('[PRODUCT-METATAGS] SKU meta tag found but regex did not match. Sample:', rawBody.substring(rawBody.indexOf('sku') - 50, rawBody.indexOf('sku') + 100));
      } else {
        log.debug('[PRODUCT-METATAGS] No SKU meta tag found in HTML');
      }
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
        log.debug(`[PRODUCT-METATAGS] Found ${jsonLdMatch.length} JSON-LD script(s)`);
        for (const jsonLdScript of jsonLdMatch) {
          try {
            const jsonContent = jsonLdScript.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const data = JSON.parse(jsonContent);
            log.debug(`[PRODUCT-METATAGS] Parsed JSON-LD with @type: ${data['@type'] || data['@graph']?.[0]?.['@type'] || 'unknown'}`);

            // Handle @graph structures (e.g., bulk.com), single objects, and arrays
            let items = [];
            if (data['@graph'] && Array.isArray(data['@graph'])) {
              items = data['@graph'];
            } else if (Array.isArray(data)) {
              items = data;
            } else {
              items = [data];
            }

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

    // Extract image and store under 'thumbnail' property
    // Priority: generic image -> product:image -> og:image -> twitter:image -> JSON-LD fallback

    // 1. Try generic image meta tag first
    const imageMatch = rawBody.match(/<meta\s+name=["']image["']\s+content=["']([^"']+)["']/i);
    if (imageMatch) {
      [, productTags.thumbnail] = imageMatch;
    }

    // 2. Try product:image meta tag
    if (!productTags.thumbnail) {
      const productImageMatch = rawBody.match(/<meta\s+(?:name|property)=["']product:image["']\s+content=["']([^"']+)["']/i);
      if (productImageMatch) {
        [, productTags.thumbnail] = productImageMatch;
      }
    }

    // 3. Try og:image meta tag
    if (!productTags.thumbnail) {
      const ogImageMatch = rawBody.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      if (ogImageMatch) {
        [, productTags.thumbnail] = ogImageMatch;
      }
    }

    // 4. Try twitter:image meta tag
    if (!productTags.thumbnail) {
      const twitterImageMatch = rawBody.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
      if (twitterImageMatch) {
        [, productTags.thumbnail] = twitterImageMatch;
      }
    }

    // 5. Try to extract image from JSON-LD structured data as fallback
    if (!productTags.thumbnail) {
      const jsonLdMatch = rawBody.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (jsonLdMatch) {
        for (const jsonLdScript of jsonLdMatch) {
          try {
            const jsonContent = jsonLdScript.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const data = JSON.parse(jsonContent);

            // Handle @graph structures (e.g., bulk.com), single objects, and arrays
            let items = [];
            if (data['@graph'] && Array.isArray(data['@graph'])) {
              items = data['@graph'];
            } else if (Array.isArray(data)) {
              items = data;
            } else {
              items = [data];
            }

            for (const item of items) {
              // Check for Product schema
              if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product'))) {
                // Try to get image from various possible fields
                if (item.image) {
                  // image can be a string, object with url property, or array
                  if (typeof item.image === 'string') {
                    productTags.thumbnail = item.image;
                    break;
                  } else if (typeof item.image === 'object' && item.image.url) {
                    productTags.thumbnail = item.image.url;
                    break;
                  } else if (Array.isArray(item.image) && item.image.length > 0) {
                    const firstImage = item.image[0];
                    productTags.thumbnail = typeof firstImage === 'string' ? firstImage : firstImage.url;
                    break;
                  }
                }
              }
            }

            if (productTags.thumbnail) break;
          } catch (jsonError) {
            // Continue to next JSON-LD block if parsing fails
            log.debug(`[PRODUCT-METATAGS] Failed to parse JSON-LD block for image: ${jsonError.message}`);
          }
        }
      }
    }

    if (Object.keys(productTags).length === 0) {
      log.info('[PRODUCT-METATAGS] No product tags extracted. HTML length:', rawBody.length, 'Has meta tags:', rawBody.includes('<meta'), 'Has JSON-LD:', rawBody.includes('application/ld+json'));
    } else {
      log.info('[PRODUCT-METATAGS] Successfully extracted product tags:', {
        hasSku: !!productTags.sku,
        skuValue: productTags.sku,
        hasThumbnail: !!productTags.thumbnail,
      });
    }
  } catch (error) {
    log.warn(`[PRODUCT-METATAGS] Error extracting product tags from HTML: ${error.message}`);
  }

  return productTags;
}

export async function fetchAndProcessPageObject(s3Client, bucketName, url, key, log) {
  log.debug(`[PRODUCT-METATAGS] Fetching from S3: ${key}`);

  const object = await getObjectFromKey(s3Client, bucketName, key, log);
  log.debug(`[PRODUCT-METATAGS] scrape result props: ${Object.keys(object?.scrapeResult || {})}`);
  log.debug(`[PRODUCT-METATAGS] scrape result tags: ${Object.entries(object?.scrapeResult?.tags || {})}`);

  if (!object?.scrapeResult?.tags || typeof object.scrapeResult.tags !== 'object') {
    log.error(`[PRODUCT-METATAGS] No Scraped tags found in S3 ${key} object`);
    return null;
  }

  const rawBodyLength = object?.scrapeResult?.rawBody?.length || 0;

  // if the scrape result is empty, skip the page for product-metatags audit
  if (rawBodyLength < 300) {
    log.error(`[PRODUCT-METATAGS] Scrape result is empty for ${key} (length: ${rawBodyLength})`);
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
  log.debug(`[PRODUCT-METATAGS] Available tags in ${key}:`, Object.keys(object.scrapeResult.tags));

  // Extract product-specific meta tags
  // from raw HTML since scraper doesn't support custom extraction
  log.debug(`[PRODUCT-METATAGS] Extracting product tags from rawBody for ${pageUrl}...`);
  const productTags = extractProductTagsFromHTML(object.scrapeResult.rawBody, log);

  const result = {
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

  if (productTags.sku) {
    log.info(`[PRODUCT-METATAGS] Product page detected: ${pageUrl} (SKU: ${productTags.sku})`);
  } else {
    log.debug(`[PRODUCT-METATAGS] No SKU found for ${pageUrl} (rawBodyLength=${object.scrapeResult.rawBody.length})`);
  }

  return result;
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
      // Iterate only over SEO tag names (title, description, h1) - following metatags pattern
      [TITLE, DESCRIPTION, H1].forEach((tagName) => {
        const tagIssueDetails = tags[tagName];
        // Skip if tag doesn't have an issue
        if (!tagIssueDetails?.issue) return;

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

  log.info(`[PRODUCT-METATAGS] Fetching ${pagesMap.size} pages from S3...`);
  const pageMetadataResults = await Promise.all([...pagesMap]
    .map(([url, path]) => fetchAndProcessPageObject(s3Client, bucketName, url, path, log)));

  const nullResults = pageMetadataResults.filter((r) => r === null).length;
  const validResults = pageMetadataResults.filter((r) => r !== null).length;
  log.info(`[PRODUCT-METATAGS] S3 fetch results: ${validResults} valid, ${nullResults} null/empty`);

  pageMetadataResults.forEach((pageMetadata) => {
    if (pageMetadata) {
      Object.assign(extractedTags, pageMetadata);
    }
  });

  const extractedTagsCount = Object.entries(extractedTags).length;
  log.info(`[PRODUCT-METATAGS] Extracted tags from ${extractedTagsCount} pages: ${Object.entries(extractedTags)}`);

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

    // TEMPORARILY DISABLED: SKU filtering - process all pages for now
    // if (hasProductTags) {
    log.info(`[PRODUCT-METATAGS] Processing page: ${pageUrl} (hasSku=${hasProductTags})`);
    seoChecks.performChecks(pageUrl, pageTags);
    productPagesProcessed += 1;

    // Store product tags in detected tags for forwarding to suggestions
    const productTags = ProductSeoChecks.extractProductTags(pageTags);
    if (Object.keys(productTags).length > 0) {
      seoChecks.detectedTags[pageUrl] ??= {};
      seoChecks.detectedTags[pageUrl].productTags = productTags;
      log.debug(`[PRODUCT-METATAGS] Extracted product tags for ${pageUrl}:`, Object.keys(productTags));
    }
    // } else {
    //   log.debug(`[PRODUCT-METATAGS] Skipping non-product page: ${pageUrl} (no SKU found)`);
    // }
  }

  log.info(`[PRODUCT-METATAGS] Product pages processed: ${productPagesProcessed} out of ${totalPagesSet.size} total pages`);

  // TEMPORARILY DISABLED: This warning is unreachable when SKU filtering is disabled
  // Log sample of product vs non-product pages for debugging
  // if (productPagesProcessed === 0 && extractedTagsCount > 0) {
  //   const samplePages = Object.entries(extractedTags).slice(0, 3);
  //   log.warn('[PRODUCT-METATAGS] No product pages detected! Sample of pages checked:');
  //   samplePages.forEach(([url, tags]) => {
  //     log.warn(`  - ${url}:
  // hasSku=${!!tags.sku}, title=${tags.title?.substring(0, 50) || 'none'}`);
  //   });
  // }

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

  log.info(`[PRODUCT-METATAGS] Step 2: submitForScraping completed, returning ${result.urls.length} URLs with enableJavascript=true, hideConsentBanners=true`);
  return result;
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
