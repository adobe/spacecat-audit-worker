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

import { tracingFetch as fetch, prependSchema, stripWWW } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { Audit, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import calculateKpiMetrics from './kpi-metrics.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';
import { filterByAuditScope, extractPathPrefix } from '../internal-links/subpath-filter.js';
import { filterBrokenSuggestedUrls, isUnscrapeable } from '../utils/url-utils.js';
import BrightDataClient from '../support/bright-data-client.js';
import { sleep } from '../support/utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const TIMEOUT = 3000;
const BRIGHT_DATA_VALIDATE_URLS = 'BRIGHT_DATA_VALIDATE_URLS';
const BRIGHT_DATA_MAX_RESULTS = 'BRIGHT_DATA_MAX_RESULTS';
const BRIGHT_DATA_REQUEST_DELAY_MS = 'BRIGHT_DATA_REQUEST_DELAY_MS';

function getEnvBool(env, key, defaultValue) {
  if (env?.[key] === undefined) return defaultValue;
  return String(env[key]).toLowerCase() === 'true';
}

function getEnvInt(env, key, defaultValue) {
  const value = Number.parseInt(env?.[key], 10);
  return Number.isFinite(value) ? value : defaultValue;
}

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

    // Filter out excluded URLs with www-agnostic comparison
    // Normalize both URLs to compare (strip www, lowercase, add schema)
    const normalizeUrl = (url) => {
      try {
        const parsed = new URL(prependSchema(url));
        const normalizedHost = stripWWW(parsed.hostname).toLowerCase();
        return `${parsed.protocol}//${normalizedHost}${parsed.pathname}${parsed.search}${parsed.hash}`;
      } catch {
        return url; // If parsing fails, return original
      }
    };

    const filteredBacklinks = result?.backlinks?.filter((backlink) => {
      if (!excludedURLs || excludedURLs.length === 0) return true;

      const normalizedBacklink = normalizeUrl(backlink.url_to);
      return !excludedURLs.some((excludedUrl) => {
        const normalizedExcluded = normalizeUrl(excludedUrl);
        return normalizedBacklink === normalizedExcluded;
      });
    });

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

  const buildKey = (backlink) => `${backlink.url_from}|${backlink.url_to}`;

  // Custom merge function to preserve user-edited fields
  const mergeDataFunction = (existingData, newData) => {
    const merged = {
      ...existingData,
      ...newData,
    };

    // Preserve urlEdited and isEdited flag if user has made a selection (AI or custom)
    // eslint-disable-next-line max-len
    if (existingData.urlEdited !== undefined && existingData.urlEdited !== null && existingData.isEdited !== null) {
      merged.urlEdited = existingData.urlEdited;
      merged.isEdited = existingData.isEdited;
    } else {
      // Explicitly remove urlEdited if not present or flag is null
      delete merged.urlEdited;
    }

    return merged;
  };

  await syncSuggestions({
    opportunity,
    newData: auditResult?.brokenBacklinks,
    buildKey,
    context,
    mergeDataFunction,
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

  // Check if all suggestions were filtered out as invalid
  if (brokenLinks.length === 0 && suggestions.length > 0) {
    log.warn('No valid broken links to send to Mystique. Skipping message.');
    return {
      status: 'complete',
    };
  }

  // Bright Data: resolve suggestions first, then fallback to Mystique
  const useBrightData = Boolean(env.BRIGHT_DATA_API_KEY && env.BRIGHT_DATA_ZONE);
  const validateBrightDataUrls = getEnvBool(env, BRIGHT_DATA_VALIDATE_URLS, false);
  const brightDataMaxResults = getEnvInt(env, BRIGHT_DATA_MAX_RESULTS, 1);
  const brightDataRequestDelayMs = getEnvInt(env, BRIGHT_DATA_REQUEST_DELAY_MS, 500);

  const resolvedByBrightData = new Set();
  if (useBrightData && brokenLinks.length > 0) {
    log.info(`Bright Data enabled. Resolving ${brokenLinks.length} broken links (maxResults=${brightDataMaxResults}).`);
    const brightDataClient = BrightDataClient.createFrom(context);

    const processBrokenLink = async (brokenLink) => {
      const {
        results, keywords,
      } = await brightDataClient.googleSearchWithFallback(
        prependSchema(finalUrl || site.getBaseURL()),
        brokenLink.urlTo,
        brightDataMaxResults,
        {
          // Keep common prefixes like "blog" by default (do not strip)
          stripCommonPrefixes: false,
        },
      );

      if (!results || results.length === 0) {
        return;
      }

      const best = results[0];
      if (!best?.link) {
        return;
      }

      let urlsSuggested = [best.link];
      if (validateBrightDataUrls) {
        const validated = await filterBrokenSuggestedUrls(urlsSuggested, site.getBaseURL());
        if (validated.length === 0) {
          return;
        }
        urlsSuggested = validated;
      }

      const suggestion = await Suggestion.findById(brokenLink.suggestionId);
      if (!suggestion) {
        log.warn(`Bright Data: suggestion not found for ${brokenLink.suggestionId}`);
        return;
      }

      suggestion.setData({
        ...suggestion.getData(),
        urlsSuggested,
        aiRationale: `The suggested URL is chosen based on top search results for closely matching keywords from the broken URL. Keywords used: "${keywords}".`,
      });

      await suggestion.save();
      resolvedByBrightData.add(brokenLink.suggestionId);
    };

    const batchSize = 10;
    for (let i = 0; i < brokenLinks.length; i += batchSize) {
      const batch = brokenLinks.slice(i, i + batchSize);
      // eslint-disable-next-line no-await-in-loop
      await Promise.allSettled(batch.map((brokenLink) => processBrokenLink(brokenLink)
        .catch((error) => {
          log.warn(`Bright Data failed for ${brokenLink.urlTo}:`, error);
        })));
      if (i + batchSize < brokenLinks.length
        && Number.isFinite(brightDataRequestDelayMs)
        && brightDataRequestDelayMs > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(brightDataRequestDelayMs);
      }
    }
  }

  const brokenLinksForMystique = brokenLinks.filter(
    (link) => !resolvedByBrightData.has(link.suggestionId),
  );

  // Get top pages and filter by audit scope
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);

  // Filter alternatives by locales/subpaths present in broken links
  // This limits suggestions to relevant locales only
  const allTopPageUrls = filteredTopPages.map((page) => page.getUrl());

  // Extract unique locales/subpaths from broken links
  const brokenLinkLocales = new Set();
  brokenLinksForMystique.forEach((link) => {
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
  if (brokenLinksForMystique.length === 0) {
    log.info('All broken links resolved via Bright Data. Skipping Mystique.');
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
      brokenLinks: brokenLinksForMystique,
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
