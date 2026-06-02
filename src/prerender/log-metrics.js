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

const LOG_PREFIX = 'Prerender -';

/**
 * Emits the prerender_submit_scraping_metrics log line.
 * Called once per submitForScraping run, after filterUrls returns.
 *
 * @param {Object} context - Audit context (site, log)
 * @param {{ isCsv: boolean }} mode - Resolved execution mode
 * @param {{ csvUrls, topPagesUrls, agenticUrls, includedURLs }} rawUrls - Output of fetchUrls
 * @param {{ urls, filteredCount, metrics }} filterResult - Output of filterUrls
 */
export function logSubmitMetrics(context, mode, rawUrls, filterResult) {
  const { site, log } = context;
  const {
    csvUrls, topPagesUrls, agenticUrls, includedURLs,
  } = rawUrls;
  const { urls: finalUrls, filteredCount, metrics } = filterResult;

  log.info([
    `${LOG_PREFIX} prerender_submit_scraping_metrics:`,
    `submittedUrls=${finalUrls.length}`,
    `csvUrls=${csvUrls.length}`,
    `agenticUrls=${agenticUrls.length}`,
    `topPagesUrls=${topPagesUrls.length}`,
    `includedURLs=${includedURLs.length}`,
    `filteredOutUrls=${filteredCount}`,
    ...(!mode.isCsv ? [
      `currentAgentic=${metrics.currentAgentic}`,
      `currentOrganic=${metrics.currentOrganic}`,
      `currentIncludedUrls=${metrics.currentIncludedUrls}`,
      `isFirstRunOfCycle=${metrics.isFirstRunOfCycle}`,
      `agenticNewThisCycle=${metrics.agenticNewThisCycle}`,
      `edgeDeployedUrls=${metrics.edgeDeployedCount}`,
    ] : []),
    `baseUrl=${site.getBaseURL()}`,
    `siteId=${site.getId()}`,
  ].join(', '));
}

/**
 * Emits the scrape analysis log line.
 * @param {Object} context - Audit context (site, log)
 * @param {{ siteId, scrapeForbiddenCount, totalUrlsChecked, isPaid }} params
 */
function logScrapeAnalysis(context, {
  siteId, scrapeForbiddenCount, totalUrlsChecked, isPaid,
}) {
  const { site, log } = context;
  log.info(`${LOG_PREFIX} Scrape analysis for baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbiddenCount=${scrapeForbiddenCount}, totalUrlsChecked=${totalUrlsChecked}, isPaidLLMOCustomer=${isPaid}`);
}

/**
 * Emits the prerender findings log line.
 * @param {Object} log - Logger
 * @param {{ urlsNeedingPrerenderCount, successfulCount, totalCount, isPaid }} params
 */
function logPreRenderFindings(log, {
  urlsNeedingPrerenderCount, successfulCount, totalCount, isPaid,
}) {
  log.info(`${LOG_PREFIX} Found ${urlsNeedingPrerenderCount}/${successfulCount} URLs needing prerender from total ${totalCount} URLs scraped. isPaidLLMOCustomer=${isPaid}`);
}

/**
 * Emits the scraping metrics log line.
 * @param {Object} context - Audit context (site, log)
 * @param {{ siteId, urlsSubmittedForScraping, urlsScrapedSuccessfully,
 *   scrapeForbiddenCount, scrapingErrorRate }} params
 */
function logScrapeMetrics(context, {
  siteId, urlsSubmittedForScraping, urlsScrapedSuccessfully,
  scrapeForbiddenCount, scrapingErrorRate,
}) {
  const { site, log } = context;
  log.info(`${LOG_PREFIX} Scraping metrics for baseUrl=${site.getBaseURL()}, siteId=${siteId}. urlsSubmittedForScraping=${urlsSubmittedForScraping}, urlsScrapedSuccessfully=${urlsScrapedSuccessfully}, scrapeForbiddenCount=${scrapeForbiddenCount}, scrapingErrorRate=${scrapingErrorRate}%`);
}

/**
 * Emits all three step-3 log lines in a single call.
 *
 * @param {Object} context - Audit context (site, log)
 * @param {{
 *   scrapeStats: Object, comparisonResults: Array, auditResult: Object,
 *   urlsNeedingPrerender: Array, successfulComparisons: Array, isPaid: boolean
 * }} params
 */
export function logStep3Metrics(context, {
  scrapeStats, comparisonResults, auditResult, urlsNeedingPrerender, successfulComparisons, isPaid,
}) {
  const siteId = context.site.getId();
  logScrapeAnalysis(context, {
    siteId,
    scrapeForbiddenCount: scrapeStats.scrapeForbiddenCount,
    totalUrlsChecked: comparisonResults.length,
    isPaid,
  });
  logPreRenderFindings(context.log, {
    urlsNeedingPrerenderCount: urlsNeedingPrerender.length,
    successfulCount: successfulComparisons.length,
    totalCount: comparisonResults.length,
    isPaid,
  });
  logScrapeMetrics(context, {
    siteId,
    urlsSubmittedForScraping: scrapeStats.urlsSubmittedForScraping,
    urlsScrapedSuccessfully: successfulComparisons.length,
    scrapeForbiddenCount: scrapeStats.scrapeForbiddenCount,
    scrapingErrorRate: auditResult.scrapingErrorRate,
  });
}

/**
 * Emits the prerender_suggestions_sync_metrics log line.
 *
 * @param {Object} log - Logger
 * @param {{ siteId, baseUrl, isPaid, suggestionsCount, totalCount }} params
 */
export function logSuggestionsSyncMetrics(log, {
  siteId, baseUrl, isPaid, suggestionsCount, totalCount,
}) {
  log.info(`${LOG_PREFIX}
    prerender_suggestions_sync_metrics:
    siteId=${siteId},
    baseUrl=${baseUrl},
    isPaidLLMOCustomer=${isPaid},
    suggestions=${suggestionsCount},
    totalSuggestions=${totalCount},`);
}

/**
 * Emits the prerender_status_upload log line.
 *
 * @param {Object} log - Logger
 * @param {{ statusKey, statusSummary }} params
 */
export function logStatusUpload(log, { statusKey, statusSummary }) {
  // eslint-disable-next-line no-unused-vars
  const { pages: _, ...logSummary } = statusSummary;
  const logFields = Object.entries(logSummary).map(([k, v]) => `${k}=${v}`).join(', ');
  log.info(`${LOG_PREFIX} prerender_status_upload: statusKey=${statusKey}, pagesCount=${statusSummary.pages.length}, ${logFields}`);
}
