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

import { composeBaseURL, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { retrievePageAuthentication } from '@adobe/spacecat-shared-ims-client';

import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { isPreviewPage } from '../utils/url-utils.js';
import {
  syncSuggestions,
  keepLatestMergeDataFunction,
} from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityDataForElmo } from './opportunity-data-mapper.js';
import { CANONICAL_CHECKS } from './constants.js';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';

/**
 * @import {type RequestOptions} from "@adobe/fetch"
*/

const auditType = Audit.AUDIT_TYPES.CANONICAL;
const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * Step 1: Import top pages (used in multi-step audit)
 */
export async function importTopPages(context) {
  const { site, finalUrl, log } = context;
  const s3BucketPath = `scrapes/${site.getId()}/`;

  log.info('CANONICAL[20012026] - importTopPages');
  log.info(`[canonical] importTopPages step requested for ${site.getId()}, bucket path: ${s3BucketPath}`);

  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
  };
}

/**
 * Step 2: Submit pages for scraping with JavaScript rendering
 */
export async function submitForScraping(context) {
  const {
    site, log, finalUrl, dataAccess,
  } = context;

  if (!dataAccess?.SiteTopPage) {
    const errorMsg = 'Missing SiteTopPage data access';
    log.info(`[canonical] ${errorMsg}`);
    return {
      auditResult: {
        status: 'PROCESSING_FAILED',
        error: errorMsg,
      },
      fullAuditRef: finalUrl,
    };
  }

  const { SiteTopPage } = dataAccess;

  log.info('CANONICAL[20012026] - submitForScraping');
  log.info(`Start submitForScraping step for: ${site.getId()}`);

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  log.info(`CANONICAL[20012026] - Found ${topPages?.length || 0} top pages for scraping`);

  if (!topPages || topPages.length === 0) {
    log.info(`No top pages found for site ${site.getId()}, skipping scraping`);
    return {
      auditResult: {
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      },
      fullAuditRef: finalUrl,
    };
  }

  const topPagesUrls = topPages.map((page) => page.getUrl());

  // Filter out auth pages and PDFs
  const shouldSkipAuthPage = (u) => {
    try {
      const pathname = new URL(u).pathname.toLowerCase();
      return pathname.includes('/login')
        || pathname.includes('/signin')
        || pathname.includes('/authenticate')
        || pathname.includes('/oauth')
        || pathname.includes('/sso')
        || pathname === '/auth'
        || pathname.startsWith('/auth/');
    } catch {
      return false;
    }
  };

  const isPdfUrl = (u) => {
    try {
      const pathname = new URL(u).pathname.toLowerCase();
      return pathname.endsWith('.pdf');
    } catch {
      return false;
    }
  };

  const filteredUrls = topPagesUrls.filter((url) => {
    if (shouldSkipAuthPage(url)) {
      log.info(`Skipping auth/login page: ${url}`);
      return false;
    }
    if (isPdfUrl(url)) {
      log.info(`Skipping PDF file: ${url}`);
      return false;
    }
    return true;
  });

  log.info(`CANONICAL[20012026] - After filtering: ${filteredUrls.length} pages will be scraped`);
  log.info(`CANONICAL[20012026] - Filtered URLs for scraping: ${JSON.stringify(filteredUrls)}`);
  log.info('CANONICAL[20012026] - finish submitForScraping');
  log.info(`Finish submitForScraping step for: ${site.getId()}`);

  return {
    auditResult: {
      status: 'scraping',
    },
    fullAuditRef: finalUrl,
    // Data for the SCRAPE_CLIENT
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

/**
 * Validates the format of a canonical URL against a base URL.
 *
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @param {string} baseUrl - The base URL to compare against.
 * @param log
 * @param {boolean} isPreview - Whether the URL is for a preview page.
 * @returns {Array<Object>} Array of check results.
 */
export function validateCanonicalFormat(canonicalUrl, baseUrl, log, isPreview = false) {
  log.info('CANONICAL[20012026] - validateCanonicalFormat');

  const checks = [];
  let base;

  try {
    base = new URL(baseUrl);
  } catch {
    log.error(`Invalid URL: ${baseUrl}`);
    // Skip adding check for invalid URL - validation errors should only be logged
    return checks;
  }

  // Check if the canonical URL is fully uppercased
  if (canonicalUrl) {
    if (typeof canonicalUrl === 'string') {
      const isAllCaps = canonicalUrl === canonicalUrl.toUpperCase();
      if (isAllCaps) {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.explanation,
        });
        log.info(`Canonical URL is fully uppercased: ${canonicalUrl}`);
      } else {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.check,
          success: true,
        });
      }
    } else {
      log.error(`Canonical URL is not a string: ${typeof canonicalUrl}`);
      // Skip adding check for invalid type - validation errors should only be logged
      return checks;
    }
  }

  // Check if the canonical URL is absolute (case-insensitive protocol check)
  const lowerCanonical = canonicalUrl.toLowerCase();
  if (!lowerCanonical.startsWith('http://') && !lowerCanonical.startsWith('https://')) {
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.check,
      success: false,
      explanation: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.explanation,
    });
    log.info('Canonical URL is not absolute');
  } else {
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.check,
      success: true,
    });
    let url;

    try {
      url = new URL(canonicalUrl);
    } catch {
      log.error(`Invalid canonical URL: ${canonicalUrl}`);
      // Skip adding check for invalid URL - validation errors should only be logged
      return checks;
    }

    // Check if the canonical URL has the same protocol as the base URL
    if (!url.href.startsWith(base.protocol)) {
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.explanation,
      });
      log.info(`Canonical URL  ${canonicalUrl} uses a different protocol than base URL ${baseUrl}`);
    } else {
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_SAME_PROTOCOL.check,
        success: true,
      });
    }

    // Check if the canonical URL has the same domain as the base URL
    if (!isPreview) {
      if (composeBaseURL(url.hostname) !== composeBaseURL(base.hostname)) {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.explanation,
        });
        log.info(`Canonical URL ${canonicalUrl} does not have the same domain as base URL ${baseUrl}`);
      } else {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_SAME_DOMAIN.check,
          success: true,
        });
      }
    }
  }

  return checks;
}

