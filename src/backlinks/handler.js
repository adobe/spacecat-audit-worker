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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { Audit, Suggestion as SuggestionModel, FixEntity } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import calculateKpiMetrics from './kpi-metrics.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions, publishDeployedFixesForFixedSuggestions } from '../utils/data-access.js';
import { filterByAuditScope, extractPathPrefix } from '../internal-links/subpath-filter.js';
import { isUnscrapeable } from '../utils/url-utils.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_BACKLINKS;

const { AUDIT_STEP_DESTINATIONS } = Audit;

const TIMEOUT = 3000;

async function filterOutValidBacklinks(backlinks, log) {
  const fetchWithTimeout = async (url, timeout) => {
    try {
      return await fetch(url, { timeout });
    } catch (error) {
      if (error.code === 'ETIMEOUT') {
        log.warn(`Request to ${url} timed out after ${timeout}ms`);
        return { ok: false, status: 408 };
      } else {
        log.warn(`Request to ${url} failed with error: ${error.message}`);
      }
    }
    return { ok: false, status: 500 };
  };

  const isStillBrokenBacklink = async (backlink) => {
    const response = await fetchWithTimeout(backlink.url_to, TIMEOUT);
    if (!response.ok && response.status !== 404
      && response.status >= 400 && response.status < 500) {
      log.warn(`Backlink ${backlink.url_to} returned status ${response.status}`);
    }
    return !response.ok;
  };

  const backlinkStatuses = [];
  for (const backlink of backlinks) {
    // eslint-disable-next-line no-await-in-loop
    const result = await isStillBrokenBacklink(backlink);
    backlinkStatuses.push(result);
  }

  // const backlinkStatuses = await Promise.all(backlinks.map(isStillBrokenBacklink));
  return backlinks.filter((_, index) => backlinkStatuses[index]);
}

export async function brokenBacklinksAuditRunner(auditUrl, context, site) {
  const { log } = context;
  const siteId = site.getId();

  try {
    const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);
    const {
      result,
      fullAuditRef,
    } = await ahrefsAPIClient.getBrokenBacklinks(auditUrl);
    log.debug(`Found ${result?.backlinks?.length} broken backlinks for siteId: ${siteId} and url ${auditUrl}`);
    const excludedURLs = site.getConfig().getExcludedURLs('broken-backlinks');
    const filteredBacklinks = result?.backlinks?.filter(
      (backlink) => !excludedURLs?.includes(backlink.url_to),
    );

    return {
      fullAuditRef,
      auditResult: {
        finalUrl: auditUrl,
        brokenBacklinks: await filterOutValidBacklinks(filteredBacklinks, log),
      },
    };
  } catch (e) {
    log.error(`Broken Backlinks audit for ${siteId} with url ${auditUrl} failed with error: ${e.message}`, e);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: `Broken Backlinks audit for ${siteId} with url ${auditUrl} failed with error: ${e.message}`,
        success: false,
      },
    };
  }
}

export async function runAuditAndImportTopPages(context) {
  const { site, finalUrl } = context;
  const result = await brokenBacklinksAuditRunner(finalUrl, context, site);

  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: result.auditResult,
    fullAuditRef: result.fullAuditRef,
  };
}

export async function submitForScraping(context) {
  const {
    site, dataAccess, audit, log,
  } = context;
  const { SiteTopPage } = dataAccess;
  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    throw new Error('Audit failed, skipping scraping and suggestions generation');
  }
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

  // Filter top pages by audit scope (subpath/locale) if baseURL has a subpath
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);

  log.info(`Found ${topPages.length} top pages, ${filteredTopPages.length} within audit scope`);

  if (filteredTopPages.length === 0) {
    if (topPages.length === 0) {
      throw new Error(`No top pages found in database for site ${site.getId()}. Ahrefs import required.`);
    } else {
      throw new Error(`All ${topPages.length} top pages filtered out by audit scope. BaseURL: ${baseURL} requires subpath match but no pages match scope.`);
    }
  }

  return {
    urls: filteredTopPages.map((topPage) => ({ url: topPage.getUrl() })),
    siteId: site.getId(),
    type: 'broken-backlinks',
  };
}

