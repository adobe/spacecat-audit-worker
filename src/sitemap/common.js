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

import { load as cheerioLoad } from 'cheerio';
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
export const FAST_PAGE_URL_BATCH_SIZE = 700; // must stay under 1000 per SpaceCat arch
export const FAST_PAGE_URL_BATCH_DELAY_MS = 0; // none

// Dynamic switch from fast → slow page-URL batching when 'otherStatus' dominates
export const PAGE_URL_OTHER_STATUS_SLOWDOWN_MIN_URLS = 10; // min probes before evaluating the ratio
export const PAGE_URL_OTHER_STATUS_SLOWDOWN_RATIO = 0.6; // once we hit 60%+ we switch
export const SLOW_MODE_ENTRY_DELAY_MS = 300_000; // long pause for WAF when switching into slow mode

// "Slow" batching when fetching/validating page URLs
export const SLOW_MAX_PAGE_URLS_PROBED = 1000; // smaller set to use when running slow
export const SLOW_PAGE_URL_BATCH_SIZE = 4; // must stay under 1000 per SpaceCat arch
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

/**
 * URL {@link URL#protocol} values treated as the same family for comparisons and normalized
 * to {@code https:} in {@link pathnameKey} so http/https variants of the same resource match.
 */
export const HTTP_AND_HTTPS_PROTOCOLS = Object.freeze(['http:', 'https:']);

/** HEAD responses that we will retry with a GET request. */
const HEAD_FALLBACK_STATUSES = Object.freeze([403, 404, 405, 501]);

/** HTTP statuses treated as redirects when probing page URLs ({@code redirect: 'manual'}). */
export const REDIRECT_STATUSES = Object.freeze([301, 302, 303]);

/** Max bytes read from a streamed GET when looking for {@code link rel="canonical"} */
const MAX_CANONICAL_HTML_BYTES = 512 * 1024;

// ----- functions -------------------------------------------------------------

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
 * Returns a function that enforces a minimum interval between the start of consecutive requests.
 * When in slowdown mode, this allows us to honor the slower rate of requests to the webserver.
 * Note that a given probe of a page URL might use a HEAD request, followed by a GET request.
 *
 * @param {number} intervalMs
 * @returns {(() => Promise<void>) | null}
 */
