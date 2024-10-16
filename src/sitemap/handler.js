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

import { composeAuditURL, prependSchema } from '@adobe/spacecat-shared-utils';
import {
  extractDomainAndProtocol,
  fetch,
  getBaseUrlPagesFromSitemapContents,
  getSitemapUrlsFromSitemapIndex,
  getUrlWithoutPath,
  toggleWWW,
} from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';

export const ERROR_CODES = Object.freeze({
  INVALID_URL: 'Invalid URL',
  NO_SITEMAP_IN_ROBOTS: 'Does not mention a sitemap path',
  NO_VALID_PATHS_EXTRACTED: 'No valid URLs were found in the sitemap.',
  SITEMAP_NOT_FOUND: 'Sitemap could not be found',
  SITEMAP_EMPTY: 'Sitemap is empty',
  SITEMAP_FORMAT: 'Invalid sitemap format',
  FETCH_ERROR: 'Error fetching data',
});

const VALID_MIME_TYPES = Object.freeze([
  'application/xml',
  'text/xml',
  'text/html',
  'text/plain',
]);

/**
 * Fetches the content from a given URL.
 *
 * @async
 * @param {string} targetUrl - The URL from which to fetch the content.
 * @param log
 * @returns {Promise<{
 *    payload: string,
 *    type: string
 * } | null>} - A promise that resolves to the content.
 * of the response as a structure having the contents as the payload string
 * and the content type as the type string if the request was successful, otherwise null.
 * @throws {Error} If the fetch operation fails or the response status is not OK.
 */
export async function fetchContent(targetUrl, log) {
  try {
    const response = await fetch(targetUrl);
    log?.info(`Response Status: ${response.status} for ${targetUrl}`);
    log?.info(`Response Headers: ${JSON.stringify(response.headers.raw())}`);

    if (!response.ok) {
      log.info(`Fetch error for ${targetUrl}: Status ${response.status}`);
      return null;
    }

    const text = await response.text();
    log?.info(`Response Size: ${text.length}`);
    return { payload: text, type: response.headers.get('content-type') };
  } catch (error) {
    log.info(`Fetch error for ${targetUrl}: ${error.message}`);
    return null;
  }
}

/**
 * Checks the robots.txt file for a sitemap and returns the sitemap paths if found.
 *
 * @async
 * @param {string} protocol - The protocol (http or https) of the site.
 * @param {string} domain - The domain of the site.
 * @param log
 * @returns {Promise<{ paths: string[], reasons: string[] }>} - A Promise that resolves
 * to an object containing the sitemap paths and reasons for success or failure.
 * The object has the following properties:
 * - paths: An array of strings representing the sitemap paths found in the robots.txt file.
 * - reasons: An array of strings representing the reasons for not finding any sitemap paths.
 * @throws {Error} If the fetch operation fails or the response status is not OK.
 */
export async function checkRobotsForSitemap(protocol, domain, log) {
  const robotsUrl = `${protocol}://${domain}/robots.txt`;
  const sitemapPaths = [];
  const robotsContent = await fetchContent(robotsUrl, log);

  if (robotsContent !== null) {
    const sitemapMatches = robotsContent.payload.matchAll(/Sitemap:\s*(.*)/gi);
    for (const match of sitemapMatches) {
      const path = match[1].trim();
      sitemapPaths.push(path);
      log.info(`Extracted sitemap path: ${path}`);
    }
  } else {
    log.error('No content found in robots.txt');
  }

  return {
    paths: sitemapPaths,
    reasons: sitemapPaths.length ? [] : [ERROR_CODES.NO_SITEMAP_IN_ROBOTS],
  };
}
/**
 * Checks if the sitemap content is valid.
 *
 * @param {{ payload: string, type: string }} sitemapContent - The sitemap content to validate.
 * @param log
 * @returns {boolean} - True if the sitemap content is valid, otherwise false.
 */
export function isSitemapContentValid(sitemapContent, log) {
  const validStarts = ['<?xml', '<urlset', '<sitemapindex'];
  const isValid = validStarts.some((start) => sitemapContent.payload.trim().startsWith(start))
      || VALID_MIME_TYPES.some((type) => sitemapContent.type.includes(type));

  // Log the validation result if `log` is provided
  log?.info?.(`Sitemap content validation result: ${isValid}`);

  return isValid;
}

