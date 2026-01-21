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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit, Opportunity as Oppty, Suggestion as SuggestionDataAccess }
  from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/base-audit.js';
import { isUnscrapeable } from '../utils/url-utils.js';
import { syncBrokenInternalLinksSuggestions } from './suggestions-generator.js';
import {
  isLinkInaccessible,
  calculatePriority, calculateKpiDeltasForAudit,
} from './helpers.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { filterByAuditScope, isWithinAuditScope, extractPathPrefix } from './subpath-filter.js';
import { detectBrokenLinksFromCrawl, mergeAndDeduplicate } from './crawl-detection.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const INTERVAL = 30; // days
const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;
const MAX_URLS_TO_PROCESS = 100;
const MAX_ALTERNATIVE_URLS = 100;
const MAX_BROKEN_LINKS = 100;

/**
 * Updates the audit result with prioritized broken internal links.
 *
 * @param {Object} audit - The audit object
 * @param {Object} auditResult - The current audit result
 * @param {Array} prioritizedLinks - Array of prioritized broken links
 * @param {Object} dataAccess - Data access object containing models
 * @param {Object} log - Logger instance
 */
export async function updateAuditResult(audit, auditResult, prioritizedLinks, dataAccess, log) {
  const updatedAuditResult = {
    ...auditResult,
    brokenInternalLinks: prioritizedLinks,
  };

  try {
    const auditId = audit.getId ? audit.getId() : audit.id;

    // Try to update in-memory audit object first
    if (typeof audit.setAuditResult === 'function') {
      audit.setAuditResult(updatedAuditResult);
      await audit.save();
      log.info(`[${AUDIT_TYPE}] Updated audit result with ${prioritizedLinks.length} prioritized broken links`);
    } else {
      // Fallback: Update via database lookup
      const { Audit: AuditModel } = dataAccess;
      log.info(`[${AUDIT_TYPE}] Falling back to database lookup for auditId: ${auditId}`);

      const auditToUpdate = await AuditModel.findById(auditId);

      if (auditToUpdate) {
        auditToUpdate.setAuditResult(updatedAuditResult);
        await auditToUpdate.save();
        log.info(`[${AUDIT_TYPE}] Updated audit result via database lookup with ${prioritizedLinks.length} prioritized broken links`);
      } else {
        log.error(`[${AUDIT_TYPE}] Could not find audit with ID ${auditId} to update`);
      }
    }
  } catch (error) {
    log.error(`[${AUDIT_TYPE}] Failed to update audit result: ${error.message}`);
  }

  // Return the updated result so caller can use it directly
  return updatedAuditResult;
}

/**
 * Perform an audit to check which internal links for domain are broken.
 * This is the RUM-based detection phase.
 *
 * @async
 * @param {string} auditUrl - The URL to run audit against
 * @param {Object} context - The context object
 * @returns {Object} - Returns audit result (without priority - calculated after merge)
 */