function createPageUrlHttpRequestThrottle(intervalMs) {
  if (intervalMs == null || intervalMs <= 0) {
    return null;
  }
  let nextAllowedAt = 0;
  return async function beforeHttpRequest() {
    const now = Date.now();
    const waitMs = Math.max(0, nextAllowedAt - now);
    if (waitMs > 0) {
      await delay(waitMs);
    }
    nextAllowedAt = Date.now() + intervalMs;
  };
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
 *
 * `options`
 * - `options.beforeRequest` if present, is invoked before each outbound request (HEAD, with a
 *   possible GET fallback) so callers can enforce spacing between requests when probing page URLs.
 * - `options.timeout` max wait for each request to finish (default {@link PAGE_URL_TIMEOUT_MS}).
 *
 * @returns {Promise<Response>} A promise that resolves to the Response from the HEAD request
 *   unless the HEAD response status is in the configured fallback list (e.g. 403, 404, 405, 501),
 *   in which case this function will attempt a GET and resolve with that GET Response instead.
 *
 *   Notes on what is returned:
 *   - If the initial HEAD call throws (network error / timeout), the promise will reject with
 *     that error (the error is not caught inside this function).
 *   - If HEAD returns a fallback status but the GET attempt throws, this function will return
 *     the original HEAD Response object (so callers can inspect the original status code).
 */
export async function fetchWithHeadFallback(url, options = {}) {
  const { beforeRequest, ...rest } = options; // the `beforeRequest` function
  const timeout = rest.timeout ?? PAGE_URL_TIMEOUT_MS;
  const fetchOptions = { ...rest, timeout }; // ensure our `timeout` is used

  await beforeRequest?.(); // if present, deliberately wait before sending this request
  // note: the `fetch` could throw an exception for network errors or for timing out
  const headResponse = await fetch(url, {
    ...fetchOptions,
    method: 'HEAD',
  });

  // If HEAD fails with a known "fallback" status code, retry with GET
  if (HEAD_FALLBACK_STATUSES.includes(headResponse.status)) {
    try {
      await beforeRequest?.(); // if present, deliberately wait before sending this request
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

// unit test-able function ... actual use is for debug logging
export function formatUrlProbeErrorDetail(err) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * Returns the first usable {@code link rel="canonical"} href from HTML, or null.
 *
 * @param {string} rawBody - HTML (can be truncated)
 * @param {string} documentUrl - Base URL for resolving relative href values
 * @returns {string|null} Absolute canonical href, or null
 */
export function extractCanonicalHrefFromHtml(rawBody, documentUrl) {
  if (!rawBody || typeof rawBody !== 'string' || !documentUrl) {
    return null; // we have nothing to work with, so return null
  }
  try {
    const $ = cheerioLoad(rawBody); // $ == jQuery/Cheerio selector function
    const headCanonicals = $('head link[rel="canonical"]');
    const allCanonicals = $('link[rel="canonical"]');
    const count = allCanonicals.length;
    if (count === 0) {
      return null; // no canonical link found
    }
    const inHead = headCanonicals.length > 0;
    const href = (inHead ? headCanonicals : allCanonicals).first().attr('href');
    if (!href || !String(href).trim()) {
      return null; // the canonical link contains nothing
    }
    return new URL(String(href).trim(), documentUrl).href;
  } catch {
    return null;
  }
}

/**
 * Returns the response text capped to {@code maxBytes}.
 *
 * @param {*} response - Response-like object with an async text() method.
 * @param {number} maxBytes - Maximum number of characters to return.
 *
 * @returns {Promise<string>} Promise resolving to the response body converted to a string and
 *                            truncated to maxBytes characters.
 */
async function streamResponseTextCapped(response, maxBytes) {
  // Uses response.text() so nock/undici bodies are consumed reliably
  // (streaming readers can yield empty chunks in test doubles).
  const t = await response.text();
  return String(t).slice(0, maxBytes);
}

/**
 * Gets the document and returns its truncated HTML suitable to parse to discover its canonical URL.
 *
 * @param {string} documentUrl - URL we are wanting to find the canonical URL for
 * @param {(() => Promise<void>) | null | undefined} beforeRequest - delay before the GET request
 * @param {number} timeoutMs - how long we wait for the GET request to complete before giving up
 *
 * @returns {Promise<string | null>} HTML payload, or null when unavailable or not HTML-like
 */
async function getDocumentHtmlForCanonical(documentUrl, beforeRequest, timeoutMs) {
  if (!documentUrl) {
    return null;
  }

  await beforeRequest?.();

  let response;
  try {
    response = await fetch(documentUrl, {
      method: 'GET',
      redirect: 'manual',
      timeout: timeoutMs,
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const fromContentType = /html|xml\+html|xhtml/i.test(contentType); // html xml+html xhtml

  const text = await streamResponseTextCapped(response, MAX_CANONICAL_HTML_BYTES);
  const fromBodyPrefix = /^[\s\n\r]*</.test(text); // does text start with a '<'

  const seemsLikeTextIsHtml = fromContentType || fromBodyPrefix;
  if (!seemsLikeTextIsHtml) {
    return null;
  }

  return text.length > 0 ? text : null;
}

/**
 * Returns a normalized string for comparing resources.
 *
 * The returned string is safe to compare for "same resource" semantics:
 * - uses hostname (lowercased); {@link HTTP_AND_HTTPS_PROTOCOLS} are normalized to {@code https:}
 * - preserves the pathname but trims a trailing slash except for the root path
 *
 * Examples:
 *   pathnameKey('https://Example.COM/foo/') === 'https://example.com/foo' // lowercase
 *   pathnameKey('http://example.com/foo') === 'https://example.com/foo'   // protocol compatibility
 *   pathnameKey('https://example.com/') === 'https://example.com/'        // exactly the same
 *
 * If `urlString` is not a valid absolute URL, the original input is returned unchanged.
 *
 * @param {string} urlString - absolute URL string to normalize
 * @returns {string} origin + normalized pathname (or the original `urlString` if parsing fails)
 */
export function pathnameKey(urlString) {
  try {
    const u = new URL(urlString);
    let { pathname } = u;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    const protocol = HTTP_AND_HTTPS_PROTOCOLS.includes(u.protocol) ? 'https:' : u.protocol;
    return `${protocol}//${u.hostname.toLowerCase()}${pathname}`;
  } catch {
    return urlString;
  }
}

/**
 * Returns true if the canonical URL is a better match than the suggested URL.
 * The canonical URL must match the suggested URL except for the canonical can lack a suffix.
 *
 * Examples of true:
 * * https://www.example.com/my-stuff.page  and  https://www.example.com/my-stuff
 * * https://www.example.com/my-stuff.html  and  http://www.example.com/my-stuff
 * * https://www.example.com/my-stuff       and  http://www.example.com/my-stuff
 *
 * Examples of false:
 * * https://www.example.com/my-stuff.page  and  https://www.example.com/my-stuffing
 * * https://www.example.com/foo/bar        and  https://www.example.com/foo
 *
 * @param {string} suggestedUrl - What we think we want to suggest
 * @param {string} canonicalUrl - Absolute canonical href from HTML page
 * @returns {boolean}
 */
export function suggestedUrlMatchesCanonicalUrlWithoutSuffix(
  suggestedUrl,
  canonicalUrl,
) {
  let s;
  let c;
  try {
    s = new URL(suggestedUrl);
    c = new URL(canonicalUrl);
  } catch {
    return false; // since we cannot create proper URL objects
  }

  // for our purposes, we treat "https:" as compatible with "http:"
  const protocolsCompatible = s.protocol === c.protocol
    || (HTTP_AND_HTTPS_PROTOCOLS.includes(s.protocol)
      && HTTP_AND_HTTPS_PROTOCOLS.includes(c.protocol));
  if (!protocolsCompatible) {
    return false;
  }

  if (s.hostname.toLowerCase() !== c.hostname.toLowerCase()) {
    return false;
  }

  const normalizePathname = (pathname) => {
    let p = pathname;
    if (p.length > 1 && p.endsWith('/')) {
      p = p.slice(0, -1);
    }
    return p; // has trailing slash removed
  };
  const sp = normalizePathname(s.pathname);
  const cp = normalizePathname(c.pathname);

  if (sp.length < cp.length) {
    return false;
  }
  if (!sp.startsWith(cp)) {
    return false;
  }

  const rest = sp.slice(cp.length);
  if (!rest.startsWith('.')) {
    return false; // since we are looking for a suffix on the suggested URL
  }
  const afterDot = rest.slice(1);
  if (afterDot.length === 0 || afterDot.includes('/')) {
    return false;
  }

  return true; // the canonical URL can be used in place of the suggested URL
}

/**
 * When {@code documentUrl} is {@code http:} but {@code probedUrl} was {@code https:}, returns the
 * {@code https:} variant of {@code documentUrl} for canonical HTML fetch; otherwise {@code null}.
 *
 * @param {string} documentUrl - suggested replacement URL
 * @param {string} probedUrl - originally probed sitemap URL
 * @returns {string|null}
 */
export function httpsDocumentUrlForCanonicalRefinement(documentUrl, probedUrl) {
  if (documentUrl.startsWith('http://') && probedUrl.startsWith('https://')) {
    return `https://${documentUrl.slice('http://'.length)}`;
  }
  return null;
}

/**
 * GETs HTML for canonical refinement for the documentUrl. Also returns the actual documentUrl we
 * used to retrieve this HTML.
 *
 * When the probed URL was https but the suggested documentUrl is http,
 * tries the https variant first for the documentUrl, then falls back to the original http.
 *
 * @param {string} documentUrl
 * @param {string} probedUrl
 * @param {(() => Promise<void>) | null | undefined} beforeRequest - delay before the GET request
 * @param {number} timeoutMs - how long we wait for the GET request to complete before giving up
 *
 * @returns {Promise<{ html: string | null, documentUrl: string }>}
 */
export async function fetchHtmlForCanonicalRefinement(
  documentUrl,
  probedUrl,
  beforeRequest,
  timeoutMs,
) {
  // determine if we really have two different versions of the documentUrl to try
  const httpsDocumentUrl = httpsDocumentUrlForCanonicalRefinement(documentUrl, probedUrl);
  if (httpsDocumentUrl) {
    // if we need to try two different versions, then 1st try the modified  "https://" version
    const httpsHtml = await getDocumentHtmlForCanonical(
      httpsDocumentUrl,
      beforeRequest,
      timeoutMs,
    );
    if (httpsHtml) {
      return { html: httpsHtml, documentUrl: httpsDocumentUrl };
    }
  }

  // try the original version of the documentUrl
  const html = await getDocumentHtmlForCanonical(documentUrl, beforeRequest, timeoutMs);
  return { html, documentUrl };
}

/**
 * Typically after a redirect {@code notOk} decision, GET the document and refine using
 * {@code rel="canonical"}. Promotes to {@code ok} when canonical matches the probed URL;
 * otherwise may replace {@code urlsSuggested} when canonical matches the suggested URL's path
 * (exact pathname) or extends it with a dot-suffix segment per
 * {@link suggestedUrlMatchesCanonicalUrlWithoutSuffix}.
 *
 * @param {object} params
 * @param {string} params.documentUrl - URL to GET so we can extract its canonical href
 *        note: in specific cases we might try the "https://" variant 1st, and then the original URL
 * @param {string} params.probedUrl - the originally probed URL
 * @param {Object} params.notOkPayload - the `notOk` payload to refine
 *        (shape: { type: string, url: string, statusCode?: number, urlsSuggested?: string })
 * @param {(() => Promise<void>) | null | undefined} params.beforeRequest - optional
 *        throttle callback to be invoked before the GET
 * @param {number} params.timeoutMs - timeout in ms while we wait for the GET request to return
 * @param {Object} [params.log] - optional logger for diagnostics
 *
 * @returns {Promise<{
 *   type: string,
 *   url: string,
 *   statusCode?: number,
 *   urlsSuggested?: string
 * }>}
 */
async function refineSuggestedUrlWithItsCanonicalUrl({
  documentUrl,
  probedUrl,
  notOkPayload,
  beforeRequest,
  timeoutMs,
  log,
}) {
  const { html, documentUrl: effectiveDocumentUrl } = await fetchHtmlForCanonicalRefinement(
    documentUrl,
    probedUrl,
    beforeRequest, // any delay needed
    timeoutMs,
  );
  if (!html) {
    return notOkPayload;
  }

  const canonicalUrl = extractCanonicalHrefFromHtml(html, effectiveDocumentUrl);
  if (!canonicalUrl || !/^https?:\/\//i.test(canonicalUrl)) {
    /* c8 ignore start -- log-only */
    log?.info(
      `Sitemap: could not find a valid canonical URL for probed URL ${probedUrl} that redirected to the suggested URL ${documentUrl}. Keeping original suggested URL.`,
    );
    /* c8 ignore end */
    return notOkPayload; // since we could not extract a valid canonical URL, we return what we have
  }
  /* c8 ignore start -- log-only */
  log?.debug(
    `Sitemap: refining suggested URL with canonical URL: probedUrl=${probedUrl}, suggestedUrl=${effectiveDocumentUrl}, canonicalUrl=${canonicalUrl ?? ''}`,
  );
  /* c8 ignore end */

  // if the canonical URL is essentially the page URL we are probing, then everything is A-OK.
  //   ex: if the probed URL redirects to a URL that is just the probed URL with query params.
  if (pathnameKey(probedUrl) === pathnameKey(canonicalUrl)) {
    /* c8 ignore start -- log-only; branch outcome covered by filterValidUrls redirect tests */
    log?.info(
      `Sitemap: canonical matches probed URL path for ${probedUrl}; everything is actually OK.`,
    );
    /* c8 ignore end */
    return { type: 'ok', url: probedUrl }; // note that we do NOT return the `notOkPayload`
  }

  // if the canonical URL is essentially our suggested URL, use the canonical URL instead
  const suggestedUrl = notOkPayload.urlsSuggested;
  if (
    typeof suggestedUrl === 'string'
    && suggestedUrl.length > 0
    && (pathnameKey(suggestedUrl) === pathnameKey(canonicalUrl)) // ignore query parms
  ) {
    log?.debug(
      `Sitemap: using the canonical URL ${canonicalUrl} (replacing initial suggested URL ${suggestedUrl}) for the probed URL ${probedUrl}.`,
    );
    return { ...notOkPayload, urlsSuggested: canonicalUrl };
  }

  // if the canonical URL is a reasonably shorter form of our suggested URL, use the canonical URL
  if (
    typeof suggestedUrl === 'string'
    && suggestedUrl.length > 0
    && suggestedUrlMatchesCanonicalUrlWithoutSuffix(suggestedUrl, canonicalUrl)
  ) {
    log?.debug(
      `Sitemap: suggesting the canonical URL ${canonicalUrl} (terminal path extends canonical by dot suffix; replacing ${suggestedUrl}) for probed ${probedUrl}.`,
    );
    return { ...notOkPayload, urlsSuggested: canonicalUrl };
  }

  // keep our originally suggested URL
  return notOkPayload;
}

/**
 * Returns a structure of the results of validating each URL.
 * The returned structure filters each of these URLs into exactly one "bucket."
 *
 * Validation means performing a HEAD request on the URL and reacting on the returned
 * HTTP status code. (If the web server rejects HEAD requests, we try with a GET.)
 * * 200 -- valid URL; add to the `ok` bucket ... this is the preferred response
 * * 301, 302, 303, etc. -- redirected; add to `notOk` bucket with a suggestion to replace the URL:
 * * * we prefer to use the terminal "final" URL
 * * * otherwise, we will use the "first hop" URL
 * * * however, there are cases where we have no suggested URL
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
 * @param {number} [pageUrlBatchOptions.pageUrlHttpRequestIntervalMs] - when set, minimum spacing
 *        between each HTTP request made while probing (HEAD, GET fallback, redirect checks)
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

  // if specified, build the `beforeRequest` callback to force a delay between HTTP requests
  const beforeRequest = createPageUrlHttpRequestThrottle(
    pageUrlBatchOptions?.pageUrlHttpRequestIntervalMs,
  );
  const probeFetchOpts = beforeRequest ? { beforeRequest } : {};

  // callback to validate a specific URL
  const checkUrl = async (url) => {
    try {
      const response = await fetchWithHeadFallback(url, {
        ...probeFetchOpts, // == beforeRequest: callbackFunction
        redirect: 'manual', // so we can watch if we initially go to an auth or a login page
        timeout: timeoutMs,
      });

      // Handle an immediately successful response
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
      if (REDIRECT_STATUSES.includes(response.status)) {
        const redirectUrl = response.headers.get('location');
        const firstHopUrl = redirectUrl ? new URL(redirectUrl, url).href : null;

        // if there is no `firstHopUrl` then something is wrong with the website itself
        if (!firstHopUrl) {
          log?.error(
            `Sitemap: redirect (${response.status}) for ${url} has no 'Location' header; `
            + 'cannot suggest a replacement URL. Marking as a 404 error.',
          );
          return {
            type: 'notOk',
            url,
            statusCode: 404, // we need to remove this entry from the sitemap.xml file
            urlsSuggested: '', // no reasonable suggestion available: no Location header
          };
        }

        // if redirect leads to an auth or a login page, then treat as valid
        if (isAuthUrl(firstHopUrl)) {
          return { type: 'ok', url };
        }

        // follow the redirect to find its terminal URL
        let terminalValid = false; // to become true: return a 200 and not be a 404 page
        let terminalUrl = firstHopUrl; // "final" URL after following the redirect to its end
        let redirectResponse = null;
        try {
          redirectResponse = await fetchWithHeadFallback(firstHopUrl, {
            ...probeFetchOpts, // == beforeRequest: callbackFunction
            redirect: 'follow',
            timeout: timeoutMs,
          });

          const resolvedUrl = redirectResponse.url?.trim();
          if (resolvedUrl) {
            terminalUrl = resolvedUrl; // otherwise keep terminalUrl equal to firstHopUrl
          }

          const statusOk = redirectResponse.status === 200;
          const looks404 = redirectResponse.status === 404
            || urlLooksLike404Page(terminalUrl);
          terminalValid = statusOk && !looks404;
        } catch {
          terminalValid = false;
          redirectResponse = null;
        }

        // create a callback function: will refine the URL we will be suggesting for this redirect
        /**
         * Returns a payload based on canonically refining the input payload's suggested URL.
         * See documentation below for details.
         *
         * @param {{ type: string, url: string, statusCode?: number, urlsSuggested?: string }} row
         *        the `notOk` payload object to refine; see {@link filterValidUrls}.
         * @param {Object} [refineLog] - optional logger
         *
         * @returns {Promise<{
         *   type: string,
         *   url: string,
         *   statusCode?: number,
         *   urlsSuggested?: string
         * }>} A promise that resolves to the refined payload. The refinement function may return
         * the original `row`, a modified `row` with `urlsSuggested` replaced, or an `ok`-typed
         * object when the refinement actually indicates the probed URL is the correct resource.
         */
        const refine = (row, refineLog = log) => refineSuggestedUrlWithItsCanonicalUrl({
          documentUrl: row.urlsSuggested, // URL we will try to refine by getting its canonical URL
          probedUrl: url, // the original URL that was investigated
          notOkPayload: row, // the `notOk` object to refine. Might be transformed into an `ok`.
          beforeRequest, // callback method (if any) that provides a delayed start to processing
          timeoutMs, // how long we wait for our response (before we give up)
          log: refineLog, // optional logger
        });

        if (terminalValid) {
          log?.debug(`Sitemap: refining the terminal URL ${terminalUrl} as the suggest URL`);
          return refine({
            type: 'notOk',
            url,
            statusCode: response.status, // a redirect HTTP code
            urlsSuggested: terminalUrl, // refine: if available, use its canonical URL instead
          });
        }

        // Terminal URL could not be confirmed (e.g. WAF 403). Still suggest first Location when it
        // differs from the probed URL and the failure is not a clear HTTP/path 404.
        const terminalClearly404 = redirectResponse
          && (redirectResponse.status === 404 || urlLooksLike404Page(terminalUrl));
        const probedHref = new URL(url).href;
        const firstHopHref = new URL(firstHopUrl).href;
        const terminalHref = new URL(terminalUrl).href;
        // if the first hop is the same as the probed URL, then we have no suggestion to make
        if (firstHopHref === probedHref) {
          log?.debug('Sitemap: first hop URL equals probed URL (self-redirect) so everything is ok.', {
            probedUrl: url,
            locationHeader: redirectUrl,
            firstHopUrl,
            firstHopHref,
            terminalCandidate: terminalUrl,
            terminalStatus: redirectResponse?.status,
          });
          return { type: 'ok', url };
        }

        // when the terminal URL has an unclear status, try to recommend the first hop instead
        if (!terminalClearly404 && !urlLooksLike404Page(firstHopUrl)) {
          if (firstHopHref !== terminalHref) {
            log?.info(
              `Sitemap: recommending first hop URL instead of terminal URL for ${url} as the redirect URL; `
              + `first hop: ${firstHopUrl}, terminal candidate: ${terminalUrl}, `
              + `terminal response status: ${redirectResponse?.status ?? 'error'}.`,
            );
          }
          return refine({
            type: 'notOk',
            url,
            statusCode: response.status, // a redirect HTTP code
            urlsSuggested: firstHopUrl, // refine: if available, use its canonical URL instead
          });
        }

        // we have a redirect, but the first hop URL and/or the terminal URL looks like a 404 page
        log?.debug(
          `Sitemap: redirect (${response.status}) for ${url} does not resolve to a valid terminal page URL; `
          + `first hop: ${firstHopUrl}, terminal URL: ${terminalUrl}. At least one of these seem to be a 404 page.`,
        );
        // eslint-disable-next-line object-curly-newline
        return { type: 'notOk', url, statusCode: 404, urlsSuggested: '' };
      }

      // Handle explicit 404s
      if (response.status === 404) {
        // eslint-disable-next-line object-curly-newline
        return { type: 'notOk', url, statusCode: response.status, urlsSuggested: '' };
      }

      // All remaining status codes
      return { type: 'otherStatus', url, statusCode: response.status };
    } catch (err) {
      // exception during the fetch (network error, timeout, etc.) is considered a network error
      const detail = formatUrlProbeErrorDetail(err);
      log?.debug(`Sitemap: network error while probing URL ${url}: ${detail}`);
      // eslint-disable-next-line object-curly-newline
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
            results.notOk.push({
              url,
              statusCode,
              ...(urlsSuggested != null && { urlsSuggested }), // will also keep an empty string
            });
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
      `Sitemap: ${working.length} sitemaps with page URLs exceed cap ${FAST_MAX_PAGE_URLS_PROBED}; `
      + `only the first ${FAST_MAX_PAGE_URLS_PROBED} sitemaps will be probed.`,
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
      `Sitemap: Proportional quotas will actually probe ${sumQ} page URLs, above the `
      + `FAST_MAX_PAGE_URLS_PROBED (${FAST_MAX_PAGE_URLS_PROBED}) desired limit.`,
    );
  }

  // Build the actual set of page URLs to be probed from each of the sitemap.xml files
  const out = {};
  working.forEach(([key, urls], i) => {
    out[key] = urls.slice(0, quotas[i]); // quotas[i] is always >= 1
  });
  log?.info(
    `Sitemap: Page URL probe sampling — ${originalTotal} page URLs discovered, ${sumQ} selected `
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
    log?.debug(`Sitemap: Successfully fetched sitemap URL: ${sitemapUrl} with content type: ${sitemapContent.type}`);
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
      log?.info(`Sitemap: Found ${robotsResult.paths.length} sitemap URLs in robots.txt for ${inputUrl}`);
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
