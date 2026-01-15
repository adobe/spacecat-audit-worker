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
import { wwwUrlResolver } from '../common/index.js';
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

/**
 * Perform an audit to check which internal links for domain are broken.
 *
 * @async
 * @param {string} baseURL - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function internalLinksAuditRunner(auditUrl, context) {
  const { log, site } = context;
  const finalUrl = await wwwUrlResolver(site, context);

  log.info(`[${AUDIT_TYPE}] ====== RUM Detection Phase ======`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, Domain: ${finalUrl}`);

  try {
    // 1. Create RUM API client
    log.debug(`[${AUDIT_TYPE}] Creating RUM API client...`);
    const rumAPIClient = RUMAPIClient.createFrom(context);

    // 2. Prepare query options
    const options = {
      domain: finalUrl,
      interval: INTERVAL,
      granularity: 'hourly',
    };

    log.info(`[${AUDIT_TYPE}] Querying RUM API for 404 internal links (interval: ${INTERVAL} days)`);

    // 3. Query for 404 internal links
    const startTime = Date.now();
    const internal404Links = await rumAPIClient.query('404-internal-links', options);
    const queryDuration = Date.now() - startTime;

    log.info(`[${AUDIT_TYPE}] RUM API query completed in ${queryDuration}ms`);
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
    const validationStartTime = Date.now();

    const accessibilityResults = await Promise.all(
      internal404Links.map(async (link) => {
        const inaccessible = await isLinkInaccessible(link.url_to, log);
        if (inaccessible) {
          log.debug(`[${AUDIT_TYPE}] RUM: ${link.url_to} is still broken (traffic: ${link.traffic_domain})`);
        } else {
          log.debug(`[${AUDIT_TYPE}] RUM: ${link.url_to} is now fixed (was broken in RUM data)`);
        }
        return {
          link,
          inaccessible,
        };
      }),
    );

    const validationDuration = Date.now() - validationStartTime;
    log.info(`[${AUDIT_TYPE}] Link validation completed in ${validationDuration}ms`);

    // Count validation results
    const stillBroken = accessibilityResults.filter((r) => r.inaccessible).length;
    const nowFixed = accessibilityResults.filter((r) => !r.inaccessible).length;
    log.info(`[${AUDIT_TYPE}] Validation results: ${stillBroken} still broken, ${nowFixed} now fixed`);

    // 5. Filter only inaccessible links and transform for further processing
    // Also filter by audit scope (subpath/locale) if baseURL has a subpath
    const baseURL = site.getBaseURL();
    log.debug(`[${AUDIT_TYPE}] Filtering by audit scope: ${baseURL}`);

    const beforeScopeFilter = accessibilityResults.filter((result) => result.inaccessible).length;

    const inaccessibleLinks = accessibilityResults
      .filter((result) => result.inaccessible)
      .filter((result) => {
        // Filter broken links to only include those within audit scope
        // Both url_from and url_to should be within scope
        const fromInScope = isWithinAuditScope(result.link.url_from, baseURL);
        const toInScope = isWithinAuditScope(result.link.url_to, baseURL);

        if (!fromInScope || !toInScope) {
          log.debug(`[${AUDIT_TYPE}] Filtered out (out of scope): ${result.link.url_to} from ${result.link.url_from}`);
        }

        return fromInScope && toInScope;
      })
      .map((result) => ({
        urlFrom: result.link.url_from,
        urlTo: result.link.url_to,
        trafficDomain: result.link.traffic_domain,
      }));

    const outOfScope = beforeScopeFilter - inaccessibleLinks.length;
    if (outOfScope > 0) {
      log.info(`[${AUDIT_TYPE}] Filtered out ${outOfScope} links out of audit scope`);
    }

    // Calculate total traffic impact
    const totalTraffic = inaccessibleLinks.reduce((sum, link) => sum + link.trafficDomain, 0);
    log.info(`[${AUDIT_TYPE}] RUM detection complete: ${inaccessibleLinks.length} broken links (total traffic: ${totalTraffic} views)`);
    log.info(`[${AUDIT_TYPE}] ================================`);

    // 6. Build and return audit result (priority will be calculated after merge with crawl data)
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

/**
 * Submit URLs for scraping (for crawl-based detection)
 * Combines Ahrefs top pages + includedURLs from siteConfig
 */
