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
  INVALID_URL: 'INVALID_URL',
  NO_SITEMAP_IN_ROBOTS: 'NO_SITEMAP_IN_ROBOTS_TXT',
  NO_PATHS_IN_SITEMAP: 'NO_PATHS_IN_SITEMAP',
  SITEMAP_NOT_FOUND: 'SITEMAP_NOT_FOUND',
  SITEMAP_EMPTY: 'SITEMAP_EMPTY',
  SITEMAP_FORMAT: 'INVALID_SITEMAP_FORMAT',
  FETCH_ERROR: 'FETCH_ERROR',
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
 * @returns {Promise<{
 *    payload: string,
 *    type: string
 * } | null>} - A promise that resolves to the content.
 * of the response as a structure having the contents as the payload string
 * and the content type as the type string if the request was successful, otherwise null.
 * @throws {Error} If the fetch operation fails or the response status is not OK.
 */
export async function fetchContent(targetUrl) {
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch content from ${targetUrl}. Status: ${response.status}`);
  }
  return { payload: await response.text(), type: response.headers.get('content-type') };
}

/**
 * Checks the robots.txt file for a sitemap and returns the sitemap paths if found.
 *
 * @async
 * @param {string} protocol - The protocol (http or https) of the site.
 * @param {string} domain - The domain of the site.
 * @returns {Promise<{ paths: string[], reasons: string[] }>} - A Promise that resolves
 * to an object containing the sitemap paths and reasons for success or failure.
 * The object has the following properties:
 * - paths: An array of strings representing the sitemap paths found in the robots.txt file.
 * - reasons: An array of strings representing the reasons for not finding any sitemap paths.
 * @throws {Error} If the fetch operation fails or the response status is not OK.
 */
export async function checkRobotsForSitemap(protocol, domain) {
  const robotsUrl = `${protocol}://${domain}/robots.txt`;
  const sitemapPaths = [];
  const robotsContent = await fetchContent(robotsUrl);
  if (robotsContent !== null) {
    const sitemapMatches = robotsContent.payload.matchAll(/Sitemap:\s*(.*)/gi);
    for (const match of sitemapMatches) {
      sitemapPaths.push(match[1].trim());
    }
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
 * @returns {boolean} - True if the sitemap content is valid, otherwise false.
 */
export function isSitemapContentValid(sitemapContent) {
  return sitemapContent.payload.trim().startsWith('<?xml')
      || VALID_MIME_TYPES.some((type) => sitemapContent.type.includes(type));
}

/**
 * Checks the validity and existence of a sitemap by fetching its content.
 *
 * @async
 * @param {string} sitemapUrl - The URL of the sitemap to check.
 * @param log
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
    const sitemapContent = await fetchContent(sitemapUrl);
    const isValidFormat = isSitemapContentValid(sitemapContent);
    const isSitemapIndex = isValidFormat && sitemapContent.payload.includes('</sitemapindex>');
    const isText = isValidFormat && sitemapContent.type === 'text/plain';

    if (!isValidFormat) {
      return {
        existsAndIsValid: false,
        reasons: [ERROR_CODES.SITEMAP_FORMAT],
        details: { sitemapContent: {}, isText: false, isSitemapIndex: false },
      };
    }

    log.info(`Processed ${sitemapUrl}: isSitemapIndex=${isSitemapIndex}`);
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
        details: { sitemapContent: {}, isText: false, isSitemapIndex: false },
      };
    }
    return {
      existsAndIsValid: false,
      reasons: [ERROR_CODES.FETCH_ERROR],
      details: { sitemapContent: {}, isText: false, isSitemapIndex: false },
    };
  }
}

/**
 * Filters a list of URLs to return only those that exist.
 *
 * @async
 * @param {string[]} urls - An array of URLs to check.
 * @param {Object} log - The logging object to record information and errors.
 * @returns {Promise<string[]>} - A promise that resolves to an array of URLs that exist.
 */
async function filterValidUrls(urls, log) {
  const fetchPromises = urls.map(async (url) => {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        return url;
      } else {
        log.info(`URL ${url} returned status code ${response.status}`);
        return null;
      }
    } catch (error) {
      log.error(`Failed to fetch URL ${url}: ${error.message}`);
      return null;
    }
  });

  const results = await Promise.allSettled(fetchPromises);

  // filter only the fulfilled promises that have a valid URL
  return results
    .filter((result) => result.status === 'fulfilled' && result.value !== null)
    .map((result) => result.value);
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

  const fillSitemapContents = async (url) => {
    const urlData = await checkSitemap(url, log);
    contentsCache[url] = urlData;
    return { url, urlData };
  };

  // Prepare all promises for checking each sitemap URL.
  const checkPromises = urls.map(fillSitemapContents);

  // Execute all checks concurrently.
  const results = await Promise.all(checkPromises);
  const matchingUrls = [];

  // Process each result.
  for (const { url, urlData } of results) {
    if (urlData.existsAndIsValid) {
      if (urlData.details && urlData.details.isSitemapIndex) {
        log.info(`Sitemap Index found: ${url}`);
        const extractedSitemaps = getSitemapUrlsFromSitemapIndex(urlData.details.sitemapContent);
        log.info(`Extracted Sitemaps from Index: ${extractedSitemaps}`);
        for (const extractedSitemapUrl of extractedSitemaps) {
          if (!contentsCache[extractedSitemapUrl]) {
            matchingUrls.push(extractedSitemapUrl);
            try {
              // eslint-disable-next-line no-await-in-loop
              await fillSitemapContents(extractedSitemapUrl);
            } catch (err) {
              log.error(`Failed to fetch sitemap: ${extractedSitemapUrl}, Error: ${err.message}`);
            }
          }
        }
      } else if (url.startsWith(baseUrl) || url.startsWith(baseUrlVariant)) {
        matchingUrls.push(url);
      }
    }
  }

  log.info(`Matching URLs for further processing: ${matchingUrls}`);

  // Further process matching URLs if necessary
  const response = {};
  const pagesPromises = matchingUrls.map(async (matchingUrl) => {
    if (contentsCache[matchingUrl] && contentsCache[matchingUrl].details) {
      const pages = getBaseUrlPagesFromSitemapContents(
        baseUrl,
        contentsCache[matchingUrl].details,
        log,
      );
      log.info(`Pages extracted from ${matchingUrl}: ${pages}`);

      if (pages.length > 0) {
        response[matchingUrl] = pages;
      }
    }
  });

  await Promise.all(pagesPromises);
  log.info(`Final response object: ${JSON.stringify(response)}`);

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
  let sitemapUrls = [];
  try {
    const robotsResult = await checkRobotsForSitemap(protocol, domain);
    if (robotsResult.paths.length) {
      sitemapUrls = robotsResult.paths;
    }
  } catch (error) {
    logMessages.push({ value: `Error fetching or processing robots.txt: ${error.message}`, error: ERROR_CODES.FETCH_ERROR });
    // Don't return failure yet, try the fallback URLs
  }

  if (!sitemapUrls.length) {
    const commonSitemapUrls = [`${protocol}://${domain}/sitemap.xml`, `${protocol}://${domain}/sitemap_index.xml`];
    sitemapUrls = await filterValidUrls(commonSitemapUrls, log);
    if (!sitemapUrls.length) {
      logMessages.push({ value: `No sitemap found in robots.txt or common paths for ${protocol}://${domain}`, error: ERROR_CODES.NO_SITEMAP_IN_ROBOTS });
      return { success: false, reasons: logMessages };
    }
  }

  const inputUrlToggledWww = toggleWWW(inputUrl);
  const filteredSitemapUrls = sitemapUrls.filter(
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

      if (existingPages.length === 0) {
        delete extractedPaths[s];
      } else {
        extractedPaths[s] = existingPages;
      }
    }
  }

  if (Object.entries(extractedPaths).length > 0) {
    logMessages.push({ value: 'Sitemaps found and validated successfully.' });
    log.info('Extracted Paths:', extractedPaths);
    return {
      success: true, reasons: logMessages, paths: extractedPaths, url: inputUrl,
    };
  } else {
    logMessages.push({ value: 'No valid paths extracted from sitemaps.', error: ERROR_CODES.NO_PATHS_IN_SITEMAP });
    log.info('Failed to extract paths:', extractedPaths);
    return { success: false, reasons: logMessages, url: inputUrl };
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
  // .withPersister(() => {})
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL())
    .then((url) => (getUrlWithoutPath(prependSchema(url)))))
  .build();
