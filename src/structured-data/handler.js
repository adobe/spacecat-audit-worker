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

  const [gscPagesWithIssues, scraperPagesWithIssues] = await Promise.all([
    getIssuesFromGSC(finalUrl, context, pages),
    getIssuesFromScraper(context, pages, scrapeCache),
  ]);

  // Deduplicate issues
  const pagesWithIssues = deduplicateIssues(
    context,
    gscPagesWithIssues,
    scraperPagesWithIssues,
  );

  log.info(`SDA: ${gscPagesWithIssues.length} issues from GSC, ${scraperPagesWithIssues.length} issues from scrape. ${pagesWithIssues.length} issues after deduplication`);
  log.debug('SDA: Deduplicated issues', JSON.stringify(pagesWithIssues));

  // Abort early if no issues are found
  if (pagesWithIssues.length === 0) {
    log.info('SDA: No pages with structured data issues found in GSC or in scraped data');
  }

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

  // Check if audit was successful
  if (auditData.auditResult.success === false) {
    log.warn('SDA: Audit failed, skipping suggestions data generation');
    return { ...auditData };
  }

  // Check if auto suggest was enabled
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite(auditAutoSuggestType, site)) {
    log.info(`SDA: Auto-suggest is disabled for site ${auditUrl}`);
    return { ...auditData };
  }

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

  // Go through audit results, one for each URL
  for (const issue of auditData.auditResult.issues) {
    // Limit to avoid excessive Firefall requests. Can be increased if needed.
    if (firefallRequests >= parseInt(AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT, 10)) {
      log.error(`SDA: Aborting suggestion generation as more than ${AUDIT_STRUCTURED_DATA_FIREFALL_REQ_LIMIT} Firefall requests have been used.`);
      break;
    }

    // Check if a suggestion for the issue is already in the suggestion Map
    const existingSuggestionKey = existingSuggestions.keys().find((key) => key === buildKey(issue));
    if (existingSuggestionKey) {
      log.info(`SDA: Re-using existing suggestion for issue of type ${issue.rootType} and URL ${issue.pageUrl}`);
      issue.suggestion = existingSuggestions.get(existingSuggestionKey);
    } else {
      let scrapeResult;

      let { pathname } = new URL(issue.pageUrl);
      // If pathname ends with a slash, remove it
      if (pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      try {
        if (!scrapeCache.has(pathname)) {
          scrapeCache.set(pathname, getScrapeForPath(pathname, context, site));
        }
        scrapeResult = await scrapeCache.get(pathname);
      } catch (e) {
        log.error(`SDA: Could not find scrape for ${issue.pageUrl} at ${pathname}. Make sure that scrape-top-pages did run.`, e);
        continue;
      }

      let wrongMarkup = getWrongMarkup(context, issue, scrapeResult);
      if (!wrongMarkup) {
        log.error(`SDA: Could not find structured data for issue of type ${issue.rootType} for URL ${issue.pageUrl}`);
        continue;
      }

      // Cleanup markup if RDFa or microdata
      try {
        if (issue.dataFormat === 'rdfa' || issue.dataFormat === 'microdata') {
          const parsed = cheerioLoad(wrongMarkup);
          wrongMarkup = cleanupStructuredDataMarkup(parsed);
        }
      } catch (e) {
        log.warn(`SDA: Could not cleanup markup for issue of type ${issue.rootType} for URL ${issue.pageUrl}`, e);
      }

      // Get suggestions from Firefall
      try {
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
      } catch (e) {
        log.error(`SDA: Creating suggestion for type ${issue.rootType} for URL ${issue.pageUrl} failed:`, e);
      }
    }
  }

  log.info(`SDA: Used ${firefallRequests} Firefall requests in total for site ${auditUrl}`);
  log.debug('SDA: Generated suggestions data', JSON.stringify(auditData));

  return { ...auditData };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  // Check if audit was successful
  if (auditData.auditResult.success === false) {
    log.warn('SDA: Audit failed, skipping opportunity generation');
    return { ...auditData };
  }

  // Convert suggestions to errors
  for (const issue of auditData.auditResult.issues) {
    issue.errors = [];
    const fix = generateErrorMarkupForIssue(issue);
    const errorTitle = `${issue.rootType}: ${issue.issueMessage}`;
    const errorId = errorTitle.replaceAll(/["\s]/g, '').toLowerCase();
    issue.errors.push({ fix, id: errorId, errorTitle });
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    { siteId: auditData.siteId, id: auditData.id },
    context,
    createOpportunityData,
    auditType,
  );

  // Temporarily group issues by pageUrl as the UI does not support displaying
  // the same page multiple times or displaying issues grouped by rootType
  const issuesByPageUrl = auditData.auditResult.issues.reduce((acc, issue) => {
    const existingIssue = acc.find((i) => i.pageUrl === issue.pageUrl);
    if (!existingIssue) {
      acc.push(issue);
    } else {
      existingIssue.errors.push(...issue.errors);
    }
    return acc;
  }, []);

  const buildKey = (data) => `${data.pageUrl}`;

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

  return { ...auditData };
}

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.info(`SDA: Importing top pages for ${finalUrl}`);

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    finalUrl,
  };
}

export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
    finalUrl,
  } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  if (topPages.length === 0) {
    throw new Error('No top pages found for site');
  }

  log.info(`SDA: Submitting for scraping ${topPages.length} top pages for site ${site.getId()}, finalUrl: ${finalUrl}`);

  return {
    urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
    siteId: site.getId(),
    type: 'structured-data',
  };
}

export async function runAuditAndGenerateSuggestions(context) {
  const {
    site, finalUrl, log, dataAccess, audit,
  } = context;
  const { SiteTopPage } = dataAccess;

  const startTime = process.hrtime();
  const siteId = site.getId();

  // Cache scrape results from S3, as individual pages might be requested multiple times
  const scrapeCache = new Map();

  try {
    let topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    if (!isNonEmptyArray(topPages)) {
      log.error(`SDA: No top pages for site ID ${siteId} found. Ensure that top pages were imported.`);
      throw new Error(`No top pages for site ID ${siteId} found.`);
    } else {
      topPages = topPages.map((page) => ({ url: page.getUrl() }));
    }

    // Filter out files from the top pages as these are not scraped
    const dataTypesToIgnore = ['pdf', 'ps', 'dwf', 'kml', 'kmz', 'xls', 'xlsx', 'ppt', 'pptx', 'doc', 'docx', 'rtf', 'swf'];
    topPages = topPages.filter((page) => !dataTypesToIgnore.some((dataType) => page.url.endsWith(`.${dataType}`)));

    let auditResult = await processStructuredData(finalUrl, context, topPages, scrapeCache);

    // Create opportunities and suggestions
    auditResult = await generateSuggestionsData(finalUrl, { auditResult }, context, scrapeCache);
    auditResult = await opportunityAndSuggestions(finalUrl, {
      siteId: site.getId(),
      auditId: audit.getId(),
      ...auditResult,
    }, context);

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
    const formattedElapsed = elapsedSeconds.toFixed(2);

    log.info(`SDA: Structured data audit completed in ${formattedElapsed} seconds for ${finalUrl}`);

    return {
      fullAuditRef: finalUrl,
      auditResult,
    };
  } catch (e) {
    log.error(`SDA: Structured data audit failed for ${finalUrl}`, e);
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
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('run-audit-and-generate-suggestions', runAuditAndGenerateSuggestions)
  .build();