/**
 * Checks the validity and existence of a sitemap by fetching its content.
 *
 * @async
 * @returns {Promise<Object>} - A Promise that resolves to an object representing the result check.
 * The object has the following properties:
 * - existsAndIsValid: A boolean indicating whether the sitemap exists and is in a valid format.
 * - reasons: An array of strings representing the reasons for the sitemap's errors.
 * - details: An object with details about sitemap.Is only present if the sitemap exists and valid.
 *   The details object has the following properties:
 *   - sitemapContent: The content of the sitemap.
 *   - isText: A boolean indicating whether the sitemap content is plain text.
 *   - isSitemapIndex: A boolean indicating whether the sitemap is an index of other sitemaps.
 */
export async function checkSitemap(sitemapUrl, log) {
  try {
    const sitemapContent = await fetchContent(sitemapUrl, log);
    const isValidFormat = isSitemapContentValid(sitemapContent, log);
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
    if (error.message.includes('404')) {
      return {
        existsAndIsValid: false,
        reasons: [ERROR_CODES.SITEMAP_NOT_FOUND],
      };
    }
    return {
      existsAndIsValid: false,
      reasons: [ERROR_CODES.FETCH_ERROR],
    };
  }
}

/**
 * Filters a list of URLs to return only those that exist.
 *
 * @async
 * @param {string[]} urls - An array of URLs to check.
 * @param {Object} log - The logging object to record information and errors.
 * @returns {Promise<{ok: string[], notOk: string[], err: string[]}>} -
 * A promise that resolves to a dict of URLs that exist.
 */
async function filterValidUrls(urls, log) {
  const OK = 1;
  const NOT_OK = 2;
  const ERR = 3;

  const fetchPromises = urls.map(async (url) => {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        return { status: OK, url };
      } else {
        log.info(`URL ${url} returned status code ${response.status}`);
        return { status: NOT_OK, url };
      }
    } catch (error) {
      log.error(`Failed to fetch URL ${url}: ${error.message}`);
      return { status: ERR, url };
    }
  });

  const results = await Promise.allSettled(fetchPromises);

  // filter only the fulfilled promises that have a valid URL
  const filtered = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);

  return filtered.reduce((acc, result) => {
    if (result.status === OK) {
      acc.ok.push(result.url);
    } else if (result.status === NOT_OK) {
      acc.notOk.push(result.url);
    } else {
      acc.error.push(result.url);
    }
    return acc;
  }, { ok: [], notOk: [], error: [] });
}

/**
 * Retrieves the base URL pages from the given sitemaps.
 *
 * @async
 * @param {string} baseUrl - The base URL to find pages for.
 * @param {string[]} urls - The list of sitemap URLs to check.
 * @param log
 * @returns {Promise<Object>} - Resolves to an object mapping sitemap URLs to arrays of page URLs.
 */
export async function getBaseUrlPagesFromSitemaps(baseUrl, urls, log) {
  const baseUrlVariant = toggleWWW(baseUrl);
  const contentsCache = {};

  // Prepare all promises for checking each sitemap URL.
  const checkPromises = urls.map(async (url) => {
    const urlData = await checkSitemap(url, log);
    contentsCache[url] = urlData;
    return { url, urlData };
  });

  // Execute all checks concurrently.
  const results = await Promise.all(checkPromises);
  const matchingUrls = [];

  // Process each result.
  results.forEach(({ url, urlData }) => {
    if (urlData.existsAndIsValid) {
      if (urlData.details.isSitemapIndex) {
        // Handle sitemap index by extracting more URLs and recursively check them
        const extractedSitemaps = getSitemapUrlsFromSitemapIndex(urlData.details.sitemapContent);
        extractedSitemaps.forEach((extractedSitemapUrl) => {
          if (!contentsCache[extractedSitemapUrl]) {
            matchingUrls.push(extractedSitemapUrl);
          }
        });
      } else if (url.startsWith(baseUrl) || url.startsWith(baseUrlVariant)) {
        matchingUrls.push(url);
      }
    }
  });

  // Further process matching URLs if necessary
  const response = {};
  const pagesPromises = matchingUrls.map(async (matchingUrl) => {
    // Check if further detailed checks are needed or directly use cached data
    if (!contentsCache[matchingUrl]) {
      contentsCache[matchingUrl] = await checkSitemap(matchingUrl, log);
    }
    const pages = getBaseUrlPagesFromSitemapContents(
      baseUrl,
      contentsCache[matchingUrl].details,
    );

    if (pages.length > 0) {
      response[matchingUrl] = pages;
    }
  });

  // Wait for all pages promises to resolve
  await Promise.all(pagesPromises);

  return response;
}
/**
 * This function is used to find the sitemap of a given URL.
 * It first extracts the domain and protocol from the input URL.
 * If the URL is invalid, it returns an error message.
 * If the URL is valid, it checks the sitemap path in the robots.txt file.
 * Then toggles the input URL with www and filters the sitemap URLs.
 * It then gets the base URL pages from the sitemaps.
 * The extracted paths response length > 0, it returns the success status, log messages, and paths.
 * The extracted paths response length < 0, log messages and returns the failure status and reasons.
 *
 * @param {string} inputUrl - The URL for which to find and validate the sitemap
 * @param log
 * @returns {Promise<{success: boolean, reasons: Array<{value}>, paths?: any}>} result of sitemap
 */