export async function internalLinksAuditRunner(auditUrl, context) {
  const { log, site } = context;
  const finalUrl = await wwwUrlResolver(site, context);

  log.info(`[${AUDIT_TYPE}] ====== RUM Detection Phase ======`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, Domain: ${finalUrl}`);

  try {
    // 1. Create RUM API client
    const rumAPIClient = RUMAPIClient.createFrom(context);

    // 2. Prepare query options
    const options = {
      domain: finalUrl,
      interval: INTERVAL,
      granularity: 'hourly',
    };

    log.info(`[${AUDIT_TYPE}] Querying RUM API for 404 internal links (interval: ${INTERVAL} days)`);

    // 3. Query for 404 internal links
    const internal404Links = await rumAPIClient.query('404-internal-links', options);
    log.info(`[${AUDIT_TYPE}] Found ${internal404Links.length} 404 internal links from RUM data`);

    if (internal404Links.length === 0) {
      log.info(`[${AUDIT_TYPE}] No 404 internal links found in RUM data`);
      log.info(`[${AUDIT_TYPE}] ================================`);
      return {
        auditResult: {
          brokenInternalLinks: [],
          fullAuditRef: auditUrl,
          finalUrl,
          auditContext: { interval: INTERVAL },
          success: true,
        },
        fullAuditRef: auditUrl,
      };
    }

    // 4. Check accessibility in parallel before transformation
    log.info(`[${AUDIT_TYPE}] Validating ${internal404Links.length} links to confirm they are still broken...`);

    const accessibilityResults = await Promise.all(
      internal404Links.map(async (link) => ({
        link,
        inaccessible: await isLinkInaccessible(link.url_to, log),
      })),
    );

    // Count validation results
    const stillBroken = accessibilityResults.filter((r) => r.inaccessible).length;
    const nowFixed = accessibilityResults.filter((r) => !r.inaccessible).length;
    log.info(`[${AUDIT_TYPE}] Validation results: ${stillBroken} still broken, ${nowFixed} now fixed`);

    // 5. Filter only inaccessible links and transform for further processing
    // Also filter by audit scope (subpath/locale) if baseURL has a subpath
    const baseURL = site.getBaseURL();
    const inaccessibleLinks = accessibilityResults
      .filter((result) => result.inaccessible)
      .filter((result) => (
        // Filter broken links to only include those within audit scope
        isWithinAuditScope(result.link.url_from, baseURL)
        && isWithinAuditScope(result.link.url_to, baseURL)
      ))
      .map((result) => ({
        urlFrom: result.link.url_from,
        urlTo: result.link.url_to,
        trafficDomain: result.link.traffic_domain,
      }));

    // Calculate total traffic impact
    const totalTraffic = inaccessibleLinks.reduce((sum, link) => sum + link.trafficDomain, 0);
    log.info(`[${AUDIT_TYPE}] RUM detection complete: ${inaccessibleLinks.length} broken links (total traffic: ${totalTraffic} views)`);
    log.info(`[${AUDIT_TYPE}] ================================`);

    // 6. Build and return audit result (priority calculated after merge with crawl data)
    return {
      auditResult: {
        brokenInternalLinks: inaccessibleLinks,
        fullAuditRef: auditUrl,
        finalUrl,
        auditContext: { interval: INTERVAL },
        success: true,
      },
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] audit failed with error: ${error.message}`, error);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: `[${AUDIT_TYPE}] [Site: ${site.getId()}] audit failed with error: ${error.message}`,
        success: false,
      },
    };
  }
}

