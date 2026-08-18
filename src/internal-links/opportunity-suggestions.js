/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { pickUrlsFromSerpResults } from '../support/bright-data-serp-urls.js';
import { createInternalLinksConfigResolver } from './config.js';
import { createInternalLinksStepLogger } from './logging.js';
import { warnOnInvalidSuggestionData } from '../utils/data-access.js';
import { getMergedAuditInputUrls } from '../utils/audit-input-urls.js';
import { loadScrapeResultPaths } from './batch-state.js';
import { normalizeComparableUrl } from './link-key.js';
import { isWithinAuditScope } from './subpath-filter.js';

/**
 * Builds the crawl-coverage set for this run: the normalized set of source pages
 * (urlFrom) that were part of this audit's crawl scope, reconstructed from the
 * scrape-result-paths manifest. A non-empty set means this was a crawl run, so the
 * OUTDATED sweep can trust "absence == fix" only for pages in the set (SITES-49911).
 * Returns null when no manifest exists (RUM/LinkChecker-only runs), so callers fall
 * back to prior absence-only behavior.
 *
 * @param {string} auditId - The audit ID.
 * @param {Object} loaderContext - Context carrying s3Client/env for the S3 read.
 * @param {Object} log - Logger instance.
 * @returns {Promise<Set<string>|null>}
 */
async function buildCrawledUrlFromSet(auditId, loaderContext, log) {
  // No S3 client (e.g. some test contexts / degenerate runs) — do not attempt the
  // manifest read. Returning null keeps the caller on prior absence-only behavior
  // without emitting a spurious error log from the S3 layer.
  if (!loaderContext?.s3Client) {
    log.debug('Scope guard: no s3Client available; outdating falls back to absence-only');
    return null;
  }
  try {
    const scrapeResultPaths = await loadScrapeResultPaths(auditId, loaderContext);
    if (scrapeResultPaths && scrapeResultPaths.size > 0) {
      const set = new Set(
        Array.from(scrapeResultPaths.keys())
          .map((url) => normalizeComparableUrl(url))
          .filter(Boolean),
      );
      log.info(`Scope guard: ${set.size} crawled pages available for outdating coverage`);
      return set;
    }
    log.info('Scope guard: no crawl coverage manifest found; outdating falls back to absence-only');
    return null;
  } catch (error) {
    log.warn(`Scope guard: failed to load crawl coverage (${error.message}); outdating falls back to absence-only`);
    return null;
  }
}

