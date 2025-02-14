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
  composeAuditURL,
  isArray,
  prependSchema,
  tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';
import {
  extractDomainAndProtocol,
  getBaseUrlPagesFromSitemapContents,
  getSitemapUrlsFromSitemapIndex,
  getUrlWithoutPath,
  toggleWWW,
} from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';

export const ERROR_CODES = Object.freeze({
  INVALID_URL: 'INVALID URL',
  NO_SITEMAP_IN_ROBOTS: 'NO SITEMAP FOUND IN ROBOTS',
  NO_VALID_PATHS_EXTRACTED: 'NO VALID URLs FOUND IN SITEMAP',
  SITEMAP_NOT_FOUND: 'NO SITEMAP FOUND',
  SITEMAP_EMPTY: 'EMPTY SITEMAP',
  SITEMAP_FORMAT: 'INVALID SITEMAP FORMAT',
  FETCH_ERROR: 'ERROR FETCHING DATA',
});

const AUDIT_TYPE = 'sitemap';

const VALID_MIME_TYPES = Object.freeze([
  'application/xml',
  'text/xml',
  'text/html',
  'text/plain',
]);

// Add new constant for status codes we want to track
const TRACKED_STATUS_CODES = Object.freeze([301, 302, 404]);

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
  const response = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch error for ${targetUrl} Status: ${response.status}`);
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
      const answer = match[1].trim();
      if (answer?.length) {
        sitemapPaths.push(answer);
      }
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
  const validStarts = ['<?xml', '<urlset', '<sitemapindex'];
  return validStarts.some((start) => sitemapContent.payload.trim()
    .startsWith(start))
    || VALID_MIME_TYPES.some((type) => sitemapContent.type.includes(type));
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
 * @returns {Promise<{ok: string[], notOk: string[], networkErrors: string[]}>} -
 * A promise that resolves to a dict of URLs categorized by status.
 */
export async function filterValidUrls(urls) {
  const OK = 0;
  const NOT_OK = 1;
  const NETWORK_ERROR = 2;
  const batchSize = 50;

  const fetchUrl = async (url) => {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });

      if (response.status === 200) {
        return { status: OK, url };
      }

      // if it's a redirect, follow it to get the final URL
      if (response.status === 301 || response.status === 302) {
        const redirectUrl = response.headers.get('location');
        const finalUrl = new URL(redirectUrl, url).href;
        try {
          const redirectResponse = await fetch(finalUrl, {
            method: 'HEAD',
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
          });
          return {
            status: NOT_OK,
            url,
            statusCode: response.status,
            finalUrl: redirectResponse.url,
          };
        } catch {
          return {
            status: NOT_OK,
            url,
            statusCode: response.status,
            finalUrl,
          };
        }
      }

      // Only track specific status codes
      if (TRACKED_STATUS_CODES.includes(response.status)) {
        return { status: NOT_OK, url, statusCode: response.status };
      }

      // Any other status code is treated as OK
      return { status: OK, url };
    } catch {
      return { status: NETWORK_ERROR, url, error: 'NETWORK_ERROR' };
    }
  };

  const fetchPromises = urls.map(fetchUrl);

  const batches = [];
  for (let i = 0; i < fetchPromises.length; i += batchSize) {
    batches.push(fetchPromises.slice(i, i + batchSize));
  }

  const results = [];
  for (const batch of batches) {
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.allSettled(batch);
    for (const result of batchResults) {
      results.push(result);
    }
  }

  // filter only the fulfilled promises that have a valid URL
  const filtered = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);

  return filtered.reduce(
    (acc, result) => {
      if (result.status === OK) {
        acc.ok.push(result.url);
      } else if (result.status === NETWORK_ERROR) {
        acc.networkErrors.push({
          url: result.url,
          error: result.error,
        });
      } else {
        acc.notOk.push({
          url: result.url,
          statusCode: result.statusCode,
          ...(result.finalUrl && { urls_suggested: result.finalUrl }),
        });
      }
      return acc;
    },
    { ok: [], notOk: [], networkErrors: [] },
  );
}

/**
 * Retrieves the base URL pages from the given sitemaps.
 *
 * @async
 * @param {string} baseUrl - The base URL to find pages for.
 * @param {string[]} urls - The list of sitemap URLs to check.
 * @returns {Promise<Object>} - Resolves to an object mapping sitemap URLs to arrays of page URLs.
 */
export async function getBaseUrlPagesFromSitemaps(baseUrl, urls) {
  const baseUrlVariant = toggleWWW(baseUrl);
  const contentsCache = {};

  // Prepare all promises for checking each sitemap URL.
  const checkPromises = urls.map(async (url) => {
    const urlData = await checkSitemap(url);
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
      contentsCache[matchingUrl] = await checkSitemap(matchingUrl);
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
 * @returns {Promise<{success: boolean, reasons: Array<{value}>, paths?: any}>} result of sitemap
 */
export async function findSitemap(inputUrl) {
  const parsedUrl = extractDomainAndProtocol(inputUrl);
  if (!parsedUrl) {
    return {
      success: false,
      reasons: [{ value: inputUrl, error: ERROR_CODES.INVALID_URL }],
    };
  }

  const { protocol, domain } = parsedUrl;
  let sitemapUrls = { ok: [], notOk: [] };
  try {
    const robotsResult = await checkRobotsForSitemap(protocol, domain);
    if (robotsResult && robotsResult.paths && robotsResult.paths.length) {
      sitemapUrls.ok = robotsResult.paths;
    }
  } catch (error) {
    return {
      success: false,
      reasons: [{ value: `${error.message}`, error: ERROR_CODES.FETCH_ERROR }],
    };
  }

  if (!sitemapUrls.ok.length) {
    const commonSitemapUrls = [
      `${protocol}://${domain}/sitemap.xml`,
      `${protocol}://${domain}/sitemap_index.xml`,
    ];
    sitemapUrls = await filterValidUrls(commonSitemapUrls);
    if (!sitemapUrls.ok || !sitemapUrls.ok.length) {
      return {
        success: false,
        reasons: [
          {
            value: `${protocol}://${domain}/robots.txt`,
            error: ERROR_CODES.NO_SITEMAP_IN_ROBOTS,
          },
        ],
        details: {
          issues: sitemapUrls.notOk,
        },
      };
    }
  }

  const inputUrlToggledWww = toggleWWW(inputUrl);
  const filteredSitemapUrls = sitemapUrls.ok.filter(
    (path) => path.startsWith(inputUrl) || path.startsWith(inputUrlToggledWww),
  );
  const extractedPaths = await getBaseUrlPagesFromSitemaps(inputUrl, filteredSitemapUrls);
  const notOkPagesFromSitemap = {};

  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    const extractedSitemapUrls = Object.keys(extractedPaths);
    for (const s of extractedSitemapUrls) {
      const urlsToCheck = extractedPaths[s];
      if (urlsToCheck && urlsToCheck.length) {
        // eslint-disable-next-line no-await-in-loop
        const existingPages = await filterValidUrls(urlsToCheck);

        // Only collect tracked status codes in issues
        if (existingPages.notOk && existingPages.notOk.length > 0) {
          const trackedIssues = existingPages.notOk
            .filter((issue) => TRACKED_STATUS_CODES.includes(issue.statusCode));
          if (trackedIssues.length > 0) {
            notOkPagesFromSitemap[s] = trackedIssues;
          }
        }

        // Consider the sitemap valid if it has any OK URLs or tracked status codes
        const hasValidUrls = existingPages.ok.length > 0
          || existingPages.notOk.some((issue) => [301, 302].includes(issue.statusCode));

        if (!hasValidUrls) {
          delete extractedPaths[s];
        } else {
          extractedPaths[s] = existingPages.ok;
        }
      }
    }
  }

  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    return {
      success: true,
      reasons: [{ value: 'Sitemaps found and checked.' }],
      url: inputUrl,
      details: { issues: notOkPagesFromSitemap },
    };
  } else {
    return {
      success: false,
      reasons: [
        {
          value: filteredSitemapUrls[0],
          error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
        },
      ],
      url: inputUrl,
      details: { issues: notOkPagesFromSitemap },
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
  const startTime = process.hrtime();
  const auditResult = await findSitemap(baseURL);
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
 * Retrieves a list of pages with issues from the audit data.
 *
 * @param {Object} auditData - The audit data containing sitemap and issue details.
 * @returns {Array} An array of objects representing pages with issues.
 *
 * @example
 * const auditData = {
 *   auditResult: {
 *     details: {
 *       issues: {
 *         "https://site.url/sitemap.xml": [
 *           { url: "https://site.url/page1", statusCode: 404 },
 *           { url: "https://site.url/page2" },
 *         ]
 *       }
 *     }
 *   }
 * };
 * const result = getPagesWithIssues(auditData);
 * console.log(result);
 * // Output:
 * // [
 * //   { type: 'url', sitemapUrl: 'https://site.url/sitemap.xml', pageUrl: 'https://site.url/page1', statusCode: 404 },
 * //   { type: 'url', sitemapUrl: 'https://site.url/sitemap.xml', pageUrl: 'https://site.url/page2', statusCode: 500 }
 * // ]
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
      statusCode: page.statusCode ?? 0, // default to 0 if not present
      ...(page.urls_suggested && { urls_suggested: page.urls_suggested }),
    }));
  });
}