export async function runAuditAndImportTopPagesStep(context) {
  const { site, log, finalUrl } = context;
  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] starting audit`);
  const internalLinksAuditRunnerResult = await internalLinksAuditRunner(
    finalUrl,
    context,
  );

  return {
    auditResult: internalLinksAuditRunnerResult.auditResult,
    fullAuditRef: finalUrl,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Submit URLs for scraping (for crawl-based detection).
 * Combines Ahrefs top pages + includedURLs from siteConfig.
 */
export async function submitForScraping(context) {
  const {
    site, dataAccess, log, audit,
  } = context;
  const { SiteTopPage } = dataAccess;
  const { success } = audit.getAuditResult();

  if (!success) {
    throw new Error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skip scraping and suggestion generation`);
  }

  log.info(`[${AUDIT_TYPE}] ====== Submit for Scraping Step ======`);

  // Fetch Ahrefs top pages with error handling
  let topPagesUrls = [];
  try {
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    topPagesUrls = topPages.map((page) => page.getUrl());
    log.info(`[${AUDIT_TYPE}] Found ${topPagesUrls.length} Ahrefs top pages`);
  } catch (error) {
    log.warn(`[${AUDIT_TYPE}] Failed to fetch Ahrefs top pages: ${error.message}`);
    topPagesUrls = [];
  }

  // Get includedURLs from siteConfig
  const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
  log.info(`[${AUDIT_TYPE}] Found ${includedURLs.length} includedURLs from siteConfig`);

  // Merge and deduplicate
  let finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(`[${AUDIT_TYPE}] Merged URLs: ${topPagesUrls.length} (Ahrefs) + ${includedURLs.length} (manual) = ${finalUrls.length} unique`);

  // Limit to max URLs
  if (finalUrls.length > MAX_URLS_TO_PROCESS) {
    log.warn(`[${AUDIT_TYPE}] Total URLs (${finalUrls.length}) exceeds limit. Capping at ${MAX_URLS_TO_PROCESS}`);
    finalUrls = finalUrls.slice(0, MAX_URLS_TO_PROCESS);
  }

  // Filter by audit scope
  const baseURL = site.getBaseURL();
  finalUrls = finalUrls.filter((url) => isWithinAuditScope(url, baseURL));
  log.info(`[${AUDIT_TYPE}] After audit scope filtering: ${finalUrls.length} URLs`);

  // Filter out unscrape-able files
  const beforeFilter = finalUrls.length;
  finalUrls = finalUrls.filter((url) => !isUnscrapeable(url));
  if (beforeFilter > finalUrls.length) {
    log.info(`[${AUDIT_TYPE}] Filtered out ${beforeFilter - finalUrls.length} unscrape-able files`);
  }

  if (finalUrls.length === 0) {
    log.warn(`[${AUDIT_TYPE}] No URLs available for scraping`);
    log.info(`[${AUDIT_TYPE}] =======================================`);
    return {
      urls: [],
      siteId: site.getId(),
      type: 'broken-internal-links',
      allowCache: false,
      maxScrapeAge: 0,
    };
  }

  // Skip redirect resolution to avoid delays and timeouts
  // Assume Ahrefs top pages and configured URLs are already valid
  log.info(`[${AUDIT_TYPE}] Skipping redirect resolution (assuming ${finalUrls.length} URLs are valid)`);
  const uniqueResolvedUrls = finalUrls;

  const scrapingPayload = {
    urls: uniqueResolvedUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'broken-internal-links',
  };

  log.info(`[${AUDIT_TYPE}] Submitting ${uniqueResolvedUrls.length} URLs for scraping`);
  log.info(`[${AUDIT_TYPE}] Scraping job details: siteId=${site.getId()}, type=${scrapingPayload.type}, urlCount=${uniqueResolvedUrls.length}`);
  log.info(`[${AUDIT_TYPE}] =======================================`);

  return scrapingPayload;
}