export function createOpportunityAndSuggestionsStep({
  auditType,
  opptyStatuses,
  suggestionStatuses,
  isNonEmptyArray,
  createContextLogger,
  calculateKpiDeltasForAudit,
  convertToOpportunity,
  createOpportunityData,
  syncBrokenInternalLinksSuggestions,
  filterByAuditScope,
  extractPathPrefix,
  filterBrokenSuggestedUrls,
  BrightDataClient,
  buildLocaleSearchUrl,
  sleep,
  updateAuditResult,
  isCanonicalOrHreflangLink,
}) {
  return async function opportunityAndSuggestionsStep(context) {
    const {
      log: baseLog, site, finalUrl, sqs, env, dataAccess, audit, updatedAuditResult,
    } = context;
    const config = createInternalLinksConfigResolver(site, env);
    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType,
      siteId: site.getId(),
      auditId: audit.getId(),
      step: 'opportunity-and-suggestions',
    });
    const { Suggestion } = dataAccess;
    const maxBrokenLinksReported = config.getMaxBrokenLinksReported();
    const maxBrokenLinksPerBatch = config.getMaxBrokenLinksPerBatch();
    const brightDataBatchSize = config.getBrightDataBatchSize();
    const maxAlternativeUrlsToSend = config.getMaxAlternativeUrlsToSend();
    const brightDataConfig = config.getBrightDataConfig();
    const mystiqueItemTypes = new Set(config.getMystiqueItemTypes());

    const auditResultToUse = updatedAuditResult || audit.getAuditResult();
    const { brokenInternalLinks, success } = auditResultToUse;
    const filteredBrokenInternalLinks = (brokenInternalLinks || []).filter(
      (link) => !isCanonicalOrHreflangLink(link),
    );
    const reportedLinks = filteredBrokenInternalLinks.length > maxBrokenLinksReported
      ? filteredBrokenInternalLinks.slice(0, maxBrokenLinksReported)
      : filteredBrokenInternalLinks;

    if (!success) {
      log.info('Audit failed, skipping suggestions generation');
      return { status: 'complete', reportedBrokenLinks: reportedLinks };
    }

    // Crawl-coverage set for this run (SITES-49911). Non-empty => this was a crawl run
    // and "absence == fix" is only trustworthy for pages actually in crawl scope.
    // Null => RUM/LinkChecker-only run => preserve prior absence-only behavior.
    const crawledUrlFromSet = await buildCrawledUrlFromSet(
      audit.getId(),
      { ...context, log },
      log,
    );

    if (filteredBrokenInternalLinks.length > maxBrokenLinksReported) {
      log.warn(`Capping reported broken links from ${filteredBrokenInternalLinks.length} to ${maxBrokenLinksReported} (priority order)`);
      await updateAuditResult(
        audit,
        auditResultToUse,
        reportedLinks,
        dataAccess,
        log,
        site.getId(),
      );
    }

    if (!isNonEmptyArray(reportedLinks)) {
      const { Opportunity } = dataAccess;
      let opportunity;
      try {
        const opportunities = await Opportunity
          .allBySiteIdAndStatus(site.getId(), opptyStatuses.NEW);
        opportunity = opportunities.find((oppty) => oppty.getType() === auditType);
      } catch (e) {
        log.error(`Fetching opportunities failed with error: ${e.message}`);
        throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
      }

      if (!opportunity) {
        log.info('no broken internal links found, skipping opportunity creation');
      } else {
        const suggestions = await opportunity.getSuggestions();
        // Preserve operator decisions on SKIPPED / REJECTED — flipping those to
        // OUTDATED would destroy the decision and bump updatedAt, corrupting
        // the ASO "Moved to Rejected / Skipped" metrics (SITES-44646).
        const nonFrozen = (suggestions || []).filter((s) => ![
          suggestionStatuses.SKIPPED,
          suggestionStatuses.REJECTED,
        ].includes(s.getStatus()));

        if (crawledUrlFromSet && crawledUrlFromSet.size > 0) {
          // Crawl run: "zero broken links" is only trustworthy for pages actually
          // crawled this run. Outdate a suggestion only if its source page was
          // covered; hold the opportunity open (do NOT resolve) when any suggestion
          // sits on a page we did not crawl, since those links are unconfirmed rather
          // than fixed (SITES-49911).
          const isCovered = (s) => {
            const from = normalizeComparableUrl(s.getData()?.urlFrom);
            return Boolean(from) && crawledUrlFromSet.has(from);
          };
          const covered = nonFrozen.filter(isCovered);
          const uncoveredCount = nonFrozen.length - covered.length;

          if (isNonEmptyArray(covered)) {
            await Suggestion.bulkUpdateStatus(covered, suggestionStatuses.OUTDATED);
          }

          if (uncoveredCount === 0) {
            log.info('no broken internal links found and all suggestions were crawled this run, updating opportunity to RESOLVED');
            await opportunity.setStatus(opptyStatuses.RESOLVED);
            opportunity.setUpdatedBy('system');
            await opportunity.save();
          } else {
            log.info(`no broken internal links found, but ${uncoveredCount} suggestion(s) sit on pages not crawled this run; holding opportunity open and outdating only the ${covered.length} confirmed`);
          }
        } else {
          // RUM/LinkChecker-only run (no crawl coverage manifest): preserve prior
          // behavior — resolve the opportunity and outdate all non-frozen suggestions.
          log.info('no broken internal links found (no crawl coverage), updating opportunity to RESOLVED');
          await opportunity.setStatus(opptyStatuses.RESOLVED);
          if (isNonEmptyArray(nonFrozen)) {
            await Suggestion.bulkUpdateStatus(nonFrozen, suggestionStatuses.OUTDATED);
          }
          opportunity.setUpdatedBy('system');
          await opportunity.save();
        }
      }
      return { status: 'complete', reportedBrokenLinks: reportedLinks };
    }

    const kpiDeltas = calculateKpiDeltasForAudit(reportedLinks);
    const contextualContext = {
      ...context,
      log,
    };

    const opportunity = await convertToOpportunity(
      finalUrl,
      { siteId: site.getId(), id: audit.getId() },
      contextualContext,
      createOpportunityData,
      auditType,
      { kpiDeltas },
    );

    await syncBrokenInternalLinksSuggestions({
      opportunity,
      brokenInternalLinks: reportedLinks,
      context: contextualContext,
      opportunityId: opportunity.getId(),
      log,
      crawledUrlFromSet,
    });

    const handlerEnabled = await dataAccess.Configuration?.findLatest?.()
      ?.isHandlerEnabledForSite?.(site);
    if (handlerEnabled === false) {
      log.info('Auto-suggest disabled for site, skipping external suggestion generation');
      return { status: 'complete', reportedBrokenLinks: reportedLinks };
    }

    const { urls: mergedUrls } = await getMergedAuditInputUrls({
      site,
      dataAccess,
      auditType: 'broken-internal-links',
      getAgenticUrls: () => Promise.resolve([]),
      getTopPages: async () => {
        try {
          const { SiteTopPage } = dataAccess;
          return await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'seo', 'global');
        } catch (error) {
          log.warn(`Failed to fetch SEO top pages: ${error.message}`);
          return [];
        }
      },
      log,
    });
    const maxUrlsToProcess = config.getMaxUrlsToProcess();

    let topPages = mergedUrls.map((url) => ({ getUrl: () => url }));

    if (topPages.length > maxUrlsToProcess) {
      log.warn(`Capping URLs from ${topPages.length} to ${maxUrlsToProcess}`);
      topPages = topPages.slice(0, maxUrlsToProcess);
    }

    const baseURL = site.getBaseURL();
    const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);
    log.info(`After audit scope filtering: ${filteredTopPages.length} top pages available`);

    const suggestionStatusesToProcess = [suggestionStatuses.NEW];
    if (site?.requiresValidation && suggestionStatuses.PENDING_VALIDATION) {
      suggestionStatusesToProcess.push(suggestionStatuses.PENDING_VALIDATION);
    }

    const suggestions = (
      await Promise.all(
        suggestionStatusesToProcess.map((status) => Suggestion.allByOpportunityIdAndStatus(
          opportunity.getId(),
          status,
        )),
      )
    ).flat();

    const brokenLinks = suggestions
      .map((suggestion) => ({
        urlFrom: suggestion?.getData()?.urlFrom,
        urlTo: suggestion?.getData()?.urlTo,
        itemType: suggestion?.getData()?.itemType || 'link',
        suggestionId: suggestion?.getId(),
      }))
      .filter((link) => link.urlFrom && link.urlTo && link.suggestionId);

    const brokenLinksForConfiguredItemTypes = brokenLinks.filter(
      (link) => mystiqueItemTypes.has(link.itemType),
    );

    if (brokenLinksForConfiguredItemTypes.length < brokenLinks.length) {
      log.info(`Filtered out ${brokenLinks.length - brokenLinksForConfiguredItemTypes.length} suggestion items due to Mystique itemType filtering`);
    }

    if (brokenLinksForConfiguredItemTypes.length === 0) {
      log.warn('No valid broken links to process. Skipping.');
      return { status: 'complete', reportedBrokenLinks: reportedLinks };
    }

    const useBrightData = Boolean(env.BRIGHT_DATA_API_KEY && env.BRIGHT_DATA_ZONE);
    const validateBrightDataUrls = brightDataConfig.validateUrls;
    const brightDataMaxResults = brightDataConfig.maxResults;
    const brightDataRequestDelayMs = brightDataConfig.requestDelayMs;

    const resolvedByBrightData = new Set();
    if (useBrightData && brokenLinksForConfiguredItemTypes.length > 0) {
      log.info(`Bright Data enabled. Resolving ${brokenLinksForConfiguredItemTypes.length} broken links (maxResults=${brightDataMaxResults}).`);
      const brightDataClient = BrightDataClient.createFrom(context);

      const processBrokenLink = async (brokenLink) => {
        const searchUrl = buildLocaleSearchUrl(finalUrl || site.getBaseURL(), brokenLink.urlTo);

        const {
          results, keywords,
        } = await brightDataClient.googleSearchWithFallback(
          searchUrl,
          brokenLink.urlTo,
          brightDataMaxResults,
          {
            stripCommonPrefixes: false,
          },
        );

        if (!results || results.length === 0) {
          return;
        }

        let urlsSuggested = pickUrlsFromSerpResults(results, brokenLink.urlTo);
        if (urlsSuggested.length === 0) {
          return;
        }
        // Keep only suggestions within this audit's scope/subpath so a broken /uk/
        // link is not "fixed" with an out-of-subpath (e.g. /us/) URL (SITES-49911).
        urlsSuggested = urlsSuggested.filter((u) => isWithinAuditScope(u, site.getBaseURL()));
        if (urlsSuggested.length === 0) {
          return;
        }
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

        const updatedData = {
          ...suggestion.getData(),
          urlsSuggested,
          aiRationale: `Suggested URLs are chosen from top search results for closely matching keywords from the broken URL. Keywords used: "${keywords}".`,
        };
        warnOnInvalidSuggestionData(updatedData, opportunity.getType(), log);
        suggestion.setData(updatedData);

        await suggestion.save();
        resolvedByBrightData.add(brokenLink.suggestionId);
      };

      for (let i = 0; i < brokenLinksForConfiguredItemTypes.length; i += brightDataBatchSize) {
        const batch = brokenLinksForConfiguredItemTypes.slice(i, i + brightDataBatchSize);
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(batch.map((brokenLink) => processBrokenLink(brokenLink)
          .catch((error) => {
            log.warn(`Bright Data failed for ${brokenLink.urlTo}:`, error);
          })));
        if (i + brightDataBatchSize < brokenLinksForConfiguredItemTypes.length
          && Number.isFinite(brightDataRequestDelayMs)
          && brightDataRequestDelayMs > 0) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(brightDataRequestDelayMs);
        }
      }
    }

    const brokenLinksForMystique = brokenLinksForConfiguredItemTypes.filter(
      (link) => !resolvedByBrightData.has(link.suggestionId),
    );

    const allTopPageUrls = filteredTopPages.map((page) => page.getUrl());
    const brokenLinkLocales = new Set();
    brokenLinksForMystique.forEach((link) => {
      const locale = extractPathPrefix(link.urlTo);
      if (locale) {
        brokenLinkLocales.add(locale);
      }
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

    /* c8 ignore start - activated for exceptionally large alternative URL sets */
    if (alternativeUrls.length > maxAlternativeUrlsToSend) {
      log.warn(`Capping alternative URLs from ${alternativeUrls.length} to ${maxAlternativeUrlsToSend}`);
      alternativeUrls = alternativeUrls.slice(0, maxAlternativeUrlsToSend);
    }
    /* c8 ignore stop */

    if (brokenLinksForMystique.length === 0) {
      log.info('All broken links resolved via Bright Data. Skipping Mystique.');
      return { status: 'complete', reportedBrokenLinks: reportedLinks };
    }

    if (!opportunity?.getId()) {
      log.error('Opportunity ID is missing. Cannot send to Mystique.');
      return { status: 'complete', reportedBrokenLinks: reportedLinks };
    }

    if (alternativeUrls.length === 0) {
      log.warn('No alternative URLs available. Skipping message to Mystique.');
      return { status: 'complete', reportedBrokenLinks: reportedLinks };
    }

    const totalBatches = Math.ceil(brokenLinksForMystique.length / maxBrokenLinksPerBatch);
    log.info(`Sending ${brokenLinksForMystique.length} broken links in ${totalBatches} batch(es) to Mystique`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const batchStart = batchIndex * maxBrokenLinksPerBatch;
      const batchEnd = Math.min(batchStart + maxBrokenLinksPerBatch, brokenLinksForMystique.length);
      const batchLinks = brokenLinksForMystique.slice(batchStart, batchEnd);

      const alternativeUrlsForMessage = [...alternativeUrls];
      let message = {
        type: 'guidance:broken-links',
        siteId: site.getId(),
        auditId: audit.getId(),
        deliveryType: site.getDeliveryType(),
        time: new Date().toISOString(),
        data: {
          alternativeUrls: alternativeUrlsForMessage,
          opportunityId: opportunity.getId(),
          brokenLinks: batchLinks,
          siteBaseURL: `https://${finalUrl}`,
          batchInfo: {
            batchIndex,
            totalBatches,
            totalBrokenLinks: brokenLinksForMystique.length,
            batchSize: batchLinks.length,
          },
        },
      };

      /* c8 ignore start - defensive payload-size backoff path */
      let serializedMessage = JSON.stringify(message);
      while (Buffer.byteLength(serializedMessage, 'utf8') > 240000 && alternativeUrlsForMessage.length > 1) {
        alternativeUrlsForMessage.pop();
        message = {
          ...message,
          data: {
            ...message.data,
            alternativeUrls: alternativeUrlsForMessage,
          },
        };
        serializedMessage = JSON.stringify(message);
      }
      /* c8 ignore stop */

      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      log.debug(`Batch ${batchIndex + 1}/${totalBatches} sent to Mystique (${batchLinks.length} links)`);
    }

    log.info(`Successfully sent all ${totalBatches} batch(es) to Mystique`);
    return { status: 'complete', reportedBrokenLinks: reportedLinks };
  };
}
