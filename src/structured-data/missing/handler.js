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
/* eslint-disable no-await-in-loop */

import { Audit } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';

import { AuditBuilder } from '../../common/audit-builder.js';
import missingRules from './rules/index.js';
import { getScrapeForPath } from '../../support/utils.js';
import { getClickableElements, getCssClasses } from './lib.js';
import { convertToOpportunity } from '../../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../../utils/data-access.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export async function importTopPages(context) {
  const { site, finalUrl, log } = context;

  log.debug(`[MSDA] Importing top pages for ${finalUrl}`);

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

  log.debug(`SDA: Submitting for scraping ${topPages.length} top pages for site ${site.getId()}, finalUrl: ${finalUrl}`);

  return {
    urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
    siteId: site.getId(),
    type: 'missing-structured-data',
  };
}

function classifyUrl(pathname, pageTypes = []) {
  let foundPageType = 'uncategorized';
  for (const pageType of pageTypes) {
    if (pageType.regEx.test(pathname)) {
      foundPageType = pageType.name;
      break;
    }
  }

  return foundPageType;
}

export async function detectMissingStructuredDataCandidates(context) {
  const {
    site, finalUrl, log, dataAccess, audit, sqs, env,
  } = context;
  const { SiteTopPage } = dataAccess;

  const siteId = site.getId();

  try {
    // Get top pages
    let topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    if (!isNonEmptyArray(topPages)) {
      log.error(`[MSDA] No top pages found for site ${finalUrl} (${siteId}). Ensure that top pages were imported.`);
      throw new Error(`No top pages for site ID ${siteId} found.`);
    }
    // TODO: For development, only use 10 pages
    // topPages = topPages.slice(0, 10);

    const dataTypesToIgnore = ['pdf', 'ps', 'dwf', 'kml', 'kmz', 'xls', 'xlsx', 'ppt', 'pptx', 'doc', 'docx', 'rtf', 'swf'];
    topPages = topPages
      // Filter out files from the top pages as these are not scraped
      .filter((page) => !dataTypesToIgnore.some((dataType) => page.getUrl().endsWith(`.${dataType}`)))
      // Convert to object
      .map((page) => {
        const url = page.getUrl();
        const { pathname } = new URL(url);
        return {
          url,
          pathname,
          topKeyword: page.getTopKeyword(),
          structuredDataEntities: [],
        };
      });

    // TODO: Fetch and process RUM bundle data

    // Get page classification data
    let pageTypes = [];
    try {
      pageTypes = (await site.getPageTypes())
        .map((pageType) => ({ ...pageType, regEx: new RegExp(pageType.pattern) }));
      log.info(`[MSDA] Page types: ${JSON.stringify(pageTypes)}`);

      // Classify pages by its URL
      for (const page of topPages) {
        page.pageType = classifyUrl(page.pathname, pageTypes);
      }
    } catch (error) {
      log.error(`[MSDA] Failed to get page types for site ${finalUrl} (${siteId})`, error);
    }

    log.info(`[MSDA] Top pages with page types: ${JSON.stringify(topPages)}`);

    const results = {};
    let resultsCount = 0;
    for (const page of topPages) {
      // Fetch scrape data from S3
      let { pathname } = page;
      if (pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      const scrapeResult = await getScrapeForPath(pathname, context, site);
      const { microdata, rdfa, jsonld } = scrapeResult.scrapeResult.structuredData;
      page.structuredDataEntities.push(
        ...Object.keys(microdata ?? {}),
        ...Object.keys(rdfa ?? {}),
        ...Object.keys(jsonld ?? {}),
      );

      log.info(`[MSDA] Page ${page.url} has existing structured data entities: ${JSON.stringify(page.structuredDataEntities)}`);

      // Extract clickable elements
      const { href, text } = getClickableElements(scrapeResult.scrapeResult.rawBody);
      page.clickableElementsHref = href;
      page.clickableElements = text;

      log.info(`[MSDA] Page ${page.url} has clickable elements: ${JSON.stringify(page.clickableElementsHref)}`);
      log.info(`[MSDA] Page ${page.url} has clickable elements text: ${JSON.stringify(page.clickableElements)}`);

      // Extract all CSS classes and blocks
      const [cssClasses, cssBlocks] = getCssClasses(scrapeResult.scrapeResult.rawBody);
      page.cssClasses = cssClasses;
      page.cssBlocks = cssBlocks;

      log.info(`[MSDA] Page ${page.url} has CSS classes: ${JSON.stringify(page.cssClasses)}`);
      log.info(`[MSDA] Page ${page.url} has CSS blocks: ${JSON.stringify(page.cssBlocks)}`);

      // Apply rules
      log.info(`[MSDA] Applying rules to page ${page.url}`);
      for (const rule of missingRules) {
        const result = await rule(page);
        if (isNonEmptyArray(result)) {
          if (!results[page.url]) {
            results[page.url] = [];
          }
          results[page.url].push(...result);
          resultsCount += result.length;
        }
      }
    }
    log.info(`[MSDA] Results by page: ${JSON.stringify(results)}`);
    log.info(`[MSDA] Results count: ${resultsCount}`);

    // Abort early if no results
    if (resultsCount === 0) {
      // TODO: Ensure that we still call syncSuggestions to remove outdated suggestions
      // TODO: Maybe remove opportunity as well?
      log.info(`[MSDA] No missing structured data found for site ${finalUrl} (${siteId})`);
      return {
        fullAuditRef: finalUrl,
        auditResult: {
          success: true,
          results: [],
        },
      };
    }

    // If more than one result, create opportunity use convertToOpportunity
    const opportunity = await convertToOpportunity(
      finalUrl,
      { siteId, id: audit.id },
      context,
      createOpportunityData,
      'missing-structured-data',
    );

    const acceptedResults = [];
    Object.keys(results).forEach((page) => {
      // TODO: Temporary remove non-accepted results,
      //       candidates need to go through Mystique first to confirm detection
      results[page].forEach((result) => {
        if (result.confidence !== 'accepted') {
          return;
        }
        acceptedResults.push({
          ...result,
          pageUrl: page,
        });
      });
    });

    log.info(`[MSDA] Accepted results by page: ${JSON.stringify(acceptedResults)}`);

    const buildKey = (data) => `${data.pageUrl}|${data.entity}`;
    await syncSuggestions({
      opportunity,
      context,
      newData: acceptedResults,
      buildKey,
      mapNewSuggestion: (data) => ({
        opportunityId: opportunity.getId(),
        type: 'CODE_CHANGE',
        rank: 1,
        data,
      }),
    });

    log.info(`[MSDA] Synced ${acceptedResults.length} accepted results for site into opportunity ${opportunity.getId()}`);

    // TODO: Send all candidates and detections to mystique
    // Limit results and send out events to mystique
    /* const pagesWithResults = Object.keys(results)
      .filter((page) => isNonEmptyArray(results[page]));
    log.info(`[MSDA] Pages with results: ${JSON.stringify(pagesWithResults)}`);

    // Group messages to mystique by page
    const resultByIssue = Object.keys(results).reduce((acc, pageUrl) => {
      for (const result of results[pageUrl]) {
        acc[result.type] = acc[result.type] || { type: result.type, pages: [] };
        acc[result.type].pages.push({
          url: pageUrl,
          rationale: result.rationale,
          confidence: result.confidence,
        });
      }
      return acc;
    }, {});

    log.info(`[MSDA] Result by issue: ${JSON.stringify(resultByIssue)}`); */

    // TODO: Save suggestions with page url + entity identifier as key
    /*

    const message = {
      type: 'guidance:missing-structured-data',
      siteId,
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {},
    };
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    */

    return {
      fullAuditRef: finalUrl,
      auditResult: {
        success: true,
        results: acceptedResults,
      },
    };
  } catch (error) {
    log.error(`[MSDA] Missing structured data audit failed for site ${finalUrl} (${siteId})`, error);
    return {
      fullAuditRef: finalUrl,
      auditResult: {
        success: false,
        error: error.message,
      },
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('detect-missing-structured-data-candidates', detectMissingStructuredDataCandidates)
  .build();
