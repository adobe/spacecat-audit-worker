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

import {
  isArray,
} from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import {
  applyPageUrlProbeSampling,
  ERROR_CODES,
  filterValidUrls,
  getSitemapUrls,
  PAGE_URL_OTHER_STATUS_SLOWDOWN_MIN_URLS,
  PAGE_URL_OTHER_STATUS_SLOWDOWN_RATIO,
  PAGE_URL_TIMEOUT_MS,
  SLOW_PAGE_URL_BATCH_DELAY_MS,
  SLOW_PAGE_URL_BATCH_SIZE,
  slicePageUrlsForSlowProbeSampling,
} from './common.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/base-audit.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const auditType = Audit.AUDIT_TYPES.SITEMAP;

const TRACKED_STATUS_CODES = Object.freeze([301, 302, 404]);

const SLOW_PAGE_URL_BATCH_OPTIONS = Object.freeze({
  pageUrlBatchSize: SLOW_PAGE_URL_BATCH_SIZE,
  pageUrlBatchDelayMs: SLOW_PAGE_URL_BATCH_DELAY_MS,
});

/**
 * Only return the statistics if they justify slowing down our current rate of probing.
 * Otherwise, return null.
 *
 * @param {number} urlsCount
 * @param {{ ok: unknown[], notOk: unknown[],
 *           networkErrors: unknown[], otherStatusCodes: unknown[] }} pages
 * @returns {{ ratio: number, otherCount: number, total: number } | null}
 */
function getOtherStatusSlowdownStats(urlsCount, pages) {
  // to avoid overreacting, we need to have a minimum number of probed URLs
  if (urlsCount < PAGE_URL_OTHER_STATUS_SLOWDOWN_MIN_URLS) {
    return null;
  }
  // compute the ratio of 'otherStatusCodes' vs the total
  const {
    ok, notOk, networkErrors, otherStatusCodes,
  } = pages;
  const total = ok.length + notOk.length + networkErrors.length + otherStatusCodes.length;
  if (total === 0) {
    return null;
  }
  const ratio = otherStatusCodes.length / total;
  if (ratio < PAGE_URL_OTHER_STATUS_SLOWDOWN_RATIO) {
    return null; // not enough of number of 'otherStatusCodes' to justify going slow
  }
  return { ratio, otherCount: otherStatusCodes.length, total };
}

/**
 * Main sitemap discovery and validation function
 */
