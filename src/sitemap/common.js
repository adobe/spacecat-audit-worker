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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import {
  isAuthUrl,
  toggleWWW,
  getBaseUrlPagesFromSitemapContents,
  getSitemapUrlsFromSitemapIndex,
  extractDomainAndProtocol,
  getUrlWithoutPath,
} from '../support/utils.js';

// ----- performance tuning constants ------------------------------------------

// GET timeout for robots.txt and each sitemap.xml file
export const SITEMAP_GET_TIMEOUT_MS = 15000; // 15 seconds
// Batching when fetching sitemap.xml files
export const SITEMAP_XML_BATCH_SIZE = 10; // number to fetch in parallel
export const SITEMAP_XML_BATCH_DELAY_MS = 500; // half of a second delay between batches

// Timeout for HEAD (and GET fallback) when validating page URLs
export const PAGE_URL_TIMEOUT_MS = 10000; // 10 seconds

// "Fast" batching when fetching/validating page URLs
export const FAST_MAX_PAGE_URLS_PROBED = 10000; // max total, proportioned across sitemaps
export const FAST_PAGE_URL_BATCH_SIZE = 700; // must stay under 1000
export const FAST_PAGE_URL_BATCH_DELAY_MS = 0; // none

// Dynamic switch from fast → slow page-URL batching when 'otherStatus' dominates
export const PAGE_URL_OTHER_STATUS_SLOWDOWN_MIN_URLS = 10; // min probes before evaluating the ratio
export const PAGE_URL_OTHER_STATUS_SLOWDOWN_RATIO = 0.6; // once we hit 60%+ we switch

// "Slow" batching when fetching/validating page URLs
//   ex: approx 10 probes per second, and assuming 0.5 seconds per probe to complete,
//       then 1000 probes will take about 8.3 minutes (which is 8 min and 20 sec)
export const SLOW_MAX_PAGE_URLS_PROBED = 1000; // smaller set to use when running slow
export const SLOW_PAGE_URL_BATCH_SIZE = 1; // must stay under 1000
export const SLOW_PAGE_URL_BATCH_DELAY_MS = 100; // 0.1 of a second delay between batches

// ----- internal constants ----------------------------------------------------
export const ERROR_CODES = Object.freeze({
  INVALID_URL: 'INVALID URL',
  NO_SITEMAP_IN_ROBOTS: 'NO SITEMAP FOUND IN ROBOTS',
  NO_VALID_PATHS_EXTRACTED: 'NO VALID URLs FOUND IN SITEMAP',
  SITEMAP_NOT_FOUND: 'NO SITEMAP FOUND',
  SITEMAP_EMPTY: 'EMPTY SITEMAP',
  SITEMAP_FORMAT: 'INVALID SITEMAP FORMAT',
  FETCH_ERROR: 'ERROR FETCHING DATA',
  MISSING_PRODUCT_URL_TEMPLATE: 'MISSING PRODUCT URL TEMPLATE IN THE SITE CONFIGURATION',
  COLLECTING_PRODUCTS_BACKEND_FAILED: 'COLLECTING PRODUCTS FROM BACKEND FAILED',
  UNSUPPORTED_DELIVERY_TYPE: 'UNSUPPORTED DELIVERY TYPE',
});

const VALID_MIME_TYPES = Object.freeze([
  'application/xml',
  'text/xml',
  'text/html',
  'text/plain',
]);

/** HEAD responses that we will retry with a GET request. */
const HEAD_FALLBACK_STATUSES = Object.freeze([403, 404, 405, 501]);

/**
 * Returns whether the URL path looks like a "not found" or error page (soft 404 style).
 * @param {string} urlString
 * @returns {boolean}
 */
export function urlLooksLike404Page(urlString) {
  try {
    const { pathname } = new URL(urlString);
    return pathname.includes('/404/')
      || pathname.includes('404.html')
      || pathname.includes('/errors/404/');
  } catch {
    return false; // assume the URL is not a 404 page
  }
}