export const generateSuggestionData = async (context) => {
  const {
    site, audit, dataAccess, log, sqs, env, finalUrl,
  } = context;
  const { Configuration, Suggestion, SiteTopPage } = dataAccess;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    throw new Error('Audit failed, skipping suggestions generation');
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-backlinks-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    throw new Error('Auto-suggest is disabled for site');
  }

  // Check if there are broken backlinks BEFORE creating opportunity
  if (!auditResult?.brokenBacklinks
    || !Array.isArray(auditResult.brokenBacklinks)
    || auditResult.brokenBacklinks.length === 0) {
    log.info(`No broken backlinks found for ${site.getId()}, skipping opportunity creation`);
    return {
      status: 'complete',
    };
  }

  const kpiDeltas = await calculateKpiMetrics(audit, context, site);

  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    Audit.AUDIT_TYPES.BROKEN_BACKLINKS,
    kpiDeltas,
  );

  // Before publishing fix entities, reconcile suggestions that disappeared
  // from current audit results.
  // If a previous suggestion's url_to now redirects to one of its urlsSuggested, mark it FIXED
  // and ensure a PUBLISHED fix entity exists.
  try {
    const existingSuggestions = await opportunity.getSuggestions();
    const currentKeys = new Set(
      auditResult.brokenBacklinks.map((l) => `${l.url_from}|${l.url_to}`),
    );
    const candidates = existingSuggestions.filter((s) => {
      const data = s?.getData?.() || {};
      const key = `${data.url_from}|${data.url_to}`;
      return !currentKeys.has(key);
    });

    const normalize = (u) => {
      if (typeof u !== 'string') return '';
      return u.replace(/\/+$/, '');
    };

    // Helper: returns true if url_to eventually resolves to any candidate URL
    const redirectsToAny = async (urlTo, targets) => {
      try {
        const resp = await fetch(urlTo, { redirect: 'follow' });
        const finalResolvedUrl = normalize(resp?.url || urlTo);
        return targets.some((t) => normalize(t) === finalResolvedUrl);
      } catch (e) {
        // treat network errors as not matching
        return false;
      }
    };

    const fixEntityObjects = [];
    const updatePromises = [];

    for (const suggestion of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const data = suggestion?.getData?.();
      const urlTo = data?.url_to;
      const targets = Array.isArray(data?.urlsSuggested) ? data.urlsSuggested : [];
      if (!urlTo || targets.length === 0) {
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const matches = await redirectsToAny(urlTo, targets);
      if (!matches) {
        // eslint-disable-next-line no-continue
        continue;
      }

      // Mark suggestion as FIXED and prepare a PUBLISHED fix entity on the opportunity
      try {
        suggestion.setStatus?.(SuggestionModel.STATUSES.FIXED);
        suggestion.setUpdatedBy?.('system');
        updatePromises.push(suggestion.save?.());
      } catch (e) {
        log.warn(`[${AUDIT_TYPE}] Failed to mark suggestion ${suggestion?.getId?.()} as FIXED: ${e.message}`);
      }

      try {
        const published = FixEntity?.STATUSES?.PUBLISHED;
        if (published && typeof opportunity.addFixEntities === 'function') {
          const updatedValue = data?.urlEdited || data?.urlsSuggested[0] || '';
          fixEntityObjects.push({
            opportunityId: opportunity.getId(),
            status: published,
            type: suggestion?.getType?.(),
            executedAt: new Date().toISOString(),
            changeDetails: {
              system: site.getDeliveryType(),
              pagePath: data?.url_from,
              oldValue: data?.url_to,
              updatedValue,
            },
            suggestions: [suggestion?.getId?.()],
          });
        }
      } catch (e) {
        log.warn(`[${AUDIT_TYPE}] Failed building fix entity payload for suggestion ${suggestion?.getId?.()}: ${e.message}`);
      }
    }

    if (fixEntityObjects.length > 0 && typeof opportunity.addFixEntities === 'function') {
      try {
        await opportunity.addFixEntities(fixEntityObjects);
      } catch (e) {
        log.warn(`[${AUDIT_TYPE}] Failed to add fix entities on opportunity ${opportunity.getId?.()}: ${e.message}`);
      }
    }
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }
  } catch (e) {
    log.warn(`[${AUDIT_TYPE}] Failed reconciliation for disappeared suggestions: ${e.message}`);
  }

  // Publish any DEPLOYED fixes whose associated suggestion targets are no longer broken.
  try {
    await publishDeployedFixesForFixedSuggestions({
      opportunityId: opportunity.getId(),
      FixEntity,
      log,
      isSuggestionStillBrokenInLive: async (suggestion) => {
        const url = suggestion?.getData?.()?.url_to;
        if (!url) {
          return true;
        }
        const stillBrokenItems = await filterOutValidBacklinks([{ url_to: url }], log);
        return stillBrokenItems.length > 0;
      },
    });
  } catch (err) {
    log.warn(`Failed to publish fix entities for FIXED suggestions: ${err.message}`);
  }

  const buildKey = (backlink) => `${backlink.url_from}|${backlink.url_to}`;
  await syncSuggestions({
    opportunity,
    newData: auditResult?.brokenBacklinks,
    buildKey,
    context,
    mapNewSuggestion: (backlink) => ({
      opportunityId: opportunity.getId(),
      type: 'REDIRECT_UPDATE',
      rank: backlink.traffic_domain,
      data: {
        title: backlink.title,
        url_from: backlink.url_from,
        url_to: backlink.url_to,
        traffic_domain: backlink.traffic_domain,
      },
    }),
  });
  const suggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionModel.STATUSES.NEW,
  );

  // Build broken links array
  const brokenLinks = suggestions
    .map((suggestion) => ({
      urlFrom: suggestion?.getData()?.url_from,
      urlTo: suggestion?.getData()?.url_to,
      suggestionId: suggestion?.getId(),
    }))
    .filter((link) => link.urlFrom && link.urlTo && link.suggestionId); // Filter invalid entries

  // Get top pages and filter by audit scope
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);

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
    log.info(`Filtered out ${originalCount - alternativeUrls.length} unscrape-able file URLs (PDFs, Office docs, etc.) from alternative URLs before sending to Mystique`);
  }

  // Validate before sending to Mystique
  if (brokenLinks.length === 0) {
    log.warn('No valid broken links to send to Mystique. Skipping message.');
    return {
      status: 'complete',
    };
  }

  if (alternativeUrls.length === 0) {
    log.warn('No alternative URLs available. Cannot generate suggestions. Skipping message to Mystique.');
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
      opportunityId: opportunity?.getId(),
      brokenLinks,
    },
  };
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.debug(`Message sent to Mystique: ${JSON.stringify(message)}`);
  return {
    status: 'complete',
  };
};

export default new AuditBuilder()
  .withUrlResolver((site) => site.resolveFinalURL())
  .addStep('audit-and-import-top-pages', runAuditAndImportTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('generate-suggestion-data', generateSuggestionData)
  .build();
