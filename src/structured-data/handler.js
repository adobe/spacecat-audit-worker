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
/* eslint-disable no-continue, no-await-in-loop */
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { load as cheerioLoad } from 'cheerio';

import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { getScrapeForPath } from '../support/utils.js';
import {
  cleanupStructuredDataMarkup,
  getIssuesFromGSC,
  deduplicateIssues,
  getIssuesFromScraper,
  getWrongMarkup,
  generateErrorMarkupForIssue,
  generateFirefallSuggestion,
} from './lib.js';

const auditType = Audit.AUDIT_TYPES.STRUCTURED_DATA;
const auditAutoSuggestType = Audit.AUDIT_TYPES.STRUCTURED_DATA_AUTO_SUGGEST;
const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * Processes an audit of a set of pages from a site using Google's URL inspection tool.
 *
 * @async
 * @function
 * @param {string} finalUrl - The final URL for the audit.
 * @param {Object} context - The context object.
 * @param {Array} pages - An array of page URLs to be audited.
 *
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of objects,
 * each containing the inspection URL, filtered index status result, and filtered rich results.
 * If an error occurs during the inspection of a URL, the object will include an error message.
 *
 * @throws {Error} - Throws an error if the audit process fails.
 */
export async function processStructuredData(finalUrl, context, pages, scrapeCache) {
  const { log } = context;

  log.info(`SDA: [processStructuredData] Starting structured data audit for ${finalUrl}`);
  log.info(`SDA: [processStructuredData] Processing ${pages.length} pages: ${JSON.stringify(pages.map((p) => p.url))}`);

  log.info('SDA: [processStructuredData] Starting parallel execution of GSC and scraper data collection');
  const [gscPagesWithIssues, scraperPagesWithIssues] = await Promise.all([
    getIssuesFromGSC(finalUrl, context, pages),
    getIssuesFromScraper(context, pages, scrapeCache),
  ]);

  log.info(`SDA: [processStructuredData] GSC data collection completed with ${gscPagesWithIssues.length} issues`);
  log.info(`SDA: [processStructuredData] Scraper data collection completed with ${scraperPagesWithIssues.length} issues`);

  // Deduplicate issues
  log.info('SDA: [processStructuredData] Starting issue deduplication');
  const pagesWithIssues = deduplicateIssues(
    context,
    gscPagesWithIssues,
    scraperPagesWithIssues,
  );

  log.info(`SDA: [processStructuredData] Deduplication completed: ${gscPagesWithIssues.length} issues from GSC, ${scraperPagesWithIssues.length} issues from scrape. ${pagesWithIssues.length} issues after deduplication`);
  log.debug('SDA: [processStructuredData] Deduplicated issues', JSON.stringify(pagesWithIssues));

  // Abort early if no issues are found
  if (pagesWithIssues.length === 0) {
    log.info('SDA: [processStructuredData] No pages with structured data issues found in GSC or in scraped data');
  } else {
    log.info(`SDA: [processStructuredData] Found ${pagesWithIssues.length} unique issues to process`);
  }

  log.info(`SDA: [processStructuredData] Structured data audit processing completed for ${finalUrl}`);
  return {
    success: true,
    issues: pagesWithIssues,
  };
}