/**
 * Recursively validates the contents of a canonical URL.
 *
 * @param {string} canonicalUrl - The canonical URL to validate.
 * @param {Object} log - The logging object to log information.
 * @param {RequestOptions} options - The options object to pass to the fetch function.
 * @param {Set<string>} [visitedUrls=new Set()] - A set of visited URLs to detect redirect loops.
 * @returns {Promise<Object>} An object with the check result and any error if the check failed.
 */
export async function validateCanonicalRecursively(
  canonicalUrl,
  log,
  options = {},
  visitedUrls = new Set(),
) {
  log.info('CANONICAL[20012026] - validateCanonicalRecursively');

  const checks = [];

  // Check for redirect loops
  if (visitedUrls.has(canonicalUrl)) {
    log.info(`Detected a redirect loop for canonical URL ${canonicalUrl}`);
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
      success: false,
      explanation: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.explanation,
    });
    return checks;
  }

  // Add the current URL to the visited set
  visitedUrls.add(canonicalUrl);

  try {
    const response = await fetch(canonicalUrl, { ...options, redirect: 'manual' });
    if (response.ok) {
      log.info(`Canonical URL is accessible: ${canonicalUrl}, statusCode: ${response.status}`);
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_STATUS_OK.check,
        success: true,
      });
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
        success: true,
      });
    } else if ([301, 302, 303, 307, 308].includes(response.status)) {
      log.info(`Canonical URL ${canonicalUrl} returned a 3xx status: ${response.status}`);
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.explanation,
      });
    } else if (response.status >= 400 && response.status < 500) {
      log.info(`Canonical URL ${canonicalUrl} returned a 4xx error: ${response.status}`);
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_4XX.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_4XX.explanation,
      });
    } else if (response.status >= 500) {
      log.info(`Canonical URL ${canonicalUrl} returned a 5xx error: ${response.status} `);
      checks.push({
        check: CANONICAL_CHECKS.CANONICAL_URL_5XX.check,
        success: false,
        explanation: CANONICAL_CHECKS.CANONICAL_URL_5XX.explanation,
      });
    } else {
      log.info(`Unexpected status code ${response.status} for canonical URL: ${canonicalUrl}`);
      checks.push({
        check: CANONICAL_CHECKS.UNEXPECTED_STATUS_CODE.check,
        success: false,
        explanation: CANONICAL_CHECKS.UNEXPECTED_STATUS_CODE.explanation,
      });
    }
  } catch (error) {
    log.error(`Error fetching canonical URL ${canonicalUrl}: ${error.message}`);
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.check,
      success: false,
      explanation: CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.explanation,
    });
  }

  return checks;
}