/**
 * Utility function to add delay between batch processing
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * After {@link applyPageUrlProbeSampling}, further cap how many page URLs we probe per sitemap
 * while in slow mode: floor(length * SLOW_MAX / FAST_MAX), at least 1 when non-empty.
 *
 * @param {string[]} urls
 * @returns {string[]}
 */
export function slicePageUrlsForSlowProbeSampling(urls) {
  if (!urls?.length) {
    return []; // if nothing was passed in, then we return an empty array
  }
  const ratio = SLOW_MAX_PAGE_URLS_PROBED / FAST_MAX_PAGE_URLS_PROBED; // ex: 0.1 == 10%
  const n = Math.min(urls.length, Math.max(1, Math.floor(urls.length * ratio)));
  return urls.slice(0, n); // minimally will have 1 element in the array
}

/**
 * Helper function to initially try a HEAD request.
 * If HEAD returns a status code that is in our "fallback" list, then retry with GET.
 * Uses `options.timeout` to bound these requests.
 */
export async function fetchWithHeadFallback(url, options = {}) {
  // Ensure we only wait a limited amount of time for the response to our request.
  const timeout = options.timeout ?? PAGE_URL_TIMEOUT_MS;
  const fetchOptions = { ...options, timeout };

  // note: this could throw an exception for network errors
  const headResponse = await fetch(url, {
    ...fetchOptions,
    method: 'HEAD',
  });

  // If HEAD fails with a known "fallback" status code, retry with GET
  if (HEAD_FALLBACK_STATUSES.includes(headResponse.status)) {
    try {
      // return whatever we receive from GET
      return await fetch(url, {
        ...fetchOptions,
        method: 'GET',
      });
    } catch {
      return headResponse; // will have a status code in the list of HEAD_FALLBACK_STATUSES
    }
  }

  return headResponse;
}

/**
 * Fetches content with timeout control.
 * Used for robots.txt and sitemap.xml GET requests.
 */