export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
  } = context;
  const { SiteTopPage } = dataAccess;

  log.info(`[${AUDIT_TYPE}] ====== Submit for Scraping Step ======`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, BaseURL: ${site.getBaseURL()}`);

  // Fetch Ahrefs top pages
  log.debug(`[${AUDIT_TYPE}] Fetching Ahrefs top pages from database...`);
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  const topPagesUrls = topPages.map((page) => page.getUrl());
  log.info(`[${AUDIT_TYPE}] Found ${topPagesUrls.length} Ahrefs top pages`);

  // Get manual includedURLs from siteConfig
  log.debug(`[${AUDIT_TYPE}] Fetching includedURLs from siteConfig...`);
  const includedURLs = await site?.getConfig()?.getIncludedURLs('broken-internal-links') || [];
  log.info(`[${AUDIT_TYPE}] Found ${includedURLs.length} manual includedURLs from siteConfig`);

  if (includedURLs.length > 0) {
    log.debug(`[${AUDIT_TYPE}] Manual includedURLs: ${includedURLs.slice(0, 5).join(', ')}${includedURLs.length > 5 ? '...' : ''}`);
  }

  // Merge and deduplicate
  const beforeMerge = topPagesUrls.length + includedURLs.length;
  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  const duplicatesRemoved = beforeMerge - finalUrls.length;

  log.info(`[${AUDIT_TYPE}] Merged URLs: ${topPagesUrls.length} (Ahrefs) + ${includedURLs.length} (manual) = ${finalUrls.length} unique (${duplicatesRemoved} duplicates removed)`);

  if (finalUrls.length === 0) {
    log.error(`[${AUDIT_TYPE}] No URLs found for site ${site.getId()} - neither Ahrefs top pages nor includedURLs`);
    throw new Error(`[${AUDIT_TYPE}] No URLs found for site neither top pages nor included URLs for ${site.getId()}`);
  }

  // Filter out PDF and other unscrape-able files before scraping
  const filteredUrls = finalUrls.filter((url) => !isUnscrapeable(url));
  const unscrapeable = finalUrls.length - filteredUrls.length;

  if (unscrapeable > 0) {
    log.info(`[${AUDIT_TYPE}] Filtered out ${unscrapeable} unscrape-able files (PDFs, Office docs, etc.)`);
    log.debug(`[${AUDIT_TYPE}] Scrapeable URLs: ${filteredUrls.length}/${finalUrls.length}`);
  }

  log.info(`[${AUDIT_TYPE}] Submitting ${filteredUrls.length} URLs for scraping`);
  log.info(`[${AUDIT_TYPE}] =======================================`);

  return {
    urls: filteredUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'broken-internal-links',
    allowCache: false,
    maxScrapeAge: 0,
  };
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

export const opportunityAndSuggestionsStep = async (context) => {
  const {
    log, site, finalUrl, sqs, env, dataAccess, audit,
  } = context;
  const { Configuration, Suggestion, SiteTopPage } = dataAccess;

  const { brokenInternalLinks, success } = audit.getAuditResult();

  if (!success) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping suggestions generation`);
    return {
      status: 'complete',
    };
  }

  if (!isNonEmptyArray(brokenInternalLinks)) {
    // no broken internal links found
    // fetch opportunity
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
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}]
  no broken internal links found, skipping opportunity creation`);
    } else {
      // no broken internal links found, update opportunity status to RESOLVED
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no broken internal
  links found, but found opportunity, updating status to RESOLVED`);
      await opportunity.setStatus(Oppty.STATUSES.RESOLVED);

      // We also need to update all suggestions inside this opportunity
      // Get all suggestions for this opportunity
      const suggestions = await opportunity.getSuggestions();

      // If there are suggestions, update their status to fixed
      if (isNonEmptyArray(suggestions)) {
        await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.FIXED);
      }
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }
    return {
      status: 'complete',
    };
  }

  const kpiDeltas = calculateKpiDeltasForAudit(brokenInternalLinks);

  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    {
      kpiDeltas,
    },
  );
  await syncBrokenInternalLinksSuggestions({
    opportunity,
    brokenInternalLinks,
    context,
    opportunityId: opportunity.getId(),
    log,
  });

  const configuration = await Configuration.findLatest();
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  log.info(
    `[${AUDIT_TYPE}] [Site: ${site.getId()}] Found ${topPages.length} top pages from Ahrefs`,
  );

  // Filter top pages by audit scope (subpath/locale) if baseURL has a subpath
  // This determines what alternatives Mystique will see:
  // - If baseURL is "site.com/en-ca" → only /en-ca alternatives
  // - If baseURL is "site.com" → ALL locales alternatives
  // Mystique will then filter by domain (not locale), so cross-locale suggestions
  // are possible if audit scope includes multiple locales
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);

  log.info(
    `[${AUDIT_TYPE}] [Site: ${site.getId()}] After audit scope filtering: ${filteredTopPages.length} top pages available`,
  );

  if (configuration.isHandlerEnabledForSite('broken-internal-links-auto-suggest', site)) {
    const suggestions = await Suggestion.allByOpportunityIdAndStatus(
      opportunity.getId(),
      SuggestionDataAccess.STATUSES.NEW,
    );

    // Build broken links array without per-link alternatives
    // Mystique expects: brokenLinks with only urlFrom, urlTo, suggestionId
    const brokenLinks = suggestions
      .map((suggestion) => ({
        urlFrom: suggestion?.getData()?.urlFrom,
        urlTo: suggestion?.getData()?.urlTo,
        suggestionId: suggestion?.getId(),
      }))
      .filter((link) => link.urlFrom && link.urlTo && link.suggestionId); // Filter invalid entries

    // Filter alternatives by locales/subpaths present in broken links
    // This limits suggestions to relevant locales only
    const allTopPageUrls = filteredTopPages.map((page) => page.getUrl());

    // Extract unique locales/subpaths from broken links
    const brokenLinkLocales = new Set();
    brokenLinks.forEach((link) => {
      const locale = extractPathPrefix(link.urlTo);
      if (locale) {
        brokenLinkLocales.add(locale);
      }
    });

    // Filter alternatives to only include URLs matching broken links' locales
    // If no locales found (no subpath), include all alternatives
    // Always ensure alternativeUrls is an array (even if empty)
    let alternativeUrls = [];
    if (brokenLinkLocales.size > 0) {
      alternativeUrls = allTopPageUrls.filter((url) => {
        const urlLocale = extractPathPrefix(url);
        // Include if URL matches one of the broken links' locales, or has no locale
        return !urlLocale || brokenLinkLocales.has(urlLocale);
      });
    } else {
      // No locale prefixes found, include all alternatives
      alternativeUrls = allTopPageUrls;
    }

    // Filter out unscrape-able file types before sending to Mystique
    const originalCount = alternativeUrls.length;
    alternativeUrls = alternativeUrls.filter((url) => !isUnscrapeable(url));
    if (alternativeUrls.length < originalCount) {
      log.info(`[${AUDIT_TYPE}] Filtered out ${originalCount - alternativeUrls.length} unscrape-able file URLs (PDFs, Office docs, etc.) from alternative URLs before sending to Mystique`);
    }

    // Validate before sending to Mystique
    if (brokenLinks.length === 0) {
      log.warn(
        `[${AUDIT_TYPE}] [Site: ${site.getId()}] No valid broken links to send to Mystique. Skipping message.`,
      );
      return {
        status: 'complete',
      };
    }

    if (!opportunity?.getId()) {
      log.error(
        `[${AUDIT_TYPE}] [Site: ${site.getId()}] Opportunity ID is missing. Cannot send to Mystique.`,
      );
      return {
        status: 'complete',
      };
    }

    if (alternativeUrls.length === 0) {
      log.warn(
        `[${AUDIT_TYPE}] [Site: ${site.getId()}] No alternative URLs available. Cannot generate suggestions. Skipping message to Mystique.`,
      );
      return {
        status: 'complete',
      };
    }

    const message = {
      type: 'guidance:broken-links',
      siteId: site.getId(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        alternativeUrls,
        opportunityId: opportunity.getId(),
        brokenLinks,
      },
    };
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.debug(`Message sent to Mystique: ${JSON.stringify(message)}`);
  }
  return {
    status: 'complete',
  };
};