export async function findSitemap(inputUrl, log) {
  const logMessages = [];

  const parsedUrl = extractDomainAndProtocol(inputUrl);
  if (!parsedUrl) {
    logMessages.push({
      value: inputUrl,
      error: ERROR_CODES.INVALID_URL,
    });
    return {
      success: false,
      reasons: logMessages,
    };
  }

  const { protocol, domain } = parsedUrl;
  let sitemapUrls = { ok: [], notOk: [], error: [] };
  try {
    const robotsResult = await checkRobotsForSitemap(protocol, domain, log);
    if (robotsResult.paths.length) {
      sitemapUrls.ok = robotsResult.paths;
    }
  } catch (error) {
    logMessages.push({ value: `${error.message}`, error: ERROR_CODES.FETCH_ERROR });
    // Don't return failure yet, try the fallback URLs
  }

  if (!sitemapUrls.ok.length) {
    const commonSitemapUrls = [`${protocol}://${domain}/sitemap.xml`, `${protocol}://${domain}/sitemap_index.xml`];
    sitemapUrls = await filterValidUrls(commonSitemapUrls, log);
    if (!sitemapUrls.ok.length) {
      logMessages.push({ value: 'Robots.txt', error: ERROR_CODES.NO_SITEMAP_IN_ROBOTS });
      return { success: false, reasons: logMessages, details: sitemapUrls };
    }
  }

  const inputUrlToggledWww = toggleWWW(inputUrl);
  const filteredSitemapUrls = sitemapUrls.ok.filter(
    (path) => path.startsWith(inputUrl) || path.startsWith(inputUrlToggledWww),
  );
  const extractedPaths = await getBaseUrlPagesFromSitemaps(inputUrl, filteredSitemapUrls, log);

  // check if URLs from each sitemap exist and remove entries if none exist
  if (Object.entries(extractedPaths).length > 0) {
    const extractedSitemapUrls = Object.keys(extractedPaths);
    for (const s of extractedSitemapUrls) {
      const urlsToCheck = extractedPaths[s];
      // eslint-disable-next-line no-await-in-loop
      const existingPages = await filterValidUrls(urlsToCheck, log);

      if (existingPages.ok.length === 0) {
        delete extractedPaths[s];
      } else {
        extractedPaths[s] = existingPages.ok;
      }
    }
  }

  if (Object.entries(extractedPaths).length > 0) {
    logMessages.push({ value: 'Sitemaps found and validated successfully.' });
    return {
      success: true,
      reasons: logMessages,
      paths: extractedPaths,
      url: inputUrl,
      details: { ok: undefined, ...sitemapUrls },
    };
  } else {
    logMessages.push({ value: 'No valid paths extracted from sitemaps.', error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED });
    return {
      success: false,
      reasons: logMessages,
      url: inputUrl,
      details: { ok: undefined, ...sitemapUrls },
    };
  }
}

/**
 * Performs an audit for a specified site based on the audit request message.
 *
 * @async
 * @param {string} baseURL - The URL to run the audit against.
 * @param {Object} context - The lambda context object.
 * @returns {Promise<{fullAuditRef: string, auditResult: Object}>}
 */
export async function sitemapAuditRunner(baseURL, context) {
  const { log } = context;
  log.info(`Received sitemap audit request for ${baseURL}`);
  const startTime = process.hrtime();
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

export default new AuditBuilder()
  .withRunner(sitemapAuditRunner)
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL())
    .then((url) => (getUrlWithoutPath(prependSchema(url)))))
  .build();