export async function findSitemap(inputUrl, log) {
  // Extract and validate pages from sitemaps
  const siteMapUrlsResult = await getSitemapUrls(inputUrl, log);
  if (!siteMapUrlsResult.success) {
    /* c8 ignore start */
    const reasons = siteMapUrlsResult.reasons || [];
    log?.error(`Sitemap: getSitemapUrls failed for ${inputUrl}: ${reasons.length} reason(s)`);
    reasons.forEach((r, i) => {
      log?.error(`  reason ${i + 1}: error=${r.error ?? '(none)'}, value=${r.value ?? '(none)'}`);
    });
    /* c8 ignore end */
    return siteMapUrlsResult;
  }
  // The real purpose of this audit is to find any 'notOk' page URLs referenced in sitemap.xml files
  const notOkPagesFromSitemap = {};
  // Of all the page URLs found, proportionally probe them (since we have time constraints)
  const extractedPathsRaw = siteMapUrlsResult.details?.extractedPaths || {};
  const extractedPaths = applyPageUrlProbeSampling(extractedPathsRaw, log); // "fast"
  const filteredSitemapUrls = siteMapUrlsResult.details?.filteredSitemapUrls || [];
  // Only needed when necessary, prepare for "slow probing"
  let useSlowPageUrlProbing = false;
  let slowProbeUrlsTotal = 0; // of all the page URLs probed slowly ...
  let slowProbeOtherStatusTotal = 0; // ... how many of them still rejected our probing

  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    for (const sitemapUrl of Object.keys(extractedPaths)) {
      const urlsFromSampling = extractedPaths[sitemapUrl]; // "fast mode" proportioned

      /* c8 ignore next */
      log?.info(`Number of URLs extracted from sitemap ${sitemapUrl}: ${urlsFromSampling?.length ?? 0}`);

      if (urlsFromSampling?.length) {
        let urlsToProbe = urlsFromSampling;
        if (useSlowPageUrlProbing) { // reduce the larger "fast" set to the smaller "slow" set
          urlsToProbe = slicePageUrlsForSlowProbeSampling(urlsFromSampling);
        }

        // eslint-disable-next-line no-await-in-loop
        let existingPages = await filterValidUrls(
          urlsToProbe,
          log,
          PAGE_URL_TIMEOUT_MS,
          useSlowPageUrlProbing ? SLOW_PAGE_URL_BATCH_OPTIONS : null,
        );

        if (!useSlowPageUrlProbing) {
          const slowdownStats = getOtherStatusSlowdownStats(urlsToProbe.length, existingPages);
          if (slowdownStats) {
            // from now on, switch to using the slower probing
            useSlowPageUrlProbing = true;
            // inform about this decision to slow down and echo the stats that triggered it
            const pct = (slowdownStats.ratio * 100).toFixed(0);
            log?.info(`* Sitemap: slowing down page URL probing starting with sitemap ${sitemapUrl} due to high count of 'otherStatus' codes: ${slowdownStats.otherCount} out of ${slowdownStats.total} (${pct}%)`);
            urlsToProbe = slicePageUrlsForSlowProbeSampling(urlsFromSampling); // re-do current set
            const slowCapRetainPct = urlsFromSampling.length > 0
              ? ((100 * urlsToProbe.length) / urlsFromSampling.length).toFixed(0)
              : '0';
            log?.info(`* Sitemap: since we are going slower, the slow probe uses ~${slowCapRetainPct}% of our original "fast" sampled page URLs (${urlsToProbe.length} of ${urlsFromSampling.length})`);
            // eslint-disable-next-line no-await-in-loop
            existingPages = await filterValidUrls(
              urlsToProbe, // now using the "slow probe" set
              log,
              PAGE_URL_TIMEOUT_MS,
              SLOW_PAGE_URL_BATCH_OPTIONS,
            );
          }
        }

        // We hope slowing down made a difference. If not, log a warning for further investigation.
        if (useSlowPageUrlProbing) {
          const statsAfter = getOtherStatusSlowdownStats(urlsToProbe.length, existingPages);
          if (statsAfter) {
            const pct = (statsAfter.ratio * 100).toFixed(0);
            log?.warn(`. Sitemap: count of 'otherStatus' codes remains high, although we are already using our slow page URL batching — sitemapUrl=${sitemapUrl} 'otherStatus' count=${statsAfter.otherCount} total count=${statsAfter.total} (${pct}%)`);
          }
        }

        // Echo general statistics. Show details of what the 'otherStatusCodes' are.
        /* c8 ignore start */
        log?.info(`.. Sitemap: stats for ${sitemapUrl} - OK: ${existingPages.ok.length}, Not OK: ${existingPages.notOk.length}, Network Errors: ${existingPages.networkErrors.length}, Other Errors: ${existingPages.otherStatusCodes.length}`);
        if (existingPages.otherStatusCodes.length > 0) {
          const statusCodeCounts = existingPages.otherStatusCodes.reduce((acc, item) => {
            acc[item.statusCode] = (acc[item.statusCode] || 0) + 1;
            return acc;
          }, {});
          log?.info(`.... Other status codes breakdown ('code': count) for ${sitemapUrl}: ${JSON.stringify(statusCodeCounts)}`);
        }
        /* c8 ignore end */

        // Collect issues only for the audit's tracked status codes (ex: 301, 302, 404)
        if (existingPages.notOk?.length > 0) {
          const trackedIssues = existingPages.notOk
            .filter((issue) => TRACKED_STATUS_CODES.includes(issue.statusCode));
          if (trackedIssues.length > 0) {
            notOkPagesFromSitemap[sitemapUrl] = trackedIssues;
          }
          /* c8 ignore next */
          log?.debug(`Number of URLs with tracked status (ex: 301, 302, 404) from sitemap ${sitemapUrl}: ${trackedIssues.length}`);
        }

        // If applicable, keep track of how effective "slow probing" actually is
        if (useSlowPageUrlProbing) {
          // note that the 'slowProbeUrlsTotal' count will typically be less than all the
          // page URLs probed depending on when we switched to slow probing.
          const probedTotal = existingPages.ok.length + existingPages.notOk.length
            + existingPages.networkErrors.length + existingPages.otherStatusCodes.length;
          slowProbeUrlsTotal += probedTotal;
          slowProbeOtherStatusTotal += existingPages.otherStatusCodes.length;
        }

        // Keep sitemap if it has valid URLs or acceptable redirects
        const hasValidUrls = existingPages.ok.length > 0
          || existingPages.notOk.some((issue) => [301, 302].includes(issue.statusCode));
        if (!hasValidUrls) {
          delete extractedPaths[sitemapUrl];
        } else {
          extractedPaths[sitemapUrl] = existingPages.ok;
        }
      }
    }

    if (slowProbeUrlsTotal > 0) {
      const pct = ((slowProbeOtherStatusTotal / slowProbeUrlsTotal) * 100).toFixed(0);
      log?.info(
        `Sitemap: slow page URL probing summary — otherStatus codes: ${slowProbeOtherStatusTotal} of ${slowProbeUrlsTotal} page URLs probed slowly (${pct}%)`,
      );
    }
  }

  // Return final result:
  //   success if we have any sitemaps with valid URLs,
  //   failure otherwise (with details on issues found)
  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    return {
      success: true,
      reasons: [{ value: 'Sitemaps found and checked.' }],
      url: inputUrl,
      details: { issues: notOkPagesFromSitemap },
    };
  }
  return {
    success: false,
    reasons: [{
      value: filteredSitemapUrls[0],
      error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
    }],
    url: inputUrl,
    details: { issues: notOkPagesFromSitemap },
  };
}

