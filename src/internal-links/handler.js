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
import {
  Audit,
  Site,
  Opportunity as Oppty,
  Suggestion as SuggestionDataAccess,
} from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { generateSuggestionData } from './suggestions-generator.js';
import { parseBrokenLinkComments } from './html-comment-parser.js';
import { wwwUrlResolver } from '../common/index.js';
import {
  calculateKpiDeltasForAudit,
  isLinkInaccessible,
  calculatePriority,
} from './helpers.js';
import { getScrapedDataForSiteId } from '../support/utils.js';

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
    /* ------------------------------------------------------------------ */
    /* --------- 1.  Collect broken links from RUM 404 data --------------*/
    /* ------------------------------------------------------------------ */
    const rumAPIClient = RUMAPIClient.createFrom(context);
    const options = {
      domain: finalUrl,
      interval: INTERVAL,
      granularity: 'hourly',
    };

    const internal404Links = await rumAPIClient.query(
      '404-internal-links',
      options,
    );

    const transformedLinks = internal404Links.map((link) => ({
      urlFrom: link.url_from,
      urlTo: link.url_to,
      trafficDomain: link.traffic_domain,
    }));
    const rumLinksCount = transformedLinks.length;

    /* ------------------------------------------------------------------ */
    /* --------- 2.  Extract broken links from HTML comments -------------*/
    /* ------------------------------------------------------------------ */
    const { dataAccess } = context;
    const { Configuration } = dataAccess;
    const configuration = await Configuration.findLatest();

    const htmlBrokenLinks = [];
    /*
     * ------------------------------------------------------------
     *  WHY WE SCAN HTML COMMENTS (in addition to RUM data)
     * ------------------------------------------------------------
     * Not every broken-internal-link ends up in the RUM 404 dataset,
     * therefore we complement the RUM source with the specialised
     * HTML comments that authors on AEM-CS / AMS publish, e.g.
     *
     *   <!-- BROKEN_INTERNAL_LINK: url="/content/wknd/…1.html" … -->
     *
     * During the audit we therefore:
     *   1. Fetch the stored raw HTML from the scraper (S3).
     *   2. Parse the comments and build the broken-link list.
     *
     * Edge Delivery (EDS) sites do not embed these comments, so we
     * disable this logic when the delivery type is AEM_EDGE.
     */
    // Only run for AEM-CS or AMS – skip Edge Delivery sites
    const isEdge = site.getDeliveryType() === Site.DELIVERY_TYPES.AEM_EDGE;
    if (
      !isEdge
      && configuration.isHandlerEnabledForSite('broken-internal-links-html-scan', site)
    ) {
      const scrapedData = await getScrapedDataForSiteId(site, context);
      const { siteData } = scrapedData;

      for (const page of siteData) {
        const rawHtml = page?.scrapeResult?.rawBody;
        const pageUrl = page?.finalUrl || page?.url;
        if (rawHtml && pageUrl) {
          htmlBrokenLinks.push(
            ...parseBrokenLinkComments(rawHtml, pageUrl, log),
          );
        }
      }
    } else {
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] HTML comment scanning disabled for site`);
    }

    /* ------------------------------------------------------------------ */
    /* ---------------- De-duplicate HTML comment links ------------------*/
    /* ------------------------------------------------------------------ */
    const allLinks = [...transformedLinks, ...htmlBrokenLinks];

    const dedupedMap = new Map();
    allLinks.forEach((l) => {
      const key = `${l.urlFrom}|${l.urlTo}`;
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, l);
      }
    });

    let finalLinks = calculatePriority([...dedupedMap.values()]);

    /* ------------------------------------------------------------------ */
    /* Validate that each urlTo is still inaccessible                      */
    /* ------------------------------------------------------------------ */
    const accessibilityChecks = await Promise.all(
      finalLinks.map(async (l) => ({
        link: l,
        inaccessible: await isLinkInaccessible(l.urlTo, log),
      })),
    );

    finalLinks = accessibilityChecks
      .filter(({ inaccessible }) => inaccessible)
      .map(({ link }) => link);

    const auditResult = {
      brokenInternalLinks: finalLinks,
      fullAuditRef: auditUrl,
      finalUrl,
      auditContext: {
        interval: INTERVAL,
        sources: {
          rumDataCount: rumLinksCount,
          htmlCommentCount: htmlBrokenLinks.length,
        },
      },
    };

    return {
      auditResult,
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
  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] starting audit`);
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
    site, dataAccess,
  } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  const urls = topPages.map((page) => ({ url: page.getUrl() }));
  return {
    urls,
    siteId: site.getId(),
    type: 'broken-internal-links',
  };
}

export async function opportunityAndSuggestionsStep(context) {
  const {
    log, site, finalUrl, audit, dataAccess,
  } = context;

  let { brokenInternalLinks } = audit.getAuditResult();

  // generate suggestions
  try {
    brokenInternalLinks = await generateSuggestionData(
      finalUrl,
      audit,
      context,
      site,
    );
  } catch (error) {
    log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] suggestion generation error: ${error.message}`);
  }

  // TODO: skip opportunity creation if no internal link items are found in the audit data
  const kpiDeltas = calculateKpiDeltasForAudit(brokenInternalLinks);

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
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no broken internal links found, skipping opportunity creation`);
    } else {
      // no broken internal links found, update opportunity status to RESOLVED
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no broken internal links found, but found opportunity, updating status to RESOLVED`);
      await opportunity.setStatus(Oppty.STATUSES.RESOLVED);

      // We also need to update all suggestions inside this opportunity
      // Get all suggestions for this opportunity
      const suggestions = await opportunity.getSuggestions();

      // If there are suggestions, update their status to outdated
      if (isNonEmptyArray(suggestions)) {
        const { Suggestion } = dataAccess;
        await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.OUTDATED);
      }
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }
    return {
      status: 'complete',
    };
  }

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

  const buildKey = (item) => `${item.urlFrom}-${item.urlTo}`;
  await syncSuggestions({
    opportunity,
    newData: brokenInternalLinks,
    context,
    buildKey,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: entry.trafficDomain,
      data: {
        title: entry.title,
        urlFrom: entry.urlFrom,
        urlTo: entry.urlTo,
        urlsSuggested: entry.urlsSuggested || [],
        aiRationale: entry.aiRationale || '',
        trafficDomain: entry.trafficDomain,
      },
    }),
    log,
  });
  return {
    status: 'complete',
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
    'prepareScraping',
    prepareScrapingStep,
    AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER,
  )
  .addStep('opportunityAndSuggestions', opportunityAndSuggestionsStep)
  .build();