export const opportunityAndSuggestionsStep = async (context) => {
  const {
    log, site, finalUrl, sqs, env, dataAccess, audit, updatedAuditResult,
  } = context;
  const { Suggestion, SiteTopPage } = dataAccess;

  // Use updated result if passed (from crawl detection), otherwise read from audit
  const auditResultToUse = updatedAuditResult || audit.getAuditResult();
  const { brokenInternalLinks, success } = auditResultToUse;

  if (!success) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping suggestions generation`);
    return { status: 'complete' };
  }

  if (!isNonEmptyArray(brokenInternalLinks)) {
    // no broken internal links found - handle existing opportunity
    const { Opportunity } = dataAccess;
    let opportunity;
    try {
      const opportunities = await Opportunity
        .allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW);
      opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
    } catch (e) {
      log.error(`Fetching opportunities for siteId ${site.getId()} failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
    }

    if (!opportunity) {
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no broken internal links found, skipping opportunity creation`);
    } else {
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no broken internal links found, updating opportunity to RESOLVED`);
      await opportunity.setStatus(Oppty.STATUSES.RESOLVED);
      const suggestions = await opportunity.getSuggestions();
      if (isNonEmptyArray(suggestions)) {
        await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.FIXED);
      }
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }
    return { status: 'complete' };
  }

  const kpiDeltas = calculateKpiDeltasForAudit(brokenInternalLinks);

  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    { kpiDeltas },
  );

  await syncBrokenInternalLinksSuggestions({
    opportunity,
    brokenInternalLinks,
    context,
    opportunityId: opportunity.getId(),
    log,
  });

  // Fetch Ahrefs top pages with error handling
  let ahrefsTopPages = [];
  try {
    ahrefsTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    log.info(`[${AUDIT_TYPE}] Found ${ahrefsTopPages.length} top pages from Ahrefs`);
  } catch (error) {
    log.warn(`[${AUDIT_TYPE}] Failed to fetch Ahrefs top pages: ${error.message}`);
  }

  // Get includedURLs from siteConfig
  const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
  log.info(`[${AUDIT_TYPE}] Found ${includedURLs.length} includedURLs from siteConfig`);

  // Merge Ahrefs + includedURLs for alternatives
  const includedTopPages = includedURLs.map((url) => ({ getUrl: () => url }));
  let topPages = [...ahrefsTopPages, ...includedTopPages];

  // Limit total pages
  if (topPages.length > MAX_URLS_TO_PROCESS) {
    log.warn(`[${AUDIT_TYPE}] Capping URLs from ${topPages.length} to ${MAX_URLS_TO_PROCESS}`);
    topPages = topPages.slice(0, MAX_URLS_TO_PROCESS);
  }

  // Filter by audit scope
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);
  log.info(`[${AUDIT_TYPE}] After audit scope filtering: ${filteredTopPages.length} top pages available`);

  // Auto-suggest enabled for all sites
  const suggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionDataAccess.STATUSES.NEW,
  );

  // Build broken links array for Mystique
  const brokenLinks = suggestions
    .map((suggestion) => ({
      urlFrom: suggestion?.getData()?.urlFrom,
      urlTo: suggestion?.getData()?.urlTo,
      suggestionId: suggestion?.getId(),
    }))
    .filter((link) => link.urlFrom && link.urlTo && link.suggestionId);

  // Filter alternatives by locales present in broken links
  const allTopPageUrls = filteredTopPages.map((page) => page.getUrl());
  const brokenLinkLocales = new Set();
  brokenLinks.forEach((link) => {
    const locale = extractPathPrefix(link.urlTo);
    if (locale) brokenLinkLocales.add(locale);
  });

  let alternativeUrls = [];
  if (brokenLinkLocales.size > 0) {
    alternativeUrls = allTopPageUrls.filter((url) => {
      const urlLocale = extractPathPrefix(url);
      return !urlLocale || brokenLinkLocales.has(urlLocale);
    });
  } else {
    alternativeUrls = allTopPageUrls;
  }

  // Filter out unscrape-able files
  const originalCount = alternativeUrls.length;
  alternativeUrls = alternativeUrls.filter((url) => !isUnscrapeable(url));
  if (alternativeUrls.length < originalCount) {
    log.info(`[${AUDIT_TYPE}] Filtered out ${originalCount - alternativeUrls.length} unscrape-able file URLs`);
  }

  // Limit alternativeUrls to prevent message size issues (these are duplicated in each batch)
  if (alternativeUrls.length > MAX_ALTERNATIVE_URLS) {
    log.warn(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Limiting alternativeUrls from ${alternativeUrls.length} to ${MAX_ALTERNATIVE_URLS}`);
    alternativeUrls = alternativeUrls.slice(0, MAX_ALTERNATIVE_URLS);
  }

  // Validate before sending to Mystique
  if (brokenLinks.length === 0) {
    log.warn(`[${AUDIT_TYPE}] No valid broken links to send to Mystique. Skipping message.`);
    return { status: 'complete' };
  }

  if (!opportunity?.getId()) {
    log.error(`[${AUDIT_TYPE}] Opportunity ID is missing. Cannot send to Mystique.`);
    return { status: 'complete' };
  }

  if (alternativeUrls.length === 0) {
    log.warn(`[${AUDIT_TYPE}] No alternative URLs available. Skipping message to Mystique.`);
    return { status: 'complete' };
  }

  // Batch broken links to stay within SQS message size limit (256KB)
  // Each batch gets its own message with batch metadata for Mystique to reassemble
  const BATCH_SIZE = MAX_BROKEN_LINKS; // 100 links per batch
  const totalBatches = Math.ceil(brokenLinks.length / BATCH_SIZE);

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Sending ${brokenLinks.length} broken links in ${totalBatches} batch(es) to Mystique`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, brokenLinks.length);
    const batchLinks = brokenLinks.slice(batchStart, batchEnd);

    const message = {
      type: 'guidance:broken-links',
      siteId: site.getId(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        alternativeUrls,
        opportunityId: opportunity.getId(),
        brokenLinks: batchLinks,
        // Batch metadata for Mystique to handle multiple messages
        batchInfo: {
          batchIndex,
          totalBatches,
          totalBrokenLinks: brokenLinks.length,
          batchSize: batchLinks.length,
        },
      },
    };

    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.debug(`[${AUDIT_TYPE}] Batch ${batchIndex + 1}/${totalBatches} sent to Mystique (${batchLinks.length} links)`);
  }

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Successfully sent all ${totalBatches} batch(es) to Mystique`);

  return { status: 'complete' };
};

/**
 * Run crawl-based detection, merge with RUM results, and generate opportunities/suggestions.
 */
export async function runCrawlDetectionAndGenerateSuggestions(context) {
  const {
    log, site, audit, dataAccess,
  } = context;

  const scrapeResultPaths = context.scrapeResultPaths || new Map();
  const scrapeJobId = context.scrapeJobId || 'N/A';

  log.info(`[${AUDIT_TYPE}] ====== Crawl Detection Step ======`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, scrapeJobId: ${scrapeJobId}, scrapeResultPaths: ${scrapeResultPaths.size}`);

  // Get RUM results from previous audit step
  const auditResult = audit.getAuditResult();
  const rumLinks = auditResult.brokenInternalLinks || [];

  log.info(`[${AUDIT_TYPE}] RUM detection results: ${rumLinks.length} broken links`);

  let finalLinks = rumLinks;

  if (scrapeResultPaths.size > 0) {
    // Run crawl detection
    const crawlLinks = await detectBrokenLinksFromCrawl(scrapeResultPaths, context);
    log.info(`[${AUDIT_TYPE}] Crawl detected ${crawlLinks.length} broken links`);

    // Merge crawl + RUM results (RUM takes priority for traffic data)
    finalLinks = mergeAndDeduplicate(crawlLinks, rumLinks, log);
  } else {
    log.info(`[${AUDIT_TYPE}] No scraped content available, using RUM-only results`);
  }

  // Calculate priority for all links
  const prioritizedLinks = calculatePriority(finalLinks);

  // Count by priority
  const highPriority = prioritizedLinks.filter((link) => link.priority === 'high').length;
  const mediumPriority = prioritizedLinks.filter((link) => link.priority === 'medium').length;
  const lowPriority = prioritizedLinks.filter((link) => link.priority === 'low').length;
  log.info(`[${AUDIT_TYPE}] Priority: ${highPriority} high, ${mediumPriority} medium, ${lowPriority} low`);

  // Update audit result with prioritized links
  const updatedAuditResult = await updateAuditResult(
    audit,
    auditResult,
    prioritizedLinks,
    dataAccess,
    log,
  );

  log.info(`[${AUDIT_TYPE}] ===================================`);

  // Now generate opportunities and suggestions
  return opportunityAndSuggestionsStep({ ...context, updatedAuditResult });
}

// Alias for backward compatibility with tests
export { submitForScraping as prepareScrapingStep };

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'runAuditAndImportTopPages',
    runAuditAndImportTopPagesStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'submitForScraping',
    submitForScraping,
    AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT,
  )
  .addStep('runCrawlDetectionAndGenerateSuggestions', runCrawlDetectionAndGenerateSuggestions)
  .build();
