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

import { createInternalLinksConfigResolver } from './config.js';
import { createInternalLinksStepLogger } from './logging.js';

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
  isUnscrapeable,
  filterBrokenSuggestedUrls,
  BrightDataClient,
  buildLocaleSearchUrl,
  extractLocaleFromUrl,
  localesMatch,
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
    const { Suggestion, SiteTopPage } = dataAccess;
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
        log.info('no broken internal links found, updating opportunity to RESOLVED');
        await opportunity.setStatus(opptyStatuses.RESOLVED);
        const suggestions = await opportunity.getSuggestions();
        if (isNonEmptyArray(suggestions)) {
          await Suggestion.bulkUpdateStatus(suggestions, suggestionStatuses.OUTDATED);
        }
        opportunity.setUpdatedBy('system');
        await opportunity.save();
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
    });

    const handlerEnabled = await dataAccess.Configuration?.findLatest?.()
      ?.isHandlerEnabledForSite?.(site);
    if (handlerEnabled === false) {
      log.info('Auto-suggest disabled for site, skipping external suggestion generation');
      return { status: 'complete', reportedBrokenLinks: reportedLinks };
    }

    let ahrefsTopPages = [];
    try {
      ahrefsTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
      log.info(`Found ${ahrefsTopPages.length} top pages from Ahrefs`);
    } catch (error) {
      log.warn(`Failed to fetch Ahrefs top pages: ${error.message}`);
    }

    const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
    log.info(`Found ${includedURLs.length} includedURLs from siteConfig`);
    const maxUrlsToProcess = config.getMaxUrlsToProcess();

    const includedTopPages = includedURLs.map((url) => ({ getUrl: () => url }));
    let topPages = [...ahrefsTopPages, ...includedTopPages];

    if (topPages.length > maxUrlsToProcess) {
      log.warn(`Capping URLs from ${topPages.length} to ${maxUrlsToProcess}`);
      topPages = topPages.slice(0, maxUrlsToProcess);
    }

    const baseURL = site.getBaseURL();
    const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);
    log.info(`After audit scope filtering: ${filteredTopPages.length} top pages available`);

    const suggestions = await Suggestion.allByOpportunityIdAndStatus(
      opportunity.getId(),
      suggestionStatuses.NEW,
    );

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

        const brokenLinkLocale = extractLocaleFromUrl(brokenLink.urlTo);
        const best = results.find((r) => {
          if (!r?.link) return false;
          const suggestedLocale = extractLocaleFromUrl(r.link);
          return localesMatch(brokenLinkLocale, suggestedLocale);
        }) || results[0];

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

    const originalCount = alternativeUrls.length;
    alternativeUrls = alternativeUrls.filter((url) => !isUnscrapeable(url));
    if (alternativeUrls.length < originalCount) {
      log.info(`Filtered out ${originalCount - alternativeUrls.length} unscrape-able file URLs`);
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
