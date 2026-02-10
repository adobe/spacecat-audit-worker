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

  try {
    // 1. Create RUM API client
    const rumAPIClient = RUMAPIClient.createFrom(context);

    // 2. Prepare query options
    const options = {
      domain: finalUrl,
      interval: INTERVAL,
      granularity: 'hourly',
    };

    // 3. Query for 404 internal links
    const internal404Links = await rumAPIClient.query('404-internal-links', options);

    // 4. Check accessibility in parallel before transformation
    const accessibilityResults = await Promise.all(
      internal404Links.map(async (link) => ({
        link,
        inaccessible: await isLinkInaccessible(link.url_to, log),
      })),
    );

    // 5. Filter only inaccessible links and transform for further processing
    // Also filter by audit scope (subpath/locale) if baseURL has a subpath
    const baseURL = site.getBaseURL();

    const inaccessibleLinks = accessibilityResults
      .filter((result) => result.inaccessible)
      .filter((result) => (
        // Filter broken links to only include those within audit scope
        // Both url_from and url_to should be within scope
        isWithinAuditScope(result.link.url_from, baseURL)
        && isWithinAuditScope(result.link.url_to, baseURL)
      ))
      .map((result) => ({
        // Preserve original URLs from RUM data
        urlFrom: result.link.url_from,
        urlTo: result.link.url_to,
        trafficDomain: result.link.traffic_domain,
      }));

    // 6. Prioritize links
    const prioritizedLinks = calculatePriority(inaccessibleLinks);

    // 7. Build and return audit result
    return {
      auditResult: {
        brokenInternalLinks: prioritizedLinks,
        fullAuditRef: auditUrl,
        finalUrl,
        auditContext: { interval: INTERVAL },
        success: true,
      },
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] audit failed with error: ${error.message}`);
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

      // If there are suggestions, update their status to outdated
      if (isNonEmptyArray(suggestions)) {
        await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.OUTDATED);
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
    // URLs are already normalized at audit time (step 5 in internalLinksAuditRunner)
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
        // Include canonical domain for Mystique to use when looking up content
        // This ensures Mystique uses the same domain as the normalized URLs
        siteBaseURL: `https://${finalUrl}`,
      },
    };
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.debug(`Message sent to Mystique: ${JSON.stringify(message)}`);
  }
  return {
    status: 'complete',
  };
};

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'runAuditAndImportTopPages',
    runAuditAndImportTopPagesStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'prepareScraping',
    prepareScrapingStep,
    AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT,
  )
  .addStep('trigger-ai-suggestions', opportunityAndSuggestionsStep)
  .build();