/**
 * Generates a suggestion for fixing a canonical issue based on the check type.
 *
 * @param {string} checkType - The type of canonical check that failed.
 * @returns {string} A suggestion for fixing the canonical issue.
 */
export function generateCanonicalSuggestion(checkType) {
  const checkObj = Object.values(CANONICAL_CHECKS).find((check) => check.check === checkType);

  if (checkObj && checkObj.suggestion) {
    return checkObj.suggestion;
  }

  // fallback suggestion
  return 'Review and fix the canonical tag implementation according to SEO best practices.';
}

/**
 * Step 3: Process scraped content and generate audit results
 */
/* c8 ignore start */
export async function processScrapedContent(context) {
  const {
    site, audit, log, s3Client, env,
  } = context;
  const baseURL = site.getBaseURL();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  log.info('CANONICAL[20012026] - processScrapedContent - START');
  log.info(`CANONICAL[20012026] - Processing site: ${site.getId()}, baseURL: ${baseURL}`);

  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for canonical audit';
    log.error(`CANONICAL[20012026] - ERROR: ${errorMsg}`);
    return {
      auditResult: {
        status: 'PROCESSING_FAILED',
        error: errorMsg,
      },
      fullAuditRef: baseURL,
    };
  }

  log.info(`CANONICAL[20012026] - S3 bucket: ${bucketName}`);

  // Get scraped content from S3
  const prefix = `scrapes/${site.getId()}/`;
  log.info(`CANONICAL[20012026] - Fetching scraped content from S3 prefix: ${prefix}`);
  let scrapeKeys;
  try {
    scrapeKeys = await getObjectKeysUsingPrefix(
      s3Client,
      bucketName,
      prefix,
      log,
      1000,
      'scrape.json',
    );
    log.info(`CANONICAL[20012026] - Found ${scrapeKeys.length} scraped objects in S3 for site ${site.getId()}`);
  } catch (error) {
    log.error(`CANONICAL[20012026] - ERROR retrieving S3 keys for site ${site.getId()}: ${error.message}`);
    return {
      auditResult: {
        status: 'PROCESSING_FAILED',
        error: `Failed to retrieve scraped content: ${error.message}`,
      },
      fullAuditRef: baseURL,
    };
  }

  if (scrapeKeys.length === 0) {
    log.info(`CANONICAL[20012026] - No scraped content found for site ${site.getId()}`);
    return {
      auditResult: {
        status: 'NO_OPPORTUNITIES',
        message: 'No scraped content found',
      },
      fullAuditRef: baseURL,
    };
  }

  log.info(`CANONICAL[20012026] - Starting to process ${scrapeKeys.length} pages`);

  // Process each scraped page
  const auditPromises = scrapeKeys.map(async (key) => {
    try {
      log.info(`CANONICAL[20012026] - Fetching scraped object from S3: ${key}`);
      const scrapedObject = await getObjectFromKey(s3Client, bucketName, key, log);

      if (!scrapedObject?.scrapeResult?.canonical) {
        log.warn(`CANONICAL[20012026] - No canonical metadata in S3 object: ${key}`);
        return null;
      }

      const url = scrapedObject.url || scrapedObject.finalUrl;
      if (!url) {
        log.warn(`CANONICAL[20012026] - No URL found in S3 object: ${key}`);
        return null;
      }

      const finalUrl = scrapedObject.finalUrl || url;
      const isPreview = isPreviewPage(baseURL);

      log.info(`CANONICAL[20012026] - Processing URL: ${url}`);

      // Use canonical metadata already extracted by the scraper (Puppeteer)
      const canonicalMetadata = scrapedObject.scrapeResult.canonical;
      const canonicalUrl = canonicalMetadata.href || null;
      log.info(`CANONICAL[20012026] - Canonical metadata for ${url}: exists=${canonicalMetadata.exists}, count=${canonicalMetadata.count}, inHead=${canonicalMetadata.inHead}, href=${canonicalUrl || 'null'}`);
      const canonicalTagChecks = [];

      // Check if canonical tag exists
      if (!canonicalMetadata.exists || !canonicalUrl) {
        log.info(`CANONICAL[20012026] - Missing canonical tag for ${url}`);
        canonicalTagChecks.push({
          check: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.explanation,
        });
      } else {
        // Canonical tag exists
        log.info(`CANONICAL[20012026] - Canonical tag found for ${url}`);
        canonicalTagChecks.push({
          check: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.check,
          success: true,
        });

        // Check if canonical is in <head>
        if (!canonicalMetadata.inHead) {
          log.info(`CANONICAL[20012026] - Canonical tag outside <head> for ${url}`);
          canonicalTagChecks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.explanation,
          });
        } else {
          canonicalTagChecks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_OUTSIDE_HEAD.check,
            success: true,
          });
        }

        // Check if there are multiple canonical tags
        if (canonicalMetadata.count > 1) {
          log.info(`CANONICAL[20012026] - Multiple canonical tags (${canonicalMetadata.count}) for ${url}`);
          canonicalTagChecks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE.explanation,
          });
        } else {
          canonicalTagChecks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_MULTIPLE.check,
            success: true,
          });
        }

        // Check if canonical is nonempty
        if (!canonicalUrl || canonicalUrl.trim() === '') {
          canonicalTagChecks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.explanation,
          });
        } else {
          canonicalTagChecks.push({
            check: CANONICAL_CHECKS.CANONICAL_TAG_EMPTY.check,
            success: true,
          });
        }

        // Check if canonical is self-referenced (ignoring protocol and case)
        const normalizeUrl = (u) => {
          try {
            const urlObj = new URL(u);
            // Remove protocol, lowercase everything, keep host and path
            return `${urlObj.host}${urlObj.pathname}${urlObj.search}${urlObj.hash}`.toLowerCase();
          } catch {
            return u.toLowerCase();
          }
        };
        const normalizedCanonical = normalizeUrl(canonicalUrl);
        const normalizedFinal = normalizeUrl(finalUrl);
        const normalizedOriginal = normalizeUrl(url);
        const isSelfReferenced = normalizedCanonical === normalizedFinal
          || normalizedCanonical === normalizedOriginal;
        if (isSelfReferenced) {
          canonicalTagChecks.push({
            check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
            success: true,
          });
        } else {
          canonicalTagChecks.push({
            check: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
            success: false,
            explanation: CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.explanation,
          });
        }
      }

      const checks = [...canonicalTagChecks];

      if (canonicalUrl) {
        log.info(`CANONICAL[20012026] - Validating canonical URL format: ${canonicalUrl}`);

        const urlFormatChecks = validateCanonicalFormat(canonicalUrl, baseURL, log, isPreview);
        checks.push(...urlFormatChecks);

        // self-reference check
        const selfRefCheck = canonicalTagChecks.find(
          (c) => c.check === CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
        );
        const isSelfReferenced = selfRefCheck?.success === true;
        log.info(`CANONICAL[20012026] - Self-referenced check for ${url}: ${isSelfReferenced}`);

        // if self-referenced - skip accessibility
        if (isSelfReferenced) {
          log.info(`CANONICAL[20012026] - Canonical is self-referenced, skipping accessibility check for ${url}`);
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_URL_STATUS_OK.check,
            success: true,
          });
          checks.push({
            check: CANONICAL_CHECKS.CANONICAL_URL_NO_REDIRECT.check,
            success: true,
          });
        } else {
          // if not self-referenced - validate accessibility
          log.info(`CANONICAL[20012026] - Canonical URL points to different page, validating accessibility: ${canonicalUrl}`);

          const options = {};
          if (isPreview) {
            try {
              log.info(`Retrieving page authentication for pageUrl ${baseURL}`);
              const token = await retrievePageAuthentication(site, context);
              options.headers = {
                Authorization: `token ${token}`,
              };
            } catch (error) {
              log.error(`Error retrieving page authentication for pageUrl ${baseURL}: ${error.message}`);
            }
          }

          const urlContentCheck = await validateCanonicalRecursively(canonicalUrl, log, options);
          checks.push(...urlContentCheck);
        }
      }

      return { url, checks };
    } catch (error) {
      log.error(`Error processing scraped content from ${key}: ${error.message}`);
      return null;
    }
  });

  const auditResultsArray = await Promise.allSettled(auditPromises);
  log.info(`CANONICAL[20012026] - Completed processing ${auditResultsArray.length} pages`);

  // Aggregate results
  log.info('CANONICAL[20012026] - Aggregating results');
  const aggregatedResults = auditResultsArray.reduce((acc, result) => {
    if (result.status === 'fulfilled' && result.value) {
      const { url, checks } = result.value;
      checks.forEach((check) => {
        const { check: checkType, success, explanation } = check;

        // only process failed checks
        if (success === false) {
          if (!acc[checkType]) {
            acc[checkType] = {
              explanation,
              urls: [],
            };
          }
          acc[checkType].urls.push(url);
        }
      });
    }
    return acc;
  }, {});

  const filteredAggregatedResults = Object.fromEntries(
    Object.entries(aggregatedResults).filter(
      ([checkType]) => checkType !== CANONICAL_CHECKS.CANONICAL_URL_FETCH_ERROR.check,
    ),
  );

  log.info(`CANONICAL[20012026] - Found ${Object.keys(filteredAggregatedResults).length} issue types`);
  log.info(`CANONICAL[20012026] - Successfully completed canonical audit for site: ${baseURL}`);

  // all checks are successful, no issues were found
  if (Object.keys(filteredAggregatedResults).length === 0) {
    log.info(`CANONICAL[20012026] - No canonical issues detected for ${baseURL}`);
    return {
      fullAuditRef: baseURL,
      auditResult: {
        status: 'success',
        message: 'No canonical issues detected',
      },
    };
  }

  // final results structure
  const results = Object.entries(filteredAggregatedResults).map(([checkType, checkData]) => ({
    type: checkType,
    explanation: checkData.explanation,
    affectedUrls: checkData.urls.map((url) => ({
      url,
      suggestion: generateCanonicalSuggestion(checkType),
    })),
  }));

  // Generate suggestions from audit results
  log.info('CANONICAL[20012026] - Generating canonical suggestions');
  const auditTypeOrder = [...Object.keys(CANONICAL_CHECKS)];
  const suggestionsByType = {};
  const allSuggestions = [];

  // transform audit results into suggestions
  results.forEach((issue) => {
    const checkType = issue.type;
    if (!suggestionsByType[checkType]) {
      suggestionsByType[checkType] = [];
    }

    issue.affectedUrls.forEach((urlData) => {
      const suggestion = {
        type: 'CODE_CHANGE',
        checkType: issue.type,
        url: urlData.url,
        suggestion: urlData.suggestion,
      };

      suggestionsByType[checkType].push(suggestion);
      allSuggestions.push(suggestion);
    });
  });

  // Sort suggestions by audit type order
  const sortedSuggestions = allSuggestions.sort((a, b) => {
    const indexA = auditTypeOrder.indexOf(a.checkType);
    const indexB = auditTypeOrder.indexOf(b.checkType);
    return indexA - indexB;
  });

  log.info(`Generated ${sortedSuggestions.length} canonical suggestions for ${baseURL}`);

  // Create opportunities and sync suggestions
  if (sortedSuggestions.length > 0) {
    log.info(`CANONICAL[20012026] - Creating canonical opportunity and syncing ${sortedSuggestions.length} suggestions`);

    const opportunity = await convertToOpportunity(
      baseURL,
      { auditResult: results, siteId: site.getId(), id: audit.getId() },
      context,
      createOpportunityData,
      auditType,
    );

    const buildKey = (suggestion) => `${suggestion.checkType}|${suggestion.url}`;

    await syncSuggestions({
      opportunity,
      newData: sortedSuggestions,
      context,
      buildKey,
      mapNewSuggestion: (suggestion) => ({
        opportunityId: opportunity.getId(),
        type: suggestion.type,
        rank: 0,
        data: {
          type: 'url',
          url: suggestion.url,
          checkType: suggestion.checkType,
          suggestion: suggestion.suggestion,
        },
      }),
      keepLatestMergeDataFunction,
      log,
    });

    log.info(`CANONICAL[20012026] - Canonical opportunity created with ID: ${opportunity.getId()}`);
    log.info(`CANONICAL[20012026] - Successfully synced ${sortedSuggestions.length} suggestions for ${baseURL}`);
  }

  // Create Elmo suggestions
  log.info('CANONICAL[20012026] - Generating Elmo suggestions');
  const elmoSuggestions = [];
  Object.entries(suggestionsByType).forEach(([checkType, suggestions]) => {
    if (suggestions.length > 0) {
      const checkConfig = Object.values(CANONICAL_CHECKS).find((c) => c.check === checkType);
      if (checkConfig) {
        elmoSuggestions.push({
          type: checkType,
          checkName: checkConfig.name,
          explanation: checkConfig.explanation,
          seoImpact: checkConfig.seoImpact,
          recommendedAction: checkConfig.recommendedAction,
          affectedCount: suggestions.length,
        });
      }
    }
  });

  // Create Elmo opportunity if there are suggestions
  if (elmoSuggestions.length > 0) {
    log.info(`CANONICAL[20012026] - Creating canonical opportunity for Elmo with ${elmoSuggestions.length} suggestions`);

    const elmoOpportunityType = 'generic-opportunity';
    const comparisonFn = (oppty) => {
      const opptyData = oppty.getData();
      const opptyAdditionalMetrics = opptyData?.additionalMetrics;
      if (!opptyAdditionalMetrics || !Array.isArray(opptyAdditionalMetrics)) {
        return false;
      }
      return opptyAdditionalMetrics.some(
        (metric) => metric.key === 'subtype' && metric.value === 'canonical',
      );
    };

    const opportunity = await convertToOpportunity(
      baseURL,
      {
        elmoSuggestions, auditResult: results, siteId: site.getId(), id: audit.getId(),
      },
      context,
      createOpportunityDataForElmo,
      elmoOpportunityType,
      {},
      comparisonFn,
    );

    log.info(`Canonical opportunity created for Elmo with oppty id ${opportunity.getId()}`);

    const buildKey = (suggestion) => `${suggestion.type}`;
    await syncSuggestions({
      opportunity,
      newData: elmoSuggestions,
      context,
      buildKey,
      mapNewSuggestion: (suggestion) => ({
        opportunityId: opportunity.getId(),
        type: suggestion.type,
        rank: 0,
        data: {
          suggestionValue: suggestion.recommendedAction,
        },
      }),
      keepLatestMergeDataFunction,
      log,
    });

    log.info(`CANONICAL[20012026] - Canonical opportunity created for Elmo with oppty id ${opportunity.getId()}`);
    log.info(`CANONICAL[20012026] - Successfully synced ${elmoSuggestions.length} Elmo suggestions for ${baseURL}`);
  }

  return {
    fullAuditRef: baseURL,
    auditResult: results,
  };
}
/* c8 ignore stop */

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .addStep('importTopPages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submitForScraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('processScrapedContent', processScrapedContent)
  .build();