/**
 *
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details.
 * @param context - The context object containing the logger
 * @returns {Array} An array of suggestions or error objects.
 */
export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  log.info(`Classifying suggestions for ${JSON.stringify(auditData)}`);

  const { success, reasons } = auditData.auditResult;
  const response = success
    ? []
    : reasons.map(({ error }) => ({ type: 'error', error }));

  const pagesWithIssues = getPagesWithIssues(auditData);
  const suggestions = [...response, ...pagesWithIssues]
    .filter(Boolean)
    .map((issue) => ({
      ...issue,
      recommendedAction: issue.urls_suggested
        ? `use this url instead: ${issue.urls_suggested}`
        : 'Make sure your sitemaps only include URLs that return the 200 (OK) response code.',
    }));

  log.info(`Classified suggestions: ${JSON.stringify(suggestions)}`);
  return {
    ...auditData,
    suggestions,
  };
}

export async function convertToOpportunity(auditUrl, auditData, context) {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  log.info('Converting SITEMAP audit to opportunity...');

  // suggestions are in auditData.suggestions
  if (!auditData.suggestions || !auditData.suggestions.length) {
    log.info('No sitemap issues found, skipping opportunity creation');
    return;
  }

  const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  log.info(`opportunities: ${JSON.stringify(opportunities)}`);

  let opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
  log.info(`opportunity: ${JSON.stringify(opportunity)}`);

  if (!opportunity) {
    const opportunityData = {
      siteId: auditData.siteId,
      auditId: auditData.id,
      type: AUDIT_TYPE,
      origin: 'AUTOMATION',
      title: 'Sitemap issues found',
      runbook:
        'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Sitemap_Runbook.docx?d=w6e82533ac43841949e64d73d6809dff3&csf=1&web=1&e=GDaoxS',
      guidance: {
        steps: [
          'Verify each URL in the sitemap, identifying any that do not return a 200 (OK) status code.',
          'Check RUM data to identify any sitemap pages with unresolved 3xx, 4xx or 5xx status codes – it should be none of them.',
        ],
      },
      tags: ['Traffic Acquisition'],
    };
    try {
      opportunity = await Opportunity.create(opportunityData);
    } catch (e) {
      log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`, e);
      throw e;
    }
  } else {
    opportunity.setAuditId(auditData.id);
    await opportunity.save();
  }

  const buildKey = (data) => (data.type === 'url' ? `${data.sitemapUrl}|${data.pageUrl}` : data.error);

  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions,
    buildKey,
    mapNewSuggestion: (issue) => ({
      opportunityId: opportunity.getId(),
      type: 'REDIRECT_UPDATE',
      rank: 0,
      data: issue,
    }),
    log,
  });
}

export default new AuditBuilder()
  .withRunner(sitemapAuditRunner)
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL())
    .then((url) => getUrlWithoutPath(prependSchema(url))))
  .withPostProcessors([generateSuggestions, convertToOpportunity])
  .build();
