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

/**
 * STANDALONE Script to validate broken internal link suggestions marked as FIXED.
 * This version is self-contained and doesn't depend on internal helpers.
 * 
 * For each suggestion:
 * 1. Scrapes the url_from page (where the broken link was found)
 * 2. Checks if the url_to link still exists on that page
 * 3. If present, validates if the link is still broken
 * 4. Returns suggestions where links are present AND still broken (not truly fixed)
 */

import { load as cheerioLoad } from 'cheerio';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { Audit, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';

const PAGE_FETCH_TIMEOUT = 5000;
const LINK_TIMEOUT = 5000;
const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;
const MAX_CONCURRENT_CHECKS = 5;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Spacecat/1.0';

/**
 * Check if error is a timeout error
 */
function isTimeoutError(error) {
  return error.code === 'ETIMEOUT' || error.message?.includes('timeout');
}

/**
 * Checks if a URL is inaccessible (broken link).
 * Standalone version copied from helpers.js
 */
async function isLinkInaccessible(url, log) {
  // First try HEAD request (faster, lighter)
  try {
    const headResponse = await fetch(url, {
      method: 'HEAD',
      timeout: LINK_TIMEOUT,
      headers: { 'User-Agent': USER_AGENT },
    });
    const { status } = headResponse;

    // If HEAD returns success (2xx) or redirect (3xx), consider it accessible
    if (status < 400) {
      return false;
    }

    // If HEAD confirms it's broken (404 or 5xx), no need to verify with GET
    if (status === 404 || status >= 500) {
      log.info(`✗ BROKEN LINK: ${url} (HEAD ${status})`);
      return true;
    }

    // For other client errors (401, 403, etc.), verify with GET
    if (status >= 400 && status < 500) {
      log.debug(`HEAD returned ${status} for ${url}, verifying with GET`);
    }
  } catch (headError) {
    // If HEAD timed out, treat as accessible (could be rate limiting)
    if (isTimeoutError(headError)) {
      log.info(`⏱ TIMEOUT: ${url} (HEAD timed out, assuming accessible)`);
      return false;
    }

    // For other errors, try GET
    log.debug(`HEAD failed for ${url}, trying GET: ${headError.message}`);
  }

  // Fallback to GET request
  try {
    const getResponse = await fetch(url, {
      method: 'GET',
      timeout: LINK_TIMEOUT,
      headers: { 'User-Agent': USER_AGENT },
    });
    const { status } = getResponse;

    if (status >= 400 && status < 500 && status !== 404) {
      log.warn(`⚠ WARNING: ${url} returned ${status}`);
    }

    const isBroken = status >= 400;
    if (isBroken) {
      log.info(`✗ BROKEN LINK: ${url} (GET ${status})`);
    }
    return isBroken;
  } catch (getError) {
    // If GET also timed out, treat as accessible
    if (isTimeoutError(getError)) {
      log.info(`⏱ TIMEOUT: ${url} (GET timed out, assuming accessible)`);
      return false;
    }

    // Network errors - treat as broken
    log.warn(`Network error for ${url}: ${getError.message}`);
    return true;
  }
}

/**
 * Fetches and parses HTML from a URL.
 */
async function fetchPageHtml(url, log) {
  try {
    const response = await fetch(url, {
      timeout: PAGE_FETCH_TIMEOUT,
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) {
      return {
        html: null,
        error: `HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    return { html, error: null };
  } catch (error) {
    log.debug(`Failed to fetch ${url}: ${error.message}`);
    return {
      html: null,
      error: isTimeoutError(error)
        ? `Timeout after ${PAGE_FETCH_TIMEOUT}ms`
        : error.message,
    };
  }
}

/**
 * Checks if a specific link (urlTo) exists on a page (urlFrom).
 * Searches for the link in the page HTML, excluding header/footer.
 */
async function checkLinkExistsOnPage(urlFrom, urlTo, log) {
  const { html, error } = await fetchPageHtml(urlFrom, log);

  if (error) {
    return { linkExists: false, error };
  }

  try {
    const $ = cheerioLoad(html);
    let linkFound = false;

    // Normalize target URL for comparison (remove trailing slashes, fragments)
    const normalizedTarget = urlTo.split('#')[0].replace(/\/$/, '');

    // Search for links excluding header/footer
    $('a[href]').each((_, el) => {
      const $a = $(el);
      if ($a.closest('header').length || $a.closest('footer').length) return;

      const href = $a.attr('href');
      if (!href) return;

      try {
        const absoluteUrl = new URL(href, urlFrom).toString();
        const normalizedAbsolute = absoluteUrl.split('#')[0].replace(/\/$/, '');

        if (normalizedAbsolute === normalizedTarget) {
          linkFound = true;
          return false; // Break out of .each()
        }
      } catch (urlError) {
        // Skip invalid URLs
      }
    });

    return { linkExists: linkFound, error: null };
  } catch (parseError) {
    log.debug(`Failed to parse HTML from ${urlFrom}: ${parseError.message}`);
    return { linkExists: false, error: `Parse error: ${parseError.message}` };
  }
}

/**
 * Validates a single suggestion by checking if the link still exists and is broken.
 */
async function validateSuggestion({
  suggestion, opportunityId, opportunityStatus, siteId, log, hasFixEntity, fixCount,
}) {
  const suggestionData = suggestion.getData();
  const urlFrom = suggestionData?.urlFrom;
  const urlTo = suggestionData?.urlTo;

  if (!urlFrom || !urlTo) {
    return {
      type: 'missing-data',
      suggestionId: suggestion.getId(),
      opportunityId,
      opportunityStatus,
      siteId,
      hasFixEntity,
      fixCount,
      error: 'Missing urlFrom or urlTo',
    };
  }

  // Step 1: Check if the link still exists on the page
  const { linkExists, error: scrapeError } = await checkLinkExistsOnPage(urlFrom, urlTo, log);

  log.debug(`[validate] Checked ${urlTo} on ${urlFrom}: linkExists=${linkExists}, error=${scrapeError}, hasFixEntity=${hasFixEntity}`);

  if (scrapeError) {
    return {
      type: 'scrape-error',
      suggestionId: suggestion.getId(),
      opportunityId,
      opportunityStatus,
      siteId,
      urlFrom,
      urlTo,
      hasFixEntity,
      fixCount,
      error: scrapeError,
    };
  }

  if (!linkExists) {
    // Link removed from page = genuinely fixed
    return {
      type: 'link-removed',
      suggestionId: suggestion.getId(),
      opportunityId,
      opportunityStatus,
      siteId,
      urlFrom,
      urlTo,
      hasFixEntity,
      fixCount,
      isStillBroken: false,
    };
  }

  log.debug(`[validate] Link ${urlTo} FOUND on page ${urlFrom}, checking if broken...`);

  // Step 2: Link still exists, check if it's still broken
  const isBroken = await isLinkInaccessible(urlTo, log);

  if (isBroken) {
    log.debug(`[validate] Link check result: ${urlTo} is BROKEN (isBroken=${isBroken})`);
  }

  return {
    type: isBroken ? 'still-broken' : 'now-working',
    suggestionId: suggestion.getId(),
    opportunityId,
    opportunityStatus,
    siteId,
    urlFrom,
    urlTo,
    title: suggestionData?.title,
    hasFixEntity,
    fixCount,
    isStillBroken: isBroken,
  };
}

/**
 * Process items in batches with concurrency limit.
 */
async function processWithConcurrency(items, processor, concurrency) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const promise = processor(item).then((result) => {
      executing.delete(promise);
      return result;
    });

    results.push(promise);
    executing.add(promise);

    if (executing.size >= concurrency) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

/**
 * Validates suggestions marked as FIXED for broken internal links.
 */
export async function validateFixedSuggestions({ dataAccess, log, siteId, csvStream = null }) {
  const { Suggestion, Opportunity } = dataAccess;

  if (!siteId) {
    throw new Error('[validate-fixed-suggestions] siteId is required');
  }

  log.info('[validate-fixed-suggestions] Starting validation of FIXED suggestions for broken internal links');
  log.info(`[validate-fixed-suggestions] Site ID: ${siteId}`);

  // Find all opportunities for broken internal links for the given site
  const siteOpportunities = await Opportunity.allBySiteId(siteId);
  const opportunities = siteOpportunities.filter((oppty) => oppty.getType() === AUDIT_TYPE);

  log.info(`[validate-fixed-suggestions] Found ${opportunities.length} broken-internal-links opportunities for site`);

  if (opportunities.length === 0) {
    return {
      success: true,
      siteId,
      totalOpportunities: 0,
      totalFixedSuggestions: 0,
      validatedCount: 0,
      linkRemovedCount: 0,
      nowWorkingCount: 0,
      stillBrokenCount: 0,
      scrapeErrorCount: 0,
      stillBrokenSuggestions: [],
    };
  }

  // Collect all FIXED suggestions from all opportunities
  const allFixedSuggestions = [];

  for (const opportunity of opportunities) {
    const opportunityId = opportunity.getId();
    const siteIdForOppty = opportunity.getSiteId?.() || 'unknown';
    const opportunityStatus = opportunity.getStatus?.() || 'unknown';

    // Get FIXED suggestions for this opportunity
    const fixedSuggestions = await Suggestion.allByOpportunityIdAndStatus(
      opportunityId,
      SuggestionDataAccess.STATUSES.FIXED,
    );

    log.debug(`[validate-fixed-suggestions] Opportunity ${opportunityId} (Site: ${siteIdForOppty}, Status: ${opportunityStatus}): ${fixedSuggestions.length} FIXED suggestions`);

    // Enrich suggestions with opportunity context and check for fix entities
    for (const suggestion of fixedSuggestions) {
      const suggestionId = suggestion.getId();
      
      // Check if fix entity exists for this suggestion
      // eslint-disable-next-line no-await-in-loop
      const fixes = await Suggestion.getFixEntitiesBySuggestionId(suggestionId);
      const hasFixEntity = fixes && fixes.length > 0;
      
      allFixedSuggestions.push({
        suggestion,
        opportunityId,
        opportunityStatus,
        siteId: siteIdForOppty,
        hasFixEntity,
        fixCount: fixes ? fixes.length : 0,
      });
    }
  }

  log.info(`[validate-fixed-suggestions] Total FIXED suggestions to validate: ${allFixedSuggestions.length}`);

  if (allFixedSuggestions.length === 0) {
    return {
      success: true,
      siteId,
      totalOpportunities: opportunities.length,
      totalFixedSuggestions: 0,
      validatedCount: 0,
      linkRemovedCount: 0,
      nowWorkingCount: 0,
      stillBrokenCount: 0,
      scrapeErrorCount: 0,
      stillBrokenSuggestions: [],
    };
  }

  // Validate suggestions with concurrency control
  log.info('[validate-fixed-suggestions] Starting validation with page scraping...');
  const validationResults = await processWithConcurrency(
    allFixedSuggestions,
    (item) => validateSuggestion({
      suggestion: item.suggestion,
      opportunityId: item.opportunityId,
      opportunityStatus: item.opportunityStatus,
      siteId: item.siteId,
      hasFixEntity: item.hasFixEntity,
      fixCount: item.fixCount,
      log,
    }),
    MAX_CONCURRENT_CHECKS,
  );

  // Analyze results
  const stillBrokenSuggestions = [];
  const allSuggestionsWithStatus = []; // NEW: Track all suggestions with their status
  let linkRemovedCount = 0;
  let nowWorkingCount = 0;
  let stillBrokenCount = 0;
  let scrapeErrorCount = 0;

  for (const result of validationResults) {
    // Add all suggestions to the complete list with their status
    const suggestionWithStatus = {
      suggestionId: result.suggestionId,
      opportunityId: result.opportunityId,
      opportunityStatus: result.opportunityStatus,
      siteId: result.siteId,
      urlTo: result.urlTo,
      urlFrom: result.urlFrom,
      title: result.title,
      hasFixEntity: result.hasFixEntity,
      fixCount: result.fixCount,
      validationStatus: result.type,
      error: result.error || null,
      isStillBroken: result.isStillBroken,
    };
    
    allSuggestionsWithStatus.push(suggestionWithStatus);

    // Write to CSV stream if provided (line by line)
    if (csvStream) {
      let reason = '';
      switch (result.type) {
        case 'link-removed':
          reason = 'Link removed from page (genuinely fixed)';
          break;
        case 'now-working':
          reason = 'Link present but now working (genuinely fixed)';
          break;
        case 'still-broken':
          reason = 'Link still present and broken (NOT fixed)';
          break;
        case 'scrape-error':
          reason = `Could not validate: ${result.error || 'Unknown error'}`;
          break;
        case 'missing-data':
          reason = `Missing data: ${result.error || 'urlFrom or urlTo missing'}`;
          break;
        default:
          reason = result.type || 'Unknown';
      }
      
      const csvRow = [
        suggestionWithStatus.suggestionId || '',
        suggestionWithStatus.siteId || '',
        suggestionWithStatus.opportunityId || '',
        suggestionWithStatus.opportunityStatus || '',
        suggestionWithStatus.urlTo || '',
        suggestionWithStatus.urlFrom || '',
        (suggestionWithStatus.title || '').replace(/"/g, '""'),
        suggestionWithStatus.hasFixEntity ? 'Yes' : 'No',
        suggestionWithStatus.fixCount || '0',
        suggestionWithStatus.validationStatus || '',
        reason,
        suggestionWithStatus.isStillBroken ? 'Yes' : 'No',
      ].map((field) => `"${field}"`).join(',');
      
      csvStream.write(csvRow + '\n');
    }

    switch (result.type) {
      case 'link-removed':
        linkRemovedCount += 1;
        log.debug(`[validate-fixed-suggestions] LINK REMOVED: ${result.urlTo} from ${result.urlFrom}`);
        break;

      case 'now-working':
        nowWorkingCount += 1;
        log.debug(`[validate-fixed-suggestions] NOW WORKING: ${result.urlTo} (genuinely fixed)`);
        break;

      case 'still-broken':
        stillBrokenCount += 1;
        stillBrokenSuggestions.push({
          suggestionId: result.suggestionId,
          opportunityId: result.opportunityId,
          siteId: result.siteId,
          urlTo: result.urlTo,
          urlFrom: result.urlFrom,
          title: result.title,
          hasFixEntity: result.hasFixEntity,
          fixCount: result.fixCount,
          reason: 'Link still present and broken',
        });
        log.warn(
          `[validate-fixed-suggestions] STILL BROKEN: ${result.urlTo} `
          + `still present on ${result.urlFrom} and is broken `
          + `[Site: ${result.siteId}, Suggestion: ${result.suggestionId}, Has Fix: ${result.hasFixEntity}]`,
        );
        break;

      case 'scrape-error':
        scrapeErrorCount += 1;
        log.warn(
          `[validate-fixed-suggestions] SCRAPE ERROR: Could not validate ${result.urlTo} `
          + `on ${result.urlFrom}: ${result.error}`,
        );
        break;

      default:
        log.debug(`[validate-fixed-suggestions] Unknown result type: ${result.type}`);
    }
  }

  // Summary
  log.info('[validate-fixed-suggestions] ========== VALIDATION SUMMARY ==========');
  log.info(`[validate-fixed-suggestions] Total opportunities checked: ${opportunities.length}`);
  log.info(`[validate-fixed-suggestions] Total FIXED suggestions: ${allFixedSuggestions.length}`);
  log.info(`[validate-fixed-suggestions] Validated: ${validationResults.length}`);
  log.info(`[validate-fixed-suggestions]   ✓ Link removed from page: ${linkRemovedCount}`);
  log.info(`[validate-fixed-suggestions]   ✓ Link present but now working: ${nowWorkingCount}`);
  log.info(`[validate-fixed-suggestions]   ✗ Link present and still broken: ${stillBrokenCount}`);
  log.info(`[validate-fixed-suggestions]   ? Could not validate (scrape errors): ${scrapeErrorCount}`);
  log.info('[validate-fixed-suggestions] ========================================');

  return {
    success: true,
    siteId,
    totalOpportunities: opportunities.length,
    totalFixedSuggestions: allFixedSuggestions.length,
    validatedCount: validationResults.length,
    linkRemovedCount,
    nowWorkingCount,
    stillBrokenCount,
    scrapeErrorCount,
    stillBrokenSuggestions,
    allSuggestionsWithStatus, // NEW: Include all suggestions with their status
  };
}

/**
 * Generates a formatted report of suggestions marked as fixed but still broken.
 */
export function generateReport(validationResult) {
  const lines = [
    '====================================================',
    '  BROKEN INTERNAL LINKS - FIXED VALIDATION REPORT',
    '====================================================',
    '',
    `Total Opportunities Checked: ${validationResult.totalOpportunities}`,
    `Total FIXED Suggestions: ${validationResult.totalFixedSuggestions}`,
    `Validated: ${validationResult.validatedCount}`,
    '',
    `✅ Link Removed from Page: ${validationResult.linkRemovedCount}`,
    `✅ Link Present but Now Working: ${validationResult.nowWorkingCount}`,
    `❌ Link Present and Still Broken: ${validationResult.stillBrokenCount}`,
    `⚠️  Could Not Validate (Scrape Errors): ${validationResult.scrapeErrorCount}`,
    '',
  ];

  if (validationResult.stillBrokenSuggestions.length > 0) {
    lines.push('====================================================');
    lines.push('  FLAGGED SUGGESTIONS (Link Present & Still Broken)');
    lines.push('====================================================');
    lines.push('');

    // Group by site
    const bySite = {};
    for (const suggestion of validationResult.stillBrokenSuggestions) {
      const site = suggestion.siteId || 'unknown';
      if (!bySite[site]) {
        bySite[site] = [];
      }
      bySite[site].push(suggestion);
    }

    for (const [site, suggestions] of Object.entries(bySite)) {
      lines.push(`📍 Site: ${site} (${suggestions.length} issues)`);
      lines.push('');

      for (const suggestion of suggestions) {
        lines.push(`  Suggestion ID: ${suggestion.suggestionId}`);
        lines.push(`  Broken URL: ${suggestion.urlTo}`);
        lines.push(`  Still Linked From: ${suggestion.urlFrom || 'N/A'}`);
        lines.push(`  Reason: ${suggestion.reason}`);
        lines.push(`  Has Fix Entity: ${suggestion.hasFixEntity ? 'Yes' : 'No'} (${suggestion.fixCount || 0} fix(es))`);
        if (suggestion.title) {
          lines.push(`  Title: ${suggestion.title}`);
        }
        lines.push('');
      }
    }
  }

  lines.push('====================================================');

  return lines.join('\n');
}

/**
 * Validates FIXED suggestions for multiple sites.
 */
export async function validateFixedSuggestionsForSites({ dataAccess, log, siteIds, csvStream = null }) {
  log.info(`[validate-fixed-suggestions] Validating ${siteIds.length} sites`);

  const aggregatedResults = {
    success: true,
    totalSites: siteIds.length,
    totalOpportunities: 0,
    totalFixedSuggestions: 0,
    validatedCount: 0,
    linkRemovedCount: 0,
    nowWorkingCount: 0,
    stillBrokenCount: 0,
    scrapeErrorCount: 0,
    stillBrokenSuggestions: [],
    allSuggestionsWithStatus: [], // NEW: Aggregate all suggestions
    siteResults: {},
  };

  for (const siteId of siteIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await validateFixedSuggestions({ dataAccess, log, siteId, csvStream });

      aggregatedResults.siteResults[siteId] = result;
      aggregatedResults.totalOpportunities += result.totalOpportunities;
      aggregatedResults.totalFixedSuggestions += result.totalFixedSuggestions;
      aggregatedResults.validatedCount += result.validatedCount;
      aggregatedResults.linkRemovedCount += result.linkRemovedCount;
      aggregatedResults.nowWorkingCount += result.nowWorkingCount;
      aggregatedResults.stillBrokenCount += result.stillBrokenCount;
      aggregatedResults.scrapeErrorCount += result.scrapeErrorCount || 0;
      aggregatedResults.stillBrokenSuggestions.push(...result.stillBrokenSuggestions);
      aggregatedResults.allSuggestionsWithStatus.push(...(result.allSuggestionsWithStatus || [])); // NEW
    } catch (error) {
      log.error(`[validate-fixed-suggestions] Failed to validate site ${siteId}: ${error.message}`);
      aggregatedResults.siteResults[siteId] = { error: error.message };
    }
  }

  log.info('[validate-fixed-suggestions] ========== AGGREGATED SUMMARY ==========');
  log.info(`[validate-fixed-suggestions] Total sites processed: ${siteIds.length}`);
  log.info(`[validate-fixed-suggestions] Total FIXED suggestions: ${aggregatedResults.totalFixedSuggestions}`);
  log.info(`[validate-fixed-suggestions] Link removed: ${aggregatedResults.linkRemovedCount}`);
  log.info(`[validate-fixed-suggestions] Now working: ${aggregatedResults.nowWorkingCount}`);
  log.info(`[validate-fixed-suggestions] Still broken: ${aggregatedResults.stillBrokenCount}`);
  log.info(`[validate-fixed-suggestions] Scrape errors: ${aggregatedResults.scrapeErrorCount}`);
  log.info('[validate-fixed-suggestions] ========================================');

  return aggregatedResults;
}

export default validateFixedSuggestions;