export async function fetchContent(targetUrl) {
  // note: this could throw an exception for network errors
  const response = await fetch(targetUrl, {
    method: 'GET',
    timeout: SITEMAP_GET_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Fetch error for ${targetUrl} Status: ${response.status}`);
  }

  return {
    payload: await response.text(),
    type: response.headers.get('content-type'),
  };
}

/**
 * Returns the results of validating all the URLs. Every URL is validated.
 * The returned structure filters each of these URLs into exactly one "bucket."
 *
 * Validation means performing a HEAD request on the URL and reacting on the returned
 * HTTP status code. (If the web server rejects HEAD requests, we try with a GET.)
 * * 200 -- valid URL; add to the `ok` bucket ... this is the preferred response
 * * 301, 302 -- redirected; add to `notOk` bucket with a suggestion to replace the URL:
 * * * we prefer to use the terminal "final" URL
 * * * otherwise, we will use the "first hop" URL
 * * * however, there are cases -- such as redirecting to a soft "404" page -- where we have
 *      no suggested URL
 * * 404 -- not found; add to `notOk` bucket with no explicit `urlsSuggested` value
 * * network errors -- add to `networkErrors` bucket
 * * (all other codes) -- such as 400, 401, 405, 500: add to `otherStatusCodes` bucket
 *
 * @param {string[]} urls - URLs to validate (page URLs or sitemap URLs)
 * @param {Object} [log] - Logger
 * @param {number} [timeoutMs=PAGE_URL_TIMEOUT_MS] -
 *         Timeout for HEAD/GET (use SITEMAP_GET_TIMEOUT_MS for sitemap URL validation)
 * @param {null} [pageUrlBatchOptions] - Optional page-URL probe batching parameters
 * @param {number} [pageUrlBatchOptions.pageUrlBatchSize] - defaults to use "fast" value
 * @param {number} [pageUrlBatchOptions.pageUrlBatchDelayMs] - defaults to use "fast" value
 *
 * @returns {Promise<{
 *   ok: string[], // Array of URLs
 *   notOk: Array<{ url: string, statusCode?: number, urlsSuggested?: string }>,
 *   networkErrors: Array<{ url: string, error: string }>,
 *   otherStatusCodes: Array<{ url: string, statusCode: number }>
 *  }>}
 */
export async function filterValidUrls(
  urls,
  log,
  timeoutMs = PAGE_URL_TIMEOUT_MS,
  pageUrlBatchOptions = null,
) {
  // prep for our returned structure
  const results = {
    ok: [], notOk: [], networkErrors: [], otherStatusCodes: [],
  };

  // sanity
  if (!urls.length) {
    return results; // empty
  }

  // callback to validate a specific URL
  const checkUrl = async (url) => {
    try {
      const response = await fetchWithHeadFallback(url, {
        redirect: 'manual', // so we can watch if we go to an auth or a login page
        timeout: timeoutMs,
      });

      // Handle successful responses
      if (response.status === 200) {
        // beware if we really have a soft 404
        if (urlLooksLike404Page(url)) {
          log?.debug(`Sitemap: URL seems to actually be a 'soft' 404 page: ${url}`);
          return { type: 'notOk', url, statusCode: 404 };
        }
        // everything is A-OK
        log?.debug(`Sitemap: Valid URL found: ${url}`);
        return { type: 'ok', url };
      }

      /* c8 ignore next */
      log?.debug(`Sitemap: URL check for ${url} returned status: ${response.status}`);

      // Handle redirects
      if (response.status === 301 || response.status === 302) {
        const redirectUrl = response.headers.get('location');
        const firstHopUrl = redirectUrl ? new URL(redirectUrl, url).href : null;

        // if redirect leads to an auth or a login page, then treat as valid
        if (firstHopUrl && isAuthUrl(firstHopUrl)) {
          return { type: 'ok', url };
        }

        if (!firstHopUrl) {
          // this is actually something that is wrong with the website itself
          log?.error(
            `Sitemap: redirect (${response.status}) for ${url} has no 'Location' header; `
            + 'cannot suggest a replacement URL.',
          );
          return {
            type: 'notOk',
            url,
            statusCode: response.status,
          };
        }

        let terminalValid = false;
        let terminalUrl = firstHopUrl; // "final" URL after follow, when available
        let redirectResponse = null;
        try {
          redirectResponse = await fetchWithHeadFallback(firstHopUrl, {
            redirect: 'follow',
            timeout: timeoutMs,
          });

          const resolvedUrl = redirectResponse.url?.trim();
          if (resolvedUrl) {
            terminalUrl = resolvedUrl;
          }

          const statusOk = redirectResponse.status === 200;
          const looks404 = redirectResponse.status === 404
            || urlLooksLike404Page(terminalUrl);
          terminalValid = statusOk && !looks404;
        } catch {
          terminalValid = false;
          redirectResponse = null;
        }

        if (terminalValid) {
          return {
            type: 'notOk',
            url,
            statusCode: response.status,
            urlsSuggested: terminalUrl, // "final" URL
          };
        }

        // Terminal could not be confirmed (e.g. WAF 403). Still suggest first Location when it
        // differs from the probed URL and the failure is not a clear HTTP/path 404.
        const terminalClearlyBad = redirectResponse
          && (redirectResponse.status === 404 || urlLooksLike404Page(terminalUrl));
        // firstHopUrl is always `new URL(Location, url).href` (already parsed above).
        const probedHref = new URL(url).href;
        const firstHopHref = new URL(firstHopUrl).href;
        const firstHopDiffersFromProbed = firstHopHref !== probedHref;

        if (firstHopDiffersFromProbed && !terminalClearlyBad) {
          log?.debug(
            `Sitemap: recommending first-hop redirect target instead of validated terminal URL for ${url}; `
            + `first hop: ${firstHopUrl}, terminal candidate: ${terminalUrl}, `
            + `terminal response status: ${redirectResponse?.status ?? 'error'}.`,
          );
          return {
            type: 'notOk',
            url,
            statusCode: response.status,
            urlsSuggested: firstHopUrl, // suggest a reasonable URL
          };
        }

        // Unfortunately we have no URL suggestion for this redirected URL
        log?.error(
          `Sitemap: redirect (${response.status}) for ${url} does not resolve to a valid terminal page URL; `
          + `first hop: ${firstHopUrl}, terminal URL: ${terminalUrl}. No urlsSuggested.`,
        );
        return {
          type: 'notOk',
          url,
          statusCode: response.status, // redirected
          urlsSuggested: '', // no reasonable suggestion available
        };
      }

      // Handle 404s
      if (response.status === 404) {
        return { type: 'notOk', url, statusCode: response.status };
      }

      // All remaining status codes
      return { type: 'otherStatus', url, statusCode: response.status };
    } catch (err) {
      // exception during the fetch (network error, timeout, etc.) is considered a network error
      /* c8 ignore next 3 */
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      log?.debug(`Sitemap: network error while probing URL ${url}: ${detail}`);
      return { type: 'networkError', url, error: 'NETWORK_ERROR' };
    }
  };

  // eslint-disable-next-line max-len
  const pageUrlBatchDelayMs = pageUrlBatchOptions?.pageUrlBatchDelayMs ?? FAST_PAGE_URL_BATCH_DELAY_MS;
  const pageUrlBatchSize = pageUrlBatchOptions?.pageUrlBatchSize ?? FAST_PAGE_URL_BATCH_SIZE;

  // Process URLs in batches with rate limiting (page URL batch size and delay)
  for (let i = 0; i < urls.length; i += pageUrlBatchSize) {
    const batch = urls.slice(i, i + pageUrlBatchSize);
    const batchPromises = batch.map(checkUrl);

    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value) {
        const {
          type, url, statusCode, urlsSuggested, error,
        } = result.value;

        // eslint-disable-next-line default-case
        switch (type) {
          case 'ok':
            results.ok.push(url);
            break;
          case 'notOk':
            results.notOk.push({ url, statusCode, ...(urlsSuggested && { urlsSuggested }) });
            break;
          case 'networkError':
            results.networkErrors.push({ url, error });
            break;
          case 'otherStatus':
            results.otherStatusCodes.push({ url, statusCode });
            break;
        }
      }
    }

    // Add delay between batches to avoid overwhelming servers
    if (i + pageUrlBatchSize < urls.length) {
      // eslint-disable-next-line no-await-in-loop
      await delay(pageUrlBatchDelayMs);
    }
  }

  return results;
}

/**
 * Limits which discovered page URLs are probed: at most {@link FAST_MAX_PAGE_URLS_PROBED} URLs,
 * split across sitemaps in proportion to each sitemap's entry count.
 *
 * Rules (in order):
 * 1. Non-empty sitemaps only. Keep existing order from `Object.keys(extractedPaths)`.
 * 2. If there are more than FAST_MAX_PAGE_URLS_PROBED sitemap.xml files with URLs, keep only the
 *    first FAST_MAX_PAGE_URLS_PROBED of them.  Note that, in practice, as long as
 *    FAST_MAX_PAGE_URLS_PROBED is fairly large, we should never reach this condition.
 * 3. If total URLs is <= FAST_MAX_PAGE_URLS_PROBED, probe every URL.
 * 4. Otherwise, each sitemap.xml file gets floor(MAX * count / total) URLs, with a minimum of
 *    1 URL probed per sitemap.xml file.  If the new grand total of probed page URLs exceeds
 *    FAST_MAX_PAGE_URLS_PROBED, then we just log this as a warning -- since we assume it is a
 *    very rare condition -- but we still attempt to probe this new total amount nonetheless.
 *
 * @param {Record<string, string[]>} extractedPaths - Output of discovery (sitemap URL -> page URLs)
 * @param {Object} [log] - Optional logger
 * @returns {Record<string, string[]>} Subset map; each value is a prefix slice (top of array)
 */
export function applyPageUrlProbeSampling(extractedPaths, log) {
  // Get the initial set of sitemap.xml files we will be working with.
  const keys = Object.keys(extractedPaths);
  const entries = keys
    .map((key) => [key, extractedPaths[key] ?? []])
    .filter(([, urls]) => urls.length > 0); // keep non-empty sitemap.xml files
  if (entries.length === 0) {
    return {};
  }
  // Remember the grand total of all the page URLs we would like to probe.
  const originalTotal = entries.reduce((sum, [, urls]) => sum + urls.length, 0);
  // In the extreme condition that there are a zillion sitemap.xml files, reduce these.
  let working = entries;
  if (working.length > FAST_MAX_PAGE_URLS_PROBED) {
    log?.info(
      `Sitemap: ${working.length} sitemap(s) with page URLs exceed cap ${FAST_MAX_PAGE_URLS_PROBED}; `
      + `only the first ${FAST_MAX_PAGE_URLS_PROBED} sitemap(s) will be probed.`,
    );
    working = working.slice(0, FAST_MAX_PAGE_URLS_PROBED);
  }
  // Re-compute the grand total of all the page URLs we would like to probe.
  const totalAfterSitemapCap = working.reduce((sum, [, urls]) => sum + urls.length, 0);
  if (totalAfterSitemapCap <= FAST_MAX_PAGE_URLS_PROBED) {
    const out = Object.fromEntries(working);
    if (log && originalTotal > totalAfterSitemapCap) {
      log.info( // this is extremely unlikely ...
        'Sitemap: Due to the abundance of sitemap.xml files, we had to reduce the number of these files inspected.'
        + ` This resulted in reducing the discovered page URLs from ${originalTotal} to `
        + `${totalAfterSitemapCap}. Consider reducing the number of sitemap.xml files.`,
      );
    }
    return out; // since the number of page URLs is already at/under the cap, we return them all
  }

  // Goal: determine how many page URLs should be probed from each sitemap.xml file.
  // * 'counts' array of the number of page URLs referenced per sitemap.xml file
  // * 'quotas' array of the number of page URLs we will probe from each sitemap.xml file.  Min: 1
  const counts = working.map(([, urls]) => urls.length);
  const quotas = counts.map((c) => {
    const floored = Math.floor((FAST_MAX_PAGE_URLS_PROBED * c) / totalAfterSitemapCap);
    return Math.min(c, Math.max(floored, 1)); // at least 1 URL per sitemap.xml file
  });
  const sumQ = quotas.reduce((a, b) => a + b, 0); // actual total URLs to be probed
  if (sumQ > FAST_MAX_PAGE_URLS_PROBED) {
    log?.warn(
      `Sitemap: Proportional quotas will actually probe ${sumQ} page URL(s), above the `
      + `FAST_MAX_PAGE_URLS_PROBED (${FAST_MAX_PAGE_URLS_PROBED}) desired limit.`,
    );
  }

  // Build the actual set of page URLs to be probed from each of the sitemap.xml files
  const out = {};
  working.forEach(([key, urls], i) => {
    out[key] = urls.slice(0, quotas[i]); // quotas[i] is always >= 1
  });
  log?.info(
    `Sitemap: Page URL probe sampling — ${originalTotal} page URL(s) discovered, ${sumQ} selected `
    + `(target cap ${FAST_MAX_PAGE_URLS_PROBED}, with at least 1 probe per each sitemap.xml file).`,
  );
  return out;
}

/**
 * Checks robots.txt for sitemap URLs
 */
export async function checkRobotsForSitemap(protocol, domain) {
  const robotsUrl = `${protocol}://${domain}/robots.txt`;
  const sitemapPaths = [];

  const robotsContent = await fetchContent(robotsUrl);
  const sitemapMatches = robotsContent.payload.matchAll(/Sitemap:\s*(.*)/gi);

  for (const match of sitemapMatches) {
    const answer = match[1].trim();
    if (answer?.length) {
      sitemapPaths.push(answer);
    }
  }

  return {
    paths: sitemapPaths,
    reasons: sitemapPaths.length ? [] : [ERROR_CODES.NO_SITEMAP_IN_ROBOTS],
  };
}

/**
 * Validates sitemap content format
 */
export function isSitemapContentValid(sitemapContent) {
  const validStarts = ['<?xml', '<urlset', '<sitemapindex'];
  return validStarts.some((start) => sitemapContent.payload.trim().startsWith(start))
    || VALID_MIME_TYPES.some((type) => sitemapContent.type.includes(type));
}

/**
 * Checks sitemap validity and existence
 */
export async function checkSitemap(sitemapUrl, log) {
  try {
    log?.debug(`Sitemap: Fetching sitemap URL: ${sitemapUrl}`);
    const sitemapContent = await fetchContent(sitemapUrl);
    log?.info(`Sitemap: Successfully fetched sitemap URL: ${sitemapUrl} with content type: ${sitemapContent.type}`);
    const isValidFormat = isSitemapContentValid(sitemapContent);
    const isSitemapIndex = isValidFormat && sitemapContent.payload.includes('</sitemapindex>');
    const isText = isValidFormat && sitemapContent.type === 'text/plain';

    if (!isValidFormat) {
      return {
        existsAndIsValid: false,
        reasons: [ERROR_CODES.SITEMAP_FORMAT],
      };
    }

    return {
      existsAndIsValid: true,
      reasons: [],
      details: { sitemapContent, isText, isSitemapIndex },
    };
  } catch (error) {
    /* c8 ignore next */
    log?.error(`Sitemap: Error fetching sitemap URL ${sitemapUrl}: ${error.message}`);
    const isNotFound = error.message.includes('404');
    return {
      existsAndIsValid: false,
      reasons: [isNotFound ? ERROR_CODES.SITEMAP_NOT_FOUND : ERROR_CODES.FETCH_ERROR],
    };
  }
}

/**
 * Retrieves base URL pages from sitemaps with improved error handling
 */
export async function getBaseUrlPagesFromSitemaps(inputUrl, initialUrls, log) {
  // Strip subpath to get domain-only URL for sitemap.xml matching
  const baseUrl = getUrlWithoutPath(inputUrl);
  const baseUrlVariant = toggleWWW(baseUrl);
  const pagesBySitemap = {};
  let sitemapsToProcess = [...initialUrls];
  const processedSitemaps = new Set();

  /* c8 ignore next */
  log?.info(`Sitemap: Starting to process ${sitemapsToProcess.length} initial sitemap URLs for ${inputUrl}`);
  while (sitemapsToProcess.length > 0) {
    const sitemapsFromIndexes = [];

    const processOne = async (sitemapUrl) => {
      if (processedSitemaps.has(sitemapUrl)) {
        return;
      }
      processedSitemaps.add(sitemapUrl);
      /* c8 ignore next */
      log?.debug(`Sitemap: Processing sitemap URL: ${sitemapUrl} for ${inputUrl}`);

      const sitemapData = await checkSitemap(sitemapUrl, log);
      /* c8 ignore next */
      log?.debug(`Sitemap: .. Sitemap URL ${sitemapUrl} ... exists and is valid: ${sitemapData.existsAndIsValid} ... with reason ${sitemapData.reasons} for ${inputUrl}`);

      if (sitemapData.existsAndIsValid) {
        if (sitemapData.details?.isSitemapIndex) {
          const extractedSitemaps = getSitemapUrlsFromSitemapIndex(
            sitemapData.details.sitemapContent,
          );
          sitemapsFromIndexes.push(...extractedSitemaps);
        } else if (
          sitemapUrl.startsWith(baseUrl)
          || sitemapUrl.startsWith(baseUrlVariant)
        ) {
          // Process sitemaps under the same domain; page URL filtering uses inputUrl
          const pages = getBaseUrlPagesFromSitemapContents(
            inputUrl,
            sitemapData.details,
          );
          if (pages.length > 0) {
            pagesBySitemap[sitemapUrl] = pages;
          }
        }
      }
    };

    // Process sitemap.xml files in batches with delay between batches
    for (let i = 0; i < sitemapsToProcess.length; i += SITEMAP_XML_BATCH_SIZE) {
      const chunk = sitemapsToProcess.slice(i, i + SITEMAP_XML_BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(chunk.map(processOne));
      if (i + SITEMAP_XML_BATCH_SIZE < sitemapsToProcess.length) {
        // eslint-disable-next-line no-await-in-loop
        await delay(SITEMAP_XML_BATCH_DELAY_MS);
      }
    }

    sitemapsToProcess = sitemapsFromIndexes;
  }

  return pagesBySitemap;
}

export async function getSitemapUrls(inputUrl, log) {
  const parsedUrl = extractDomainAndProtocol(inputUrl);
  if (!parsedUrl) {
    /* c8 ignore next */
    log?.error(`Sitemap: Invalid URL provided: ${inputUrl}`);
    return {
      success: false,
      reasons: [{ value: inputUrl, error: ERROR_CODES.INVALID_URL }],
    };
  }

  const { protocol, domain } = parsedUrl;

  let sitemapUrls = { ok: [], notOk: [] };

  // Try to find sitemaps in robots.txt
  try {
    const robotsResult = await checkRobotsForSitemap(protocol, domain);
    if (robotsResult?.paths?.length) {
      sitemapUrls.ok = robotsResult.paths;
      log?.info(`Sitemap: Found ${robotsResult.paths.length} sitemap URL(s) in robots.txt for ${inputUrl}`);
    }
  } catch (error) {
    /* c8 ignore next */
    log?.error(`Sitemap: Error checking robots.txt for ${inputUrl}: ${error.message}`);
    // If robots.txt fails, return error immediately (since something is horribly wrong)
    return {
      success: false,
      reasons: [{ value: `${error.message}`, error: ERROR_CODES.FETCH_ERROR }],
    };
  }

  // If no sitemaps found in robots.txt, try common locations
  if (!sitemapUrls.ok.length) {
    log?.debug(`Sitemap: No sitemap URLs found in robots.txt for ${inputUrl}, trying common locations.`);
    const commonSitemapUrls = [
      `${protocol}://${domain}/sitemap.xml`,
      `${protocol}://${domain}/sitemap_index.xml`,
    ];
    // note: we are really using `filterValidUrls` for the side effect of checking their presence
    sitemapUrls = await filterValidUrls(commonSitemapUrls, log, SITEMAP_GET_TIMEOUT_MS, {
      pageUrlBatchSize: SITEMAP_XML_BATCH_SIZE,
      pageUrlBatchDelayMs: SITEMAP_XML_BATCH_DELAY_MS,
    });

    if (!sitemapUrls.ok?.length) {
      return {
        success: false,
        reasons: [{
          value: `${protocol}://${domain}/robots.txt`,
          error: ERROR_CODES.NO_SITEMAP_IN_ROBOTS,
        }],
        details: { issues: sitemapUrls.notOk },
      };
    }
  }

  // Extract and validate page URLs from our validated sitemap URLs:
  //   getBaseUrlPagesFromSitemaps filters sitemaps by domain, then filters page URLs by full path
  const extractedPaths = await getBaseUrlPagesFromSitemaps(inputUrl, sitemapUrls.ok, log);
  log?.info(`Sitemap: Extracted ${Object.keys(extractedPaths).length} sitemap URLs for ${inputUrl}`);
  log?.info(`Sitemap: Extracted ${Object.values(extractedPaths).reduce((sum, pages) => sum + pages.length, 0)} page URLs from sitemaps for ${inputUrl}`);

  return {
    success: true,
    reasons: [{ value: 'URLs are extracted from sitemap.' }],
    details: {
      extractedPaths,
      filteredSitemapUrls: sitemapUrls.ok, // Validated sitemap URLs
    },
  };
}
