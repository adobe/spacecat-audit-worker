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
import { isPreviewPage, isPdfUrl } from '../utils/url-utils.js';
import {
  syncSuggestions,
  keepLatestMergeDataFunction,
} from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData, createOpportunityDataForElmo } from './opportunity-data-mapper.js';
import { CANONICAL_CHECKS } from './constants.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { isAuthUrl } from '../support/utils.js';

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

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  log.info(`[canonical] Found ${topPages?.length || 0} top pages for scraping`);

  if (!topPages || topPages.length === 0) {
    log.info(`[canonical] No top pages found for site ${site.getId()}, skipping scraping`);
    return {
      auditResult: {
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      },
      fullAuditRef: finalUrl,
    };
  }

  const topPagesUrls = topPages.map((page) => page.getUrl());

  // Filter out auth pages and PDFs before scraping
  const filteredUrls = topPagesUrls.filter((url) => {
    if (isAuthUrl(url)) {
      return false;
    }
    if (isPdfUrl(url)) {
      return false;
    }
    return true;
  });

  log.info(`[canonical] After filtering: ${filteredUrls.length} pages will be scraped - ${JSON.stringify(filteredUrls)}`);

  // Note: Do NOT return auditResult/fullAuditRef for steps with SCRAPE_CLIENT destination
  // These are intermediate steps; the scraper will trigger the next step when complete
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
      } else {
        checks.push({
          check: CANONICAL_CHECKS.CANONICAL_URL_LOWERCASED.check,
          success: true,
        });
      }
    } else {
      log.error(`[canonical] Canonical URL is not a string: ${typeof canonicalUrl}`);
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
  } else {
    checks.push({
      check: CANONICAL_CHECKS.CANONICAL_URL_ABSOLUTE.check,
      success: true,
    });
    let url;

    try {
      url = new URL(canonicalUrl);
    } catch {
      log.error(`[canonical] Invalid canonical URL: ${canonicalUrl}`);
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
/**
 * Retrieves authentication options for preview pages
 * @param {boolean} isPreview - Whether the page is a preview page
 * @param {string} baseURL - The base URL
 * @param {object} site - Site object
 * @param {object} context - Audit context
 * @param {object} log - Logger
 * @returns {Promise<object>} Options object with headers if authentication is successful
 */
export async function getPreviewAuthOptions(isPreview, baseURL, site, context, log) {
  const options = {};
  if (isPreview) {
    try {
      const token = await retrievePageAuthentication(site, context);
      options.headers = {
        Authorization: `token ${token}`,
      };
    } catch (error) {
      log.error(`[canonical] Error retrieving page authentication for pageUrl ${baseURL}: ${error.message}`);
    }
  }
  return options;
}

export async function validateCanonicalRecursively(
  canonicalUrl,
  log,
  options = {},
  visitedUrls = new Set(),
) {
  const checks = [];

  // Check for redirect loops
  if (visitedUrls.has(canonicalUrl)) {
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
export async function processScrapedContent(context) {
  const {
    site, audit, log, s3Client, env, scrapeResultPaths,
  } = context;
  const baseURL = site.getBaseURL();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;

  if (!bucketName) {
    const errorMsg = 'Missing S3 bucket configuration for canonical audit';
    log.error(`[canonical] ERROR: ${errorMsg}`);
    return {
      auditResult: {
        status: 'PROCESSING_FAILED',
        error: errorMsg,
      },
      fullAuditRef: baseURL,
    };
  }

  // Check if scrapeResultPaths is provided (new SCRAPE_CLIENT flow)
  if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
    log.info(`[canonical] No scrapeResultPaths found for site ${site.getId()}`);
    return {
      auditResult: {
        status: 'NO_OPPORTUNITIES',
        message: 'No scraped content found',
      },
      fullAuditRef: baseURL,
    };
  }

  // Convert Map to array of S3 keys
  const scrapeKeys = Array.from(scrapeResultPaths.values());
  log.info(`[canonical] Found ${scrapeKeys.length} scraped objects from scrapeResultPaths, starting to process ${scrapeKeys.length} pages`);

  // Process each scraped page
  const auditPromises = scrapeKeys.map(async (key) => {
    try {
      const scrapedObject = await getObjectFromKey(s3Client, bucketName, key, log);

      // If the scrape result is empty, skip the page for canonical audit
      if (scrapedObject?.scrapeResult?.rawBody?.length < 300) {
        log.warn(`[canonical] Scrape result is empty for ${key} (rawBody length: ${scrapedObject?.scrapeResult?.rawBody?.length || 0})`);
        return null;
      }

      if (!scrapedObject?.scrapeResult?.canonical) {
        log.warn(`[canonical] No canonical metadata in S3 object: ${key}`);
        return null;
      }

      const url = scrapedObject.url || scrapedObject.finalUrl;
      if (!url) {
        log.warn(`[canonical] No URL found in S3 object: ${key}`);
        return null;
      }

      const finalUrl = scrapedObject.finalUrl || url;

      // Filter out scraped pages that redirected to auth/login pages or PDFs
      // This prevents false positives when a legitimate page redirects to login
      if (isAuthUrl(finalUrl)) {
        log.info(`[canonical] Skipping ${url} - redirected to auth page: ${finalUrl}`);
        return null;
      }
      if (isPdfUrl(finalUrl)) {
        log.info(`[canonical] Skipping ${url} - redirected to PDF: ${finalUrl}`);
        return null;
      }

      const isPreview = isPreviewPage(baseURL);

      // Use canonical metadata already extracted by the scraper (Puppeteer)
      const canonicalMetadata = scrapedObject.scrapeResult.canonical;
      const canonicalUrl = canonicalMetadata.href || null;
      const canonicalTagChecks = [];

      // Check if canonical tag exists
      if (!canonicalMetadata.exists || !canonicalUrl) {
        canonicalTagChecks.push({
          check: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.check,
          success: false,
          explanation: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.explanation,
        });
      } else {
        // Canonical tag exists
        canonicalTagChecks.push({
          check: CANONICAL_CHECKS.CANONICAL_TAG_MISSING.check,
          success: true,
        });

        // Check if canonical is in <head>
        if (!canonicalMetadata.inHead) {
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

        // Check if canonical is self-referenced (ignoring protocol, domain, query, hash, case)
        const normalizeUrl = (u) => {
          try {
            const urlObj = new URL(u);
            // Remove protocol, domain, query params, and hash; lowercase; keep only pathname
            return urlObj.pathname.toLowerCase();
          } catch {
            return u.toLowerCase();
          }
        };
        const normalizedCanonical = normalizeUrl(canonicalUrl);
        const normalizedFinal = normalizeUrl(finalUrl);

        // Canonical should match the final URL path (what was actually served)
        const isSelfReferenced = normalizedCanonical === normalizedFinal;
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
        const urlFormatChecks = validateCanonicalFormat(canonicalUrl, baseURL, log, isPreview);
        checks.push(...urlFormatChecks);

        // self-reference check
        const selfRefCheck = canonicalTagChecks.find(
          (c) => c.check === CANONICAL_CHECKS.CANONICAL_SELF_REFERENCED.check,
        );
        const isSelfReferenced = selfRefCheck?.success === true;

        // if self-referenced - skip accessibility
        if (isSelfReferenced) {
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

          const options = await getPreviewAuthOptions(isPreview, baseURL, site, context, log);

          const urlContentCheck = await validateCanonicalRecursively(canonicalUrl, log, options);
          checks.push(...urlContentCheck);
        }
      }

      return { url, checks };
    } catch (error) {
      log.error(`[canonical] Error processing scraped content from ${key}: ${error.message}`);
      return null;
    }
  });

  const auditResultsArray = await Promise.allSettled(auditPromises);
  log.info(`[canonical] Completed processing ${auditResultsArray.length} pages`);

  // Aggregate results
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

  log.info(`[canonical] Successfully completed canonical audit for site: ${baseURL}. Found ${Object.keys(filteredAggregatedResults).length} issue types`);

  // all checks are successful, no issues were found
  if (Object.keys(filteredAggregatedResults).length === 0) {
    log.info(`[canonical] No canonical issues detected for ${baseURL}`);
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
        explanation: issue.explanation,
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

  log.info(`[canonical] Generated ${sortedSuggestions.length} canonical suggestions for ${baseURL}`);

  // Create opportunities and sync suggestions
  if (sortedSuggestions.length > 0) {
    log.info(`[canonical] Creating canonical opportunity and syncing ${sortedSuggestions.length} suggestions`);

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
          explanation: suggestion.explanation,
        },
      }),
      keepLatestMergeDataFunction,
      log,
    });

    log.info(`[canonical] Canonical opportunity created with ID: ${opportunity.getId()}`);
    log.info(`[canonical] Successfully synced ${sortedSuggestions.length} suggestions for ${baseURL}`);
  }

  // Create Elmo suggestions
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
    log.info(`[canonical] Creating canonical opportunity for Elmo with ${elmoSuggestions.length} suggestions`);

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

    log.info(`[canonical] Canonical opportunity created for Elmo with oppty id ${opportunity.getId()}`);

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

    log.info(`[canonical] Canonical opportunity created for Elmo with oppty id ${opportunity.getId()}`);
    log.info(`[canonical] Successfully synced ${elmoSuggestions.length} Elmo suggestions for ${baseURL}`);
  }

  return {
    fullAuditRef: baseURL,
    auditResult: results,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .addStep('importTopPages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submitForScraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('processScrapedContent', processScrapedContent)
  .build();