/**
 * Main audit runner function
 */
export async function sitemapAuditRunner(baseURL, context) {
  const { log } = context;
  const startTime = process.hrtime();

  log.info(`Starting sitemap audit for ${baseURL}`);

  const auditResult = await findSitemap(baseURL, log);

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`Sitemap audit for ${baseURL} completed in ${formattedElapsed} seconds`);

  return {
    fullAuditRef: baseURL,
    auditResult,
    url: baseURL,
  };
}

export function getSitemapsWithIssues(auditData) {
  return Object.keys(auditData?.auditResult?.details?.issues ?? {});
}

/**
 * Extracts pages with issues for suggestion generation
 */
export function getPagesWithIssues(auditData) {
  const sitemapsWithPagesWithIssues = getSitemapsWithIssues(auditData);

  return sitemapsWithPagesWithIssues.flatMap((sitemapUrl) => {
    const issues = auditData.auditResult.details.issues[sitemapUrl];

    if (!isArray(issues)) {
      return [];
    }

    return issues.map((page) => ({
      type: 'url',
      sitemapUrl,
      pageUrl: page.url,
      statusCode: page.statusCode ?? 0,
      ...(page.urlsSuggested && { urlsSuggested: page.urlsSuggested }),
    }));
  });
}

/**
 * Generates suggestions based on audit results
 */
export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  const { success, reasons } = auditData.auditResult;

  const response = success
    ? []
    : reasons.map(({ error }) => ({ type: 'error', error }));

  const pagesWithIssues = getPagesWithIssues(auditData);
  /* c8 ignore next */
  log.info(`Sitemap: Found ${pagesWithIssues.length} pages with issues in sitemaps for ${auditUrl}`);
  const suggestions = [...response, ...pagesWithIssues]
    .filter(Boolean)
    .map((issue) => ({
      ...issue,
      recommendedAction: issue.urlsSuggested
        ? `use this url instead: ${issue.urlsSuggested}`
        : 'Make sure your sitemaps only include URLs that return the 200 (OK) response code.',
    }));

  /* c8 ignore next */
  log.info(`Sitemap audit generated ${suggestions.length} suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

/**
 * Merges existing and new Sitemap suggestion data. URL-type ('notOk' page) rows drop a legacy
 * `error` field unless it is a non-empty string, so Joi validation matches freshly generated
 * payloads and previously stored `error: null` do not persist. Otherwise, error-type rows use
 * the default shallow merge so string ERROR_CODES from the audit are preserved.
 *
 * @param {Object} existingData - Previously stored suggestion data
 * @param {Object} newData - Data from the current audit run
 * @returns {Object} Merged suggestion data
 */
export function mergeSitemapSuggestionData(existingData, newData) {
  const merged = { ...existingData, ...newData };
  if (merged.type === 'url') {
    const { error, ...rest } = merged;
    if (typeof error === 'string' && error.length > 0) {
      return { ...rest, error }; // include the 'error' field
    }
    return rest; // without the {empty, null} 'error' field
  }
  return merged; // when type !== 'url'
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  if (auditData.auditResult.success === false) {
    log.error('Sitemap audit failed, skipping opportunity and suggestions creation');
    /* c8 ignore start */
    const wouldCreate = auditData.suggestions ?? [];
    log.info(`.. Sitemap audit: ${wouldCreate.length} suggestion(s) would have been created for ${auditUrl}`);
    wouldCreate.forEach((s, i) => {
      log.info(`.... Sitemap audit suggestion ${i + 1}/${wouldCreate.length}: type=${s.type ?? 'unknown'}, ${s.type === 'error' ? `error=${s.error}` : `sitemapUrl=${s.sitemapUrl}, pageUrl=${s.pageUrl}, statusCode=${s.statusCode}`}`);
    });
    /* c8 ignore end */
    return { ...auditData };
  }

  if (!auditData.suggestions?.length) {
    log.info('No sitemap issues found, skipping opportunity creation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const buildKey = (data) => (data.type === 'url' ? `${data.sitemapUrl}|${data.pageUrl}` : data.error);

  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions,
    context,
    buildKey,
    mergeDataFunction: mergeSitemapSuggestionData,
    mapNewSuggestion: (issue) => ({
      opportunityId: opportunity.getId(),
      type: 'REDIRECT_UPDATE',
      rank: 0,
      data: issue,
    }),
    log,
  });

  return { ...auditData };
}

export default new AuditBuilder()
  .withRunner(sitemapAuditRunner)
  .withUrlResolver(noopUrlResolver) // Preserves full URL including subpath
  .withPostProcessors([generateSuggestions, opportunityAndSuggestions])
  .build();