export async function generateSuggestionsData(auditUrl, auditData, context, scrapeCache) {
  const { dataAccess, log, site } = context;
  const { Configuration } = dataAccess;
  const {
    AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT = 50,
  } = context.env;

  log.info(`SDA: [generateSuggestionsData] Starting suggestions generation for ${auditUrl}`);
  log.info(`SDA: [generateSuggestionsData] Site ID: ${site.getId()}, Firefall request limit: ${AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT}`);

  // Check if audit was successful
  if (auditData.auditResult.success === false) {
    log.warn('SDA: [generateSuggestionsData] Audit failed, skipping suggestions data generation');
    return { ...auditData };
  }

  log.info('SDA: [generateSuggestionsData] Audit was successful, checking auto-suggest configuration');

  // Check if auto suggest was enabled
  const configuration = await Configuration.findLatest();
  log.info('SDA: [generateSuggestionsData] Configuration retrieved, checking if auto-suggest is enabled for site');

  if (!configuration.isHandlerEnabledForSite(auditAutoSuggestType, site)) {
    log.info('SDA: [generateSuggestionsData] Auto-suggest is disabled for site, skipping suggestions generation');
    return { ...auditData };
  }

  log.info('SDA: [generateSuggestionsData] Auto-suggest is enabled, initializing Firefall client');

  // Initialize Firefall client
  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = {
    model: 'gpt-4o',
    responseFormat: 'json_object',
  };

  let firefallRequests = 0;

  // Cache suggestions so that we only generate one suggestion for each issue
  const existingSuggestions = new Map();
  const buildKey = (data) => `${data.dataFormat}::${data.rootType}::${data.severity}::${data.issueMessage}`;

  log.info(`SDA: [generateSuggestionsData] Starting to process ${auditData.auditResult.issues.length} issues for suggestions`);

  // Go through audit results, one for each URL
  for (const issue of auditData.auditResult.issues) {
    log.info(`SDA: [generateSuggestionsData] Processing issue: ${issue.rootType} for URL: ${issue.pageUrl}`);
    log.info(`SDA: [generateSuggestionsData] Issue details - Data format: ${issue.dataFormat}, Severity: ${issue.severity}, Message: ${issue.issueMessage}`);

    // Limit to avoid excessive Firefall requests. Can be increased if needed.
    if (firefallRequests >= parseInt(AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT, 10)) {
      log.error(`SDA: [generateSuggestionsData] Aborting suggestion generation as more than ${AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT} Firefall requests have been used.`);
      break;
    }

    // Check if a suggestion for the issue is already in the suggestion Map
    const existingSuggestionKey = existingSuggestions.keys().find((key) => key === buildKey(issue));
    if (existingSuggestionKey) {
      log.info(`SDA: [generateSuggestionsData] Re-using existing suggestion for issue of type ${issue.rootType} and URL ${issue.pageUrl}`);
      issue.suggestion = existingSuggestions.get(existingSuggestionKey);
    } else {
      log.info(`SDA: [generateSuggestionsData] No existing suggestion found, generating new suggestion for ${issue.pageUrl}`);

      let scrapeResult;

      let { pathname } = new URL(issue.pageUrl);
      // If pathname ends with a slash, remove it
      if (pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }

      log.info(`SDA: [generateSuggestionsData] Extracted pathname: ${pathname} from URL: ${issue.pageUrl}`);

      try {
        if (!scrapeCache.has(pathname)) {
          log.info(`SDA: [generateSuggestionsData] Pathname ${pathname} not in cache, fetching from S3`);
          scrapeCache.set(pathname, getScrapeForPath(pathname, context, site));
        } else {
          log.info(`SDA: [generateSuggestionsData] Pathname ${pathname} found in cache, using cached data`);
        }
        scrapeResult = await scrapeCache.get(pathname);
        log.info(`SDA: [generateSuggestionsData] Successfully retrieved scrape result for ${pathname}`);
      } catch (e) {
        log.error(`SDA: [generateSuggestionsData] Could not find scrape for ${pathname}. Make sure that scrape-top-pages did run.`, e);
        continue;
      }

      let wrongMarkup = getWrongMarkup(context, issue, scrapeResult);
      if (!wrongMarkup) {
        log.error(`SDA: [generateSuggestionsData] Could not find structured data for issue of type ${issue.rootType} for URL ${issue.pageUrl}`);
        continue;
      }

      log.info(`SDA: [generateSuggestionsData] Found wrong markup for issue type ${issue.rootType}, length: ${wrongMarkup.length} characters`);

      // Cleanup markup if RDFa or microdata
      try {
        if (issue.dataFormat === 'rdfa' || issue.dataFormat === 'microdata') {
          log.info(`SDA: [generateSuggestionsData] Cleaning up ${issue.dataFormat} markup for ${issue.pageUrl}`);
          const parsed = cheerioLoad(wrongMarkup);
          wrongMarkup = cleanupStructuredDataMarkup(parsed);
          log.info(`SDA: [generateSuggestionsData] Markup cleanup completed for ${issue.pageUrl}`);
        }
      } catch (e) {
        log.warn(`SDA: [generateSuggestionsData] Could not cleanup markup for issue of type ${issue.rootType} for URL ${issue.pageUrl}`, e);
      }

      // Get suggestions from Firefall
      try {
        log.info(`SDA: [generateSuggestionsData] Sending request to Firefall for issue type ${issue.rootType} on ${issue.pageUrl}`);
        firefallRequests += 1;
        const suggestion = await generateFirefallSuggestion(
          context,
          firefallClient,
          firefallOptions,
          issue,
          wrongMarkup,
          scrapeResult,
        );
        issue.suggestion = suggestion;
        existingSuggestions.set(buildKey(issue), structuredClone(suggestion));
        log.info(`SDA: [generateSuggestionsData] Successfully generated Firefall suggestion for ${issue.pageUrl}, Firefall requests used: ${firefallRequests}`);
      } catch (e) {
        log.error(`SDA: [generateSuggestionsData] Creating suggestion for type ${issue.rootType} for URL ${issue.pageUrl} failed:`, e);
      }
    }
  }

  log.info(`SDA: [generateSuggestionsData] Suggestions generation completed for ${auditUrl}`);
  log.info(`SDA: [generateSuggestionsData] Used ${firefallRequests} Firefall requests in total for site ${auditUrl}`);
  log.info(`SDA: [generateSuggestionsData] Generated suggestions for ${auditData.auditResult.issues.length} issues`);
  log.debug('SDA: [generateSuggestionsData] Generated suggestions data', JSON.stringify(auditData));

  return { ...auditData };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  log.info(`SDA: [opportunityAndSuggestions] Starting opportunity and suggestions creation for ${auditUrl}`);
  log.info(`SDA: [opportunityAndSuggestions] Site ID: ${auditData.siteId}, Audit ID: ${auditData.id}`);

  // Check if audit was successful
  if (auditData.auditResult.success === false) {
    log.warn('SDA: [opportunityAndSuggestions] Audit failed, skipping opportunity generation');
    return { ...auditData };
  }

  log.info(`SDA: [opportunityAndSuggestions] Audit was successful, processing ${auditData.auditResult.issues.length} issues`);

  // Convert suggestions to errors
  for (const issue of auditData.auditResult.issues) {
    log.info(`SDA: [opportunityAndSuggestions] Converting issue to error format: ${issue.rootType} for ${issue.pageUrl}`);
    issue.errors = [];
    const fix = generateErrorMarkupForIssue(issue);
    const errorTitle = `${issue.rootType}: ${issue.issueMessage}`;
    const errorId = errorTitle.replaceAll(/["\s]/g, '').toLowerCase();
    issue.errors.push({ fix, id: errorId, errorTitle });
    log.info(`SDA: [opportunityAndSuggestions] Created error with ID: ${errorId} for ${issue.pageUrl}`);
  }

  log.info('SDA: [opportunityAndSuggestions] Converting audit data to opportunity');
  const opportunity = await convertToOpportunity(
    auditUrl,
    { siteId: auditData.siteId, id: auditData.id },
    context,
    createOpportunityData,
    auditType,
  );

  log.info(`SDA: [opportunityAndSuggestions] Opportunity created with ID: ${opportunity.getId()}`);

  // Temporarily group issues by pageUrl as the UI does not support displaying
  // the same page multiple times or displaying issues grouped by rootType
  log.info('SDA: [opportunityAndSuggestions] Grouping issues by page URL for UI compatibility');
  const issuesByPageUrl = auditData.auditResult.issues.reduce((acc, issue) => {
    const existingIssue = acc.find((i) => i.pageUrl === issue.pageUrl);
    if (!existingIssue) {
      acc.push(issue);
      log.info(`SDA: [opportunityAndSuggestions] Added new page issue for ${issue.pageUrl}`);
    } else {
      existingIssue.errors.push(...issue.errors);
      log.info(`SDA: [opportunityAndSuggestions] Merged errors for existing page ${issue.pageUrl}`);
    }
    return acc;
  }, []);

  log.info(`SDA: [opportunityAndSuggestions] Grouped ${auditData.auditResult.issues.length} issues into ${issuesByPageUrl.length} unique pages`);

  const buildKey = (data) => `${data.pageUrl}`;

  log.info('SDA: [opportunityAndSuggestions] Starting to sync suggestions to database');
  await syncSuggestions({
    opportunity,
    newData: issuesByPageUrl,
    buildKey,
    context,
    mapNewSuggestion: (data) => ({
      opportunityId: opportunity.getId(),
      type: 'CODE_CHANGE',
      rank: data.severity === 'ERROR' ? 1 : 0,
      data: {
        type: 'url',
        url: data.pageUrl,
        errors: data.errors,
      },
    }),
    log,
  });

  log.info(`SDA: [opportunityAndSuggestions] Successfully synced ${issuesByPageUrl.length} suggestions to database`);
  log.info(`SDA: [opportunityAndSuggestions] Opportunity and suggestions creation completed for ${auditUrl}`);

  return { ...auditData };
}

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`SDA: [importTopPages] Starting import top pages step for ${finalUrl}`);
  log.info(`SDA: [importTopPages] Site ID: ${site.getId()}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  log.info(`SDA: [importTopPages] S3 bucket path: ${s3BucketPath}`);

  const result = {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    finalUrl,
  };

  log.info(`SDA: [importTopPages] Import top pages step completed, returning result: ${JSON.stringify(result)}`);
  return result;
}

export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
    finalUrl,
  } = context;
  const { SiteTopPage } = dataAccess;

  log.info(`SDA: [submitForScraping] Starting submit for scraping step for ${finalUrl}`);
  log.info(`SDA: [submitForScraping] Site ID: ${site.getId()}`);

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  log.info(`SDA: [submitForScraping] Retrieved ${topPages.length} top pages from database`);

  if (topPages.length === 0) {
    log.error(`SDA: [submitForScraping] No top pages found for site ${site.getId()}`);
    throw new Error('No top pages found for site');
  }

  const urls = topPages.map((topPage) => ({ url: topPage.getUrl() }));
  log.info(`SDA: [submitForScraping] Extracted URLs: ${JSON.stringify(urls.map((u) => u.url))}`);

  const result = {
    urls,
    siteId: site.getId(),
    type: 'structured-data',
  };

  log.info(`SDA: [submitForScraping] Submit for scraping step completed for ${finalUrl}`);
  log.info(`SDA: [submitForScraping] Returning result: ${JSON.stringify(result)}`);
  return result;
}

export async function runAuditAndGenerateSuggestions(context) {
  const {
    site, finalUrl, log, dataAccess, audit,
  } = context;
  const { SiteTopPage } = dataAccess;

  const startTime = process.hrtime();
  const siteId = site.getId();

  log.info(`SDA: [runAuditAndGenerateSuggestions] Starting main audit execution for ${finalUrl}`);
  log.info(`SDA: [runAuditAndGenerateSuggestions] Site ID: ${siteId}, Audit ID: ${audit.getId()}`);

  // Cache scrape results from S3, as individual pages might be requested multiple times
  const scrapeCache = new Map();
  log.info('SDA: [runAuditAndGenerateSuggestions] Initialized empty scrape cache');

  try {
    log.info('SDA: [runAuditAndGenerateSuggestions] Fetching top pages from database');
    let topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    if (!isNonEmptyArray(topPages)) {
      log.error(`SDA: [runAuditAndGenerateSuggestions] No top pages for site ID ${siteId} found. Ensure that top pages were imported.`);
      throw new Error(`No top pages for site ID ${siteId} found.`);
    } else {
      topPages = topPages.map((page) => ({ url: page.getUrl() }));
      log.info(`SDA: [runAuditAndGenerateSuggestions] Successfully retrieved ${topPages.length} top pages`);
      log.info(`SDA: [runAuditAndGenerateSuggestions] Top pages URLs: ${JSON.stringify(topPages.map((p) => p.url))}`);
    }

    log.info('SDA: [runAuditAndGenerateSuggestions] Starting structured data processing');
    let auditResult = await processStructuredData(finalUrl, context, topPages, scrapeCache);
    log.info(`SDA: [runAuditAndGenerateSuggestions] Structured data processing completed with ${auditResult.issues?.length || 0} issues`);

    // Create opportunities and suggestions
    log.info('SDA: [runAuditAndGenerateSuggestions] Starting suggestions generation');
    auditResult = await generateSuggestionsData(finalUrl, { auditResult }, context, scrapeCache);
    log.info('SDA: [runAuditAndGenerateSuggestions] Suggestions generation completed');

    log.info('SDA: [runAuditAndGenerateSuggestions] Starting opportunity and suggestions creation');
    auditResult = await opportunityAndSuggestions(finalUrl, {
      siteId: site.getId(),
      auditId: audit.getId(),
      ...auditResult,
    }, context);
    log.info('SDA: [runAuditAndGenerateSuggestions] Opportunity and suggestions creation completed');

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
    const formattedElapsed = elapsedSeconds.toFixed(2);

    log.info(`SDA: [runAuditAndGenerateSuggestions] Structured data audit completed in ${formattedElapsed} seconds for ${finalUrl}`);
    log.info(`SDA: [runAuditAndGenerateSuggestions] Final audit result summary: ${JSON.stringify({
      success: auditResult.success,
      issuesCount: auditResult.issues?.length || 0,
      fullAuditRef: finalUrl,
    })}`);

    return {
      fullAuditRef: finalUrl,
      auditResult,
    };
  } catch (e) {
    log.error(`SDA: [runAuditAndGenerateSuggestions] Structured data audit failed for ${finalUrl}`, e);
    log.error(`SDA: [runAuditAndGenerateSuggestions] Error details: ${e.message}`);
    log.error(`SDA: [runAuditAndGenerateSuggestions] Error stack: ${e.stack}`);

    return {
      fullAuditRef: finalUrl,
      auditResult: {
        error: e.message,
        success: false,
      },
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
