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
  extractDomainAndProtocol,
  fetch,
  getBaseUrlPagesFromSitemapContents,
  getSitemapUrlsFromSitemapIndex,
  toggleWWW,
} from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';

export const ERROR_CODES = Object.freeze({
  INVALID_URL: 'INVALID_URL',
  ROBOTS_NOT_FOUND: 'ROBOTS_TXT_NOT_FOUND',
  NO_SITEMAP_IN_ROBOTS: 'NO_SITEMAP_IN_ROBOTS_TXT',
  NO_SITEMAP_FOUND: 'NO_SITEMAP_FOUND',
  NO_PATHS_IN_SITEMAP: 'NO_PATHS_IN_SITEMAP',
  SITEMAP_NOT_FOUND: 'SITEMAP_NOT_FOUND',
  SITEMAP_INDEX_NOT_FOUND: 'SITEMAP_INDEX_NOT_FOUND',
  SITEMAP_EMPTY: 'SITEMAP_EMPTY',
  SITEMAP_FORMAT: 'INVALID_SITEMAP_FORMAT',
  FETCH_ERROR: 'FETCH_ERROR',
});

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

export function isSitemapContentValid(sitemapContent) {
  return sitemapContent.payload.trim().startsWith('<?xml')
      || sitemapContent.type === 'application/xml'
      || sitemapContent.type === 'text/xml'
      || sitemapContent.type === 'text/plain';
}

/**
 * Checks the validity and existence of a sitemap by fetching its content.
 *
 * @async
 * @param {string} sitemapUrl - The URL of the sitemap to check.
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

export async function checkSitemap(sitemapUrl) {
  try {
    const sitemapContent = await fetchContent(sitemapUrl);
    if (!sitemapContent) {
      return {
        existsAndIsValid: false,
        reasons: [ERROR_CODES.SITEMAP_NOT_FOUND, ERROR_CODES.SITEMAP_EMPTY],
      };
    }
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
    return { existsAndIsValid: false, reasons: [ERROR_CODES.FETCH_ERROR] };
  }
}

/**
 * Checks for common sitemap URLs and returns any that exist.
 * @param {Array<string>} urls - Array of URLs to check.
 * @returns {Promise<Array<string>>} - List of sitemap URLs that exist.
 */
async function checkCommonSitemapUrls(urls) {
  const fetchPromises = urls.map(async (url) => {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok ? url : null;
  });
  const results = await Promise.all(fetchPromises);
  return results.filter((url) => url !== null);
}

export async function getBaseUrlPagesFromSitemaps(baseUrl, urls) {
  const baseUrlVariant = toggleWWW(baseUrl);
  const contentsCache = {};

  // Prepare all promises for checking each sitemap URL.
  const checkPromises = urls.map((url) => {
    if (!contentsCache[url]) {
      return checkSitemap(url).then((urlData) => {
        contentsCache[url] = urlData;
        return { url, urlData };
      });
    }
    // If already in cache, skip it.
    return null;
  }).filter((promise) => promise !== null);

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
      contentsCache[matchingUrl] = await checkSitemap(matchingUrl);
    }
    const pages = await getBaseUrlPagesFromSitemapContents(
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
 * @returns {Promise<{success: boolean, reasons: Array<{value}>, paths?: any}>} result of sitemap
 */

export async function findSitemap(inputUrl) {
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
    sitemapUrls = await checkCommonSitemapUrls(commonSitemapUrls);
    if (!sitemapUrls.length) {
      logMessages.push({ value: `No sitemap found in robots.txt or common paths for ${protocol}://${domain}`, error: ERROR_CODES.NO_SITEMAP_IN_ROBOTS });
      return { success: false, reasons: logMessages };
    }
  }

  const inputUrlToggledWww = toggleWWW(inputUrl);
  // todo: with this map of sitemap to list of URLs that have the prefix of the baseURL,
  //  go on an filter out / check out the 200 entries from the top pages
  const filteredSitemapUrls = sitemapUrls.filter(
    (path) => path.startsWith(inputUrl) || path.startsWith(inputUrlToggledWww),
  );

  try {
    const extractedPaths = await getBaseUrlPagesFromSitemaps(inputUrl, filteredSitemapUrls);

    if (Object.entries(extractedPaths).length > 0) {
      logMessages.push({ value: 'Sitemaps found and validated successfully.' });
      return { success: true, reasons: logMessages, paths: extractedPaths };
    } else {
      logMessages.push({ value: 'No valid paths extracted from sitemaps.', error: ERROR_CODES.NO_PATHS_IN_SITEMAP });
      return { success: false, reasons: logMessages };
    }
  } catch (error) {
    logMessages.push({ value: `Error validating sitemap content: ${error.message}`, error: ERROR_CODES.SITEMAP_FORMAT });
    return { success: false, reasons: logMessages };
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
  const auditResult = await findSitemap(baseURL);

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`Sitemap audit for ${baseURL} completed in ${formattedElapsed} seconds`);

  return {
    fullAuditRef: baseURL,
    auditResult,
  };
}

export default new AuditBuilder()
  .withRunner(sitemapAuditRunner)
  .withUrlResolver((site) => site.getBaseURL())
  .build();