/**
 * Run crawl-based detection, merge with RUM results, and generate opportunities/suggestions
 * This is the final step that combines crawl detection with opportunity generation
 */
export async function runCrawlDetectionAndGenerateSuggestions(context) {
  const {
    log, site, audit, scrapeResultPaths, dataAccess,
  } = context;
  const { Configuration } = dataAccess;

  log.info(`[${AUDIT_TYPE}] ====== Crawl Detection Step ======`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, BaseURL: ${site.getBaseURL()}`);

  // Get RUM results from previous audit step
  const auditResult = audit.getAuditResult();
  const rumLinks = auditResult.brokenInternalLinks || [];

  log.info(`[${AUDIT_TYPE}] RUM detection results: ${rumLinks.length} broken links`);
  if (rumLinks.length > 0) {
    const rumTraffic = rumLinks.reduce((sum, link) => sum + (link.trafficDomain || 0), 0);
    log.debug(`[${AUDIT_TYPE}] RUM links total traffic: ${rumTraffic} views`);
  }

  // Check feature toggle
  log.debug(`[${AUDIT_TYPE}] Checking feature toggle: broken-internal-links-crawl`);
  const configuration = await Configuration.findLatest();
  const isCrawlEnabled = configuration.isHandlerEnabledForSite('broken-internal-links-crawl', site);

  let finalLinks;

  if (!isCrawlEnabled) {
    log.info(`[${AUDIT_TYPE}] ⚠️  Feature toggle OFF: Crawl detection is disabled for site ${site.getId()}`);
    log.info(`[${AUDIT_TYPE}] Using RUM-only results (legacy behavior)`);
    finalLinks = rumLinks;
  } else {
    log.info(`[${AUDIT_TYPE}] ✓ Feature toggle ON: Crawl detection is enabled for site ${site.getId()}`);
    log.info(`[${AUDIT_TYPE}] Scrape result paths available: ${scrapeResultPaths.size}`);

    if (scrapeResultPaths.size === 0) {
      log.warn(`[${AUDIT_TYPE}] No scraped content available, falling back to RUM-only results`);
      finalLinks = rumLinks;
    } else {
      // Run crawl detection
      log.info(`[${AUDIT_TYPE}] Starting crawl-based detection...`);
      const startTime = Date.now();

      const crawlLinks = await detectBrokenLinksFromCrawl(scrapeResultPaths, context);

      const crawlDuration = Date.now() - startTime;
      log.info(`[${AUDIT_TYPE}] Crawl detection completed in ${crawlDuration}ms`);
      log.info(`[${AUDIT_TYPE}] Crawl detected ${crawlLinks.length} broken links`);

      // Merge crawl + RUM results (RUM takes priority for traffic data)
      log.info(`[${AUDIT_TYPE}] Merging RUM (${rumLinks.length}) + Crawl (${crawlLinks.length}) results...`);
      finalLinks = mergeAndDeduplicate(crawlLinks, rumLinks, log);

      const crawlOnlyLinks = finalLinks.filter((link) => link.trafficDomain === 0);
      const rumOnlyLinks = finalLinks.filter(
        (link) => link.trafficDomain > 0 && !crawlLinks.some((c) => c.urlTo === link.urlTo),
      );
      const overlapLinks = finalLinks.length - crawlOnlyLinks.length - rumOnlyLinks.length;

      log.info(`[${AUDIT_TYPE}] Merge results: ${finalLinks.length} total (${crawlOnlyLinks.length} crawl-only, ${rumOnlyLinks.length} RUM-only, ${overlapLinks} overlap)`);
    }
  }

  // Calculate priority for all links (after merge or RUM-only)
  log.info(`[${AUDIT_TYPE}] Calculating priority for ${finalLinks.length} broken links...`);
  const prioritizedLinks = calculatePriority(finalLinks);

  // Count by priority
  const highPriority = prioritizedLinks.filter((link) => link.priority === 'high').length;
  const mediumPriority = prioritizedLinks.filter((link) => link.priority === 'medium').length;
  const lowPriority = prioritizedLinks.filter((link) => link.priority === 'low').length;

  log.info(`[${AUDIT_TYPE}] Priority distribution: ${highPriority} high, ${mediumPriority} medium, ${lowPriority} low`);

  // Update audit result with prioritized links
  audit.setAuditResult({
    ...auditResult,
    brokenInternalLinks: prioritizedLinks,
  });

  log.info(`[${AUDIT_TYPE}] Updated audit result with ${prioritizedLinks.length} prioritized broken links`);
  log.info(`[${AUDIT_TYPE}] ===================================`);

  // Now generate opportunities and suggestions
  return opportunityAndSuggestionsStep(context);
}

export async function prepareScrapingStep(context) {
  const {
    log, site, dataAccess, audit,
  } = context;
  const { SiteTopPage } = dataAccess;
  const { success } = audit.getAuditResult();
  if (!success) {
    throw new Error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skip scraping and suggestion generation`);
  }
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  // Filter top pages by audit scope (subpath/locale) if baseURL has a subpath
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] found ${topPages.length} top pages, ${filteredTopPages.length} within audit scope`);

  if (filteredTopPages.length === 0) {
    if (topPages.length === 0) {
      throw new Error(`No top pages found in database for site ${site.getId()}. Ahrefs import required.`);
    } else {
      throw new Error(`All ${topPages.length} top pages filtered out by audit scope. BaseURL: ${baseURL} requires subpath match but no pages match scope.`);
    }
  }

  const urls = filteredTopPages
    .map((page) => page.getUrl())
    .filter((url) => !isUnscrapeable(url))
    .map((url) => ({ url }));

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Sending ${urls.length} scrapeable URLs (filtered out PDFs and other file types) for scraping`);

  return {
    urls,
    siteId: site.getId(),
    type: 'broken-internal-links',
  };
}

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
