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

import {
  composeAuditURL,
  prependSchema,
  tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';
import { getUrlWithoutPath } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/base-audit.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import {
  ensureFullUrl,
  is404page,
  getStringByteLength,
} from './opportunity-utils.js';

const auditType = 'redirect-chains';

// Misc constants
export const AUDIT_LOGGING_NAME = 'RedC: Redirect Chains'; // used for logging, and in unit tests
const USER_AGENT = 'Spacecat/1.0'; // identify ourselves in all HTTP requests
const KEY_SEPARATOR = '~|~'; // part of building a unique key for each entry in the suggestions
// Constants for redirect count tolerances
const STOP_AFTER_N_REDIRECTS = 5; // per entry tested ... used to prevent infinite redirects
const MAX_REDIRECTS_TO_TOLERATE = 1; // ex: only allow 1 redirect before we consider it a problem
// Constants for projected traffic calculations
const TRAFFIC_LOST_PERCENTAGE = 0.20; // 0.20 == 20% of total issues found
const DOLLAR_PER_TRAFFIC_LOST = 1.00; // 1.00 == $1 per traffic lost
// Constants for size filtering
const MAX_DB_OBJ_SIZE_KB = 400; // 400 KB limit for database object storage
const MAX_DB_OBJ_SIZE_BYTES = MAX_DB_OBJ_SIZE_KB * 1024; // KB in terms of bytes

// ----- support -----------------------------------------------------------------------------------

/**
 * Returns a unique key for the result object.  The result object represents a specific
 * "Source" and "Destination" URL pair.  The generated key handles any duplicates that were found.
 * This key is used to uniquely identify the entry when we run the audit repeatedly.
 *
 * IMPORTANT: This key format must be kept in sync with the backoffice code in
 * experience-success-studio-backoffice/src/.../pages/opportunities/RedirectChainsOpportunity.js
 * in the handleAddSuggestion function. Both must use the same KEY_SEPARATOR and format.
 *
 * @param {Object} result - The result object.
 *                          See the structure returned by `followAnyRedirectForUrl`.
 * @returns {string} The unique key.
 */
function buildUniqueKey(result) {
  // Keep the key format in sync with the BackOffice code.  (See comment above.)
  return `${result.referencedBy}${KEY_SEPARATOR}${result.origSrc}${KEY_SEPARATOR}${result.origDest}${KEY_SEPARATOR}${result.ordinalDuplicate}`;
}

/**
 * Counts the number of redirects starting at the given URL.
 * Does not throw any errors, but will include an error message if one occurs.
 *
 * @param {string} url - The full URL to count redirects for.
 * @param {number} maxRedirects - The maximum number of redirects to count.
 *        Once this limit is reached, the function will stop counting and return this max count.
 *
 * @returns {Object} An object containing the results of attempting to follow redirects:
 *   {
 *    redirectCount: number - The number of redirects,
 *                            or the maximum allowed number of redirects if exceeded
 *    redirectChain: string - The chain of URLs that were redirected to get to the final URL
 *    status: number - The HTTP status code encountered when following redirects.
 *                     If an unknown error occurred, this will be 418.
 *                     A status of 200 means any/all redirects were followed successfully.
 *    error: string - Error message if any occurred, empty otherwise
 *   }
 */
async function countRedirects(url, maxRedirects = STOP_AFTER_N_REDIRECTS) {
  const domain = new URL(url).hostname; // Given: https://www.example.com/subpath --> www.example.com
  let redirectUrl = url;

  let redirectCount = 0;
  let redirectChain = url;
  let errorMsg = ''; // empty string means no error

  try {
    let response = await fetch(redirectUrl, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
      },
    });
    // keep looping while we have redirects to follow, otherwise stop immediately
    while (response.status >= 300 && response.status < 400) {
      // stop if we have exceeded the maximum allowed number of redirects
      if (redirectCount >= maxRedirects) {
        break;
      }
      redirectCount += 1;
      redirectUrl = response.headers.get('location');
      redirectUrl = ensureFullUrl(redirectUrl, domain);
      redirectChain = `${redirectChain} -> ${redirectUrl}`; // ' -> ' is the separator for the chain
      // because we are manually following redirects, we need to wait for each fetch to complete
      // eslint-disable-next-line no-await-in-loop
      response = await fetch(redirectUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
    }
    if (response.status >= 400) {
      errorMsg = `HTTP error ${response.status} for ${redirectUrl}`;
    }
    return {
      redirectCount,
      redirectChain,
      status: response.status,
      error: errorMsg,
    };
  } catch (error) {
    return {
      redirectCount, // incomplete, but we return the count so far
      redirectChain, // incomplete, but we return the chain so far
      status: 418,
      error: `Network error: ${error.message}`,
    };
  }
}

/**
 * For the given URL structure, follows any redirects and returns the resulting statistics.
 * Does not throw any errors, but will include an error message if one occurs.
 *
 * @param urlStruct - The URL structure:
 *  {
 *    referencedBy: string, // ex: https://www.example.com/redirects.json
 *    origSrc: string, // the original source URL found in the /redirects.json file
 *    origDest: string, // the original destination URL found in the /redirects.json file
 *    isDuplicateSrc: boolean, // if true, this is a duplicate source URL
 *    ordinalDuplicate: number, // 0 = unique, 1 = 1st duplicate, 2 = 2nd duplicate, etc.
 *    tooQualified: boolean, // if true, this entry unnecessarily uses fully qualified URLs
 *    hasSameSrcDest: boolean, // if true, the source and destination URLs are the same
 *   }
 * @param fullBaseUrl - Optional. The base URL to use for relative URLs.
 *
 * @returns {Promise<{}>} An object with the following properties:
 *  {
 *    status: number,    // the HTTP status code of the final URL after following redirects
 *    referencedBy: string, // repeated from urlStruct
 *    origSrc: string,      // repeated from urlStruct
 *    origDest: string,     // repeated from urlStruct
 *    fullSrc: string,   // the fully qualified source URL
 *    fullDest: string,  // the fully qualified, and desired, destination URL
 *    fullFinal: string, // the fully qualified final URL after following (or trying to follow) any
 *                          redirects from the source URL
 *    redirected: boolean,
 *    isDuplicateSrc: boolean,  // repeated from urlStruct
 *    ordinalDuplicate: number, // repeated from urlStruct
 *    tooQualified: boolean,    // repeated from urlStruct
 *    hasSameSrcDest boolean,   // repeated from urlStruct
 *    redirectCount: number,
 *    fullFinalMatchesDestUrl: boolean,
 *    redirectChain: string, // can be an empty string, otherwise URL strings separated by ' -> '
 *    error: string,         // can be an empty string
 *  }
 */
async function followAnyRedirectForUrl(urlStruct, fullBaseUrl = '') {
  // ensure full URLs
  const srcUrl = ensureFullUrl(urlStruct.origSrc, fullBaseUrl);
  let fullDest = urlStruct.origDest;
  if (fullDest) {
    fullDest = ensureFullUrl(fullDest, fullBaseUrl);
  } else {
    fullDest = srcUrl;
  }

  // prepare for the result
  const fullSrc = srcUrl;
  let fullFinal = srcUrl; // initialize to our starting URL
  let responseStatus = 200; // assume success
  let redirected = false;
  let redirectCount = 0;
  let fullFinalMatchesDestUrl = false; // technically: unknown
  const {
    referencedBy,
    origSrc,
    origDest,
    isDuplicateSrc,
    ordinalDuplicate, // 0 = unique, 1 = 1st duplicate, 2 = 2nd duplicate, etc.
    tooQualified: isTooQualified,
    hasSameSrcDest,
  } = urlStruct;
  let redirectChain = '';
  let errorMsg = ''; // empty string means no error

  // easy check: we do not waste any additional time with URLs that are duplicates
  if (urlStruct.isDuplicateSrc) {
    return {
      status: responseStatus,
      referencedBy,
      origSrc,
      origDest,
      fullSrc,
      fullDest,
      fullFinal, // meaningless ... since we did not even try to follow any redirects
      redirected, // technically: unknown ... since we did not even try to follow any redirects
      isDuplicateSrc, // true
      ordinalDuplicate, // 1 = 1st duplicate, 2 = 2nd duplicate, etc.
      tooQualified: isTooQualified,
      hasSameSrcDest,
      redirectCount, // technically: unknown
      fullFinalMatchesDestUrl, // technically: unknown
      redirectChain, // technically: unknown
      error: `Duplicated source URL: ${origSrc}`,
    };
  }

  try {
    const response = await fetch(srcUrl, {
      method: 'HEAD',
      redirect: 'follow', // automatically follow any redirects to their completion
      headers: {
        'User-Agent': USER_AGENT,
      },
    });

    // React to the response
    fullFinal = response.url;
    responseStatus = response.status;
    if (responseStatus >= 400) {
      errorMsg = `HTTP error ${responseStatus} for ${fullFinal}`;
    }

    // Calculate redirect count by comparing URLs
    if (response.redirected && (fullSrc !== fullFinal)) {
      // Create URL objects to normalize the URLs for comparison
      const fullSrcObj = new URL(fullSrc);
      const fullFinalObj = new URL(fullFinal);

      // Check if we actually had a redirect
      if (fullSrcObj.href !== fullFinalObj.href) {
        redirected = true;
        const results = await countRedirects(fullSrc);
        redirectCount = results.redirectCount;
        redirectChain = results.redirectChain;
        responseStatus = results.status;
        if (results.error) {
          errorMsg = results.error;
        }
      }
    }

    // Determine if the final URL matches the destination URL
    fullFinalMatchesDestUrl = (fullDest === fullFinal); // simple case
    if (!fullFinalMatchesDestUrl) {
      // Create URL objects to normalize the URLs for comparison
      const fullDestObj = new URL(fullDest);
      const fullFinalObj = new URL(fullFinal);

      // Ensure paths end with trailing slash if they don't have query parameters or hash fragments
      if (!fullDestObj.search && !fullDestObj.hash) {
        fullDestObj.pathname = fullDestObj.pathname.endsWith('/') ? fullDestObj.pathname : `${fullDestObj.pathname}/`;
      }
      if (!fullFinalObj.search && !fullFinalObj.hash) {
        fullFinalObj.pathname = fullFinalObj.pathname.endsWith('/') ? fullFinalObj.pathname : `${fullFinalObj.pathname}/`;
      }

      // Deeper check
      fullFinalMatchesDestUrl = (fullDestObj.href === fullFinalObj.href);
    }

    return {
      status: responseStatus,
      referencedBy,
      origSrc,
      origDest,
      fullSrc,
      fullDest,
      fullFinal,
      redirected,
      isDuplicateSrc, // false
      ordinalDuplicate,
      tooQualified: isTooQualified,
      hasSameSrcDest,
      redirectCount,
      fullFinalMatchesDestUrl,
      redirectChain,
      error: errorMsg,
    };
  } catch (error) {
    return {
      error: error.message,
      status: 418, // technically: unknown
      referencedBy,
      origSrc,
      origDest,
      fullSrc,
      fullDest,
      fullFinal, // technically: unknown
      redirected: false, // technically: unknown
      isDuplicateSrc: false, // false, since we already checked for duplicates
      ordinalDuplicate: 0, // 0 = unique, since we already checked for duplicates
      tooQualified: isTooQualified,
      hasSameSrcDest,
      redirectCount, // technically: unknown
      fullFinalMatchesDestUrl: false, // technically: unknown
      redirectChain, // technically: unknown
    };
  }
}

/**
 * Returns the entire JSON structure that is retrieved from a given URL.
 * If the fetch fails, or if there is no JSON data, returns an empty object.
 *
 * @param {string} url - The URL to fetch JSON data from.
 *                       Ex: https://www.example.com/redirects.json
 * @param {Object} log - The logger object to use for logging.
 * @returns {Promise<Object>} The retrieved JSON data, or an empty object
 */
export async function getJsonData(url, log) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow', // automatically follow any redirects to their completion
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      // if 404, the file does not exist ...
      // ... which just means there is no /redirects.json file. That's A-OK.
      if (response.status !== 404) {
        // otherwise, this is an unexpected error code
        log.error(`${AUDIT_LOGGING_NAME} - Error trying to get ${url} ... HTTP code: ${response.status}`);
      }
      return []; // return an empty array
    }
    return await response.json(); // return the data as JSON
  } catch (error) {
    log.error(`${AUDIT_LOGGING_NAME} - Error in method "getJsonData" for URL: ${url} ...`, error);
    return []; // return an empty array if the fetch fails
  }
}

/**
 * Processes the /redirects.json file and returns a sorted array of all the page URLs referenced.
 *  * Filters out entries to only include those source URLs that start with the audit scope.
 *  * Duplicates are marked.  The last occurrence of a duplicate is kept as the original.
 *  * Marks any entries that are fully qualified (vs relative) as 'tooQualified'.
 *  * Marks any entries that have the same source and destination URLs as 'hasSameSrcDest'.
 *
 * If there is no /redirects.json file, then an empty array is returned.
 *
 * The function tries to find /redirects.json using the full auditScopeUrl (including subpaths).
 * If not found, it falls back to trying the base URL without any subpaths.
 *
 * @param {string} auditScopeUrl - The audit scope URL defining which Source URLs to check.
 *                                 Ex: https://www.example.com or https://www.example.com/fr
 * @param {Object} log - The logger object to use for logging.
 * @returns {Promise<Object[]>} An array of page URLs.  Might be empty.
 */
export async function processRedirectsFile(auditScopeUrl, log) {
  // Try to find /redirects.json at the full audit scope URL first (with subpaths if present)
  // Ensure that the very end of our URL does not have a trailing slash. Defensive coding.
  const cleanedAuditScopeUrl = auditScopeUrl.endsWith('/') ? auditScopeUrl.slice(0, -1) : auditScopeUrl;
  let redirectsUrl = `${cleanedAuditScopeUrl}/redirects.json`;
  log.info(`${AUDIT_LOGGING_NAME} - Looking for redirects file at: ${redirectsUrl}`);
  let redirectsJson = await getJsonData(redirectsUrl, log);
  // If not found and auditScopeUrl has subpaths, try without subpaths as fallback
  if ((!redirectsJson || !redirectsJson.data || !redirectsJson.data.length)) {
    const urlWithoutPath = getUrlWithoutPath(cleanedAuditScopeUrl);
    // Only try this fallback URL is different from the cleanedAuditScopeUrl
    if (urlWithoutPath !== cleanedAuditScopeUrl) {
      redirectsUrl = `${urlWithoutPath}/redirects.json`;
      log.info(`${AUDIT_LOGGING_NAME} - Redirects file not found with subpaths, trying fallback at: ${redirectsUrl}`);
      redirectsJson = await getJsonData(redirectsUrl, log);
    }
  }
  if (!redirectsJson || !redirectsJson.data || !redirectsJson.data.length) {
    log.info(`${AUDIT_LOGGING_NAME} - No redirects file found or file is empty`);
    return []; // no /redirects.json file found anywhere, or there are no entries in the file
  }

  log.info(`${AUDIT_LOGGING_NAME} - Successfully loaded redirects file from: ${redirectsUrl}`);
  // if we only received part of the entries that are available, then ask for the entire file
  const totalEntries = redirectsJson.total;
  if (redirectsJson.data.length < totalEntries) {
    redirectsJson = await getJsonData(`${redirectsUrl}?limit=${totalEntries}`, log);
    if (!redirectsJson || !redirectsJson.data || !redirectsJson.data.length) {
      // not expected, since we previously got the file without a query parameter, but just in case.
      return []; // no /redirects.json file found, or there are no entries in the file
    }
  }
  // sanity check: log if we do not have all the entries
  if (redirectsJson.data.length !== totalEntries) {
    log.warn(`${AUDIT_LOGGING_NAME} - Expected ${totalEntries} entries in ${redirectsUrl}, but found only ${redirectsJson.data.length}.`);
  }

  // Extract the page URLs from the 'data' property of the /redirects.json file.
  // Sort the list by source URL.
  const pageUrls = redirectsJson.data.map((row) => ({
    referencedBy: redirectsUrl,
    origSrc: (row.Source || row.source) ?? '', // try 'Source' first, then 'source' ... or use an empty string if both are undefined
    origDest: (row.Destination || row.destination) ?? '', // likewise for 'Destination' vs 'destination' ... or use an empty string if both are undefined
    isDuplicateSrc: false, // assume this is a unique entry
    ordinalDuplicate: 0, // assume there are no duplicates for this particular "origSrc" URL
    tooQualified: false, // assume this entry correctly uses relative URLs
    hasSameSrcDest: false, // assume this entry does not have the same source and destination URLs
  })).sort((a, b) => a.origSrc.localeCompare(b.origSrc));

  // Now that we have a sorted list, mark any duplicates by comparing adjacent elements.
  // And also test for any other problems with the entries.
  let ordinalDuplicate = 0;
  for (let i = 0; i < pageUrls.length - 1; i += 1) {
    // is this entry a duplicate?
    if (pageUrls[i].origSrc === pageUrls[i + 1].origSrc) {
      // mark the ~first~ occurrence as the duplicate, which is correct for /redirects.json entries
      pageUrls[i].isDuplicateSrc = true;
      ordinalDuplicate += 1; // 1 means 1st in the set, 2 means 2nd, etc.
      pageUrls[i].ordinalDuplicate = ordinalDuplicate;
    } else {
      ordinalDuplicate = 0; // reset for some future set of duplicate source URLs
    }
    // is this entry needlessly fully qualified?
    if (pageUrls[i].origSrc.startsWith(cleanedAuditScopeUrl)
      || pageUrls[i].origDest.startsWith(cleanedAuditScopeUrl)) {
      pageUrls[i].tooQualified = true;
    }
    // does this entry have the same source and destination URLs?
    if (pageUrls[i].origSrc === pageUrls[i].origDest) {
      pageUrls[i].hasSameSrcDest = true;
    }
  }
  // special case: inspect the ~last~ entry for any problems
  //   ^^^ This is a needed due to the way we iterated over the list looking for duplicates:
  //   we did ~not~ inspect the last entry for ~additional~ problems.
  if (pageUrls[pageUrls.length - 1].origSrc.startsWith(cleanedAuditScopeUrl)
    || pageUrls[pageUrls.length - 1].origDest.startsWith(cleanedAuditScopeUrl)) {
    pageUrls[pageUrls.length - 1].tooQualified = true; // "too qualified"
  }
  if (pageUrls[pageUrls.length - 1].origSrc === pageUrls[pageUrls.length - 1].origDest) {
    pageUrls[pageUrls.length - 1].hasSameSrcDest = true; // "has same source and destination URLs"
  }

  // Filter pageUrls to only include entries that match the audit scope
  const parsedAuditScopeUrl = new URL(cleanedAuditScopeUrl);
  const scopePath = parsedAuditScopeUrl.pathname;
  const hasScopePath = scopePath && scopePath !== '/';

  // If auditScopeUrl has no subpath, return all pageUrls
  if (!hasScopePath) {
    log.info(`${AUDIT_LOGGING_NAME} - No subpath in audit scope URL, returning all ${pageUrls.length} entries`);
    return pageUrls;
  }

  // Filter to only include entries whose origSrc starts with the scope path
  // Ensure we match with a trailing slash to avoid false positives (e.g., /fr/ not /french)
  const scopePathWithSlash = `${scopePath}/`;
  const auditScopeUrlWithSlash = `${cleanedAuditScopeUrl}/`;

  const filteredPageUrls = pageUrls.filter((entry) => {
    const { origSrc } = entry;

    // Check if origSrc is a relative path starting with the scope path
    if (origSrc.startsWith(scopePathWithSlash)) {
      return true;
    }

    // Check if origSrc is a fully qualified URL containing the audit scope URL
    if (origSrc.startsWith('http://') || origSrc.startsWith('https://')) {
      // For fully qualified URLs, check if they start with the full auditScopeUrl
      return origSrc.startsWith(auditScopeUrlWithSlash);
    }

    return false;
  });

  log.info(`${AUDIT_LOGGING_NAME} - Filtered entries from ${pageUrls.length} to ${filteredPageUrls.length} based on audit scope: ${scopePathWithSlash}`);
  return filteredPageUrls;
}

/**
 * Processes an array of page URL objects, following any redirects for each URL and returning
 * the results.  It uses controlled concurrency to limit the number of concurrent requests to a
 * specified maximum. The results are returned as an array of objects, each containing the
 * final status and other details about the URL after following redirects.
 *
 * Results for each entry is returned; there is no filtering of results.
 *
 * @param {Object[]} pageUrls - An array of page URL objects to process.
 *                              See the structure returned by `processRedirectsFile`.
 * @param {string} fullBaseUrl - The base URL to use for relative URLs.
 * @param {Object} log - The logger object to use for logging.
 * @param {number} maxConcurrency - The maximum number of concurrent requests to process.
 *
 * @returns {Promise<Object[]>} An array of results for each processed page URL.
 *  Each result object has the structure as returned by `followAnyRedirectForUrl`
 */
export async function processEntriesInParallel(
  pageUrls,
  fullBaseUrl,
  log,
  maxConcurrency = 1000,
) {
  const BATCH_SIZE = maxConcurrency; // processing takes about 0.015 seconds per entry
  const allResults = [];

  // Process in batches to control concurrency
  for (let i = 0; i < pageUrls.length; i += BATCH_SIZE) {
    const batch = pageUrls.slice(i, i + BATCH_SIZE);

    // Process current batch in parallel
    const batchPromises = batch.map(async (row) => followAnyRedirectForUrl(row, fullBaseUrl));

    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults);

    // Log progress
    log.info(`${AUDIT_LOGGING_NAME} - Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pageUrls.length / BATCH_SIZE)}`);
  }

  return allResults;
}

/**
 * Analyzes the results of the redirects audit and counts various issues.
 *
 * @param {Object[]} results - THe results array from processing the page URLs.
 *                             Each row of this array is called an "entry".
 *                             See the structure returned by `followAnyRedirectForUrl`.
 * @returns {{
 *   counts: {
 *    countDuplicateSourceUrls: number,
 *    countTooQualifiedUrls: number,
 *    countHasSameSrcDest: number,
 *    countTooManyRedirects: number,
 *    countHttpErrors: number,              // HTTP error codes 400+
 *    countNotMatchDestinationUrl: number,
 *    countTotalEntriesWithProblems: number // note that a single entry can have multiple problems
 *    },
 *   entriesWithProblems: *[]               // the array of entries that have problems
 * }}
 */
export function analyzeResults(results) {
  const counts = {
    countDuplicateSourceUrls: 0,
    countTooQualifiedUrls: 0,
    countHasSameSrcDest: 0,
    countTooManyRedirects: 0,
    countHttpErrors: 0,
    countNotMatchDestinationUrl: 0,
    countTotalEntriesWithProblems: 0,
  };

  const entriesWithProblems = [];

  for (const result of results) {
    let entryHasProblems = false;

    if (result.isDuplicateSrc) {
      counts.countDuplicateSourceUrls += 1;
      entryHasProblems = true;
    }

    if (result.tooQualified) {
      counts.countTooQualifiedUrls += 1;
      entryHasProblems = true;
    }

    if (result.hasSameSrcDest) {
      counts.countHasSameSrcDest += 1;
      entryHasProblems = true;
    }

    if (result.redirectCount > MAX_REDIRECTS_TO_TOLERATE) {
      counts.countTooManyRedirects += 1;
      entryHasProblems = true;
    }

    if (result.status >= 400) {
      counts.countHttpErrors += 1;
      entryHasProblems = true;
    }

    if (!result.fullFinalMatchesDestUrl) {
      counts.countNotMatchDestinationUrl += 1;
      entryHasProblems = true;
    }

    if (entryHasProblems) {
      entriesWithProblems.push(result);
      counts.countTotalEntriesWithProblems += 1;
    }
  }

  return { counts, entriesWithProblems };
}

/**
 * Categorizes an issue based on the priority order from the `getSuggestedFix` function.
 * Although any 1 issue could fit into multiple categories, we only assign it to one category.
 * (This is also the philosophy of the `getSuggestedFix` function.)
 *
 * @param {Object} issue - The issue object to categorize
 * @returns {string} The category name
 */
function categorizeIssue(issue) {
  if (issue.isDuplicateSrc) {
    return 'duplicate-src';
  }
  if (issue.tooQualified) {
    return 'too-qualified';
  }
  if (issue.hasSameSrcDest) {
    return 'same-src-dest';
  }
  if (issue.status >= 400) {
    return 'http-errors';
  }
  if (!issue.fullFinalMatchesDestUrl) {
    return 'final-mismatch';
  }
  if (issue.redirectCount > MAX_REDIRECTS_TO_TOLERATE) {
    return 'too-many-redirects';
  }
  return 'unknown';
}

/**
 * Filters issues to fit within the maximum size limit for the database space constraint.
 * Maintains a fair distribution across the issues' categories.
 * Uses a conservative size estimate to ensure this filtered set does not exceed the limit.
 *
 * @param {Object[]} issues - Array of issues to filter
 * @param {Object} log - Logger object
 * @returns {Object} Object containing filteredIssues and wasReduced flag
 */
export function filterIssuesToFitIntoSpace(issues, log) {
  // Sanity check
  if (!issues || issues.length === 0) {
    return { filteredIssues: [], wasReduced: false };
  }

  // Calculate total size of all issues
  const totalSize = issues.reduce((sum, issue) => {
    const issueJson = JSON.stringify(issue);
    return sum + getStringByteLength(issueJson);
  }, 0);

  // If all issues fit within the limit, return them all
  if (totalSize <= MAX_DB_OBJ_SIZE_BYTES) {
    log.info(`${AUDIT_LOGGING_NAME} - All ${issues.length} issues fit within ${MAX_DB_OBJ_SIZE_BYTES / 1024} KB limit (${Math.round(totalSize / 1024)} KB used)`);
    return { filteredIssues: issues, wasReduced: false };
  }

  log.info(`${AUDIT_LOGGING_NAME} - Total size of all the issues exceed space limit (${Math.round(totalSize / 1024)} KB > ${MAX_DB_OBJ_SIZE_BYTES / 1024} KB) ... filtering issues to fit within limit`);

  // Categorize issues.  Later we will re-create these issues into specific suggestions.
  const categorizedIssues = {
    'duplicate-src': [], // 'duplicate-src'
    'too-qualified': [], // 'too-qualified'
    'same-src-dest': [], // 'same-src-dest'
    'http-errors': [], // 'manual-check'
    'final-mismatch': [], // '404-page', 'src-is-final', 'final-mismatch'
    'too-many-redirects': [], // 'msx-redirects-exceeded', 'high-redirect-count'
  };
  issues.forEach((issue) => {
    const category = categorizeIssue(issue);
    if (categorizedIssues[category]) {
      categorizedIssues[category].push(issue);
    }
  });

  // Based on all the issues, calculate a conservative size to represent a randomly large issue
  const issueSizes = issues.map((issue) => {
    const issueJson = JSON.stringify(issue);
    return getStringByteLength(issueJson);
  });
  const averageSize = issueSizes.reduce((sum, size) => sum + size, 0) / issueSizes.length;
  const largestSize = Math.max(...issueSizes);
  const conservativeSizeEstimate = Math.max(averageSize, largestSize * 0.8); // 80% of max size

  // Calculate how many issues can fit into the database space
  const maxIssues = Math.floor(MAX_DB_OBJ_SIZE_BYTES / conservativeSizeEstimate);

  // Determine the set of categories that have at least one issue in them
  // eslint-disable-next-line max-len,no-shadow
  const nonEmptyCategories = Object.entries(categorizedIssues).filter(([_, issues]) => issues.length > 0);
  if (nonEmptyCategories.length === 0) {
    return { filteredIssues: [], wasReduced: true }; // "should never happen"
  }

  // Distribute issues fairly across categories
  const issuesPerCategory = Math.floor(maxIssues / nonEmptyCategories.length);
  const remainingSlots = maxIssues % nonEmptyCategories.length;

  const filteredIssues = [];
  let totalFiltered = 0;

  nonEmptyCategories.forEach(([category, categoryIssues], index) => {
    const slotsForThisCategory = issuesPerCategory + (index < remainingSlots ? 1 : 0);
    const issuesToTake = Math.min(slotsForThisCategory, categoryIssues.length);

    // Take the first N issues from this category
    const selectedIssues = categoryIssues.slice(0, issuesToTake);
    filteredIssues.push(...selectedIssues);
    totalFiltered += issuesToTake;

    log.info(`${AUDIT_LOGGING_NAME} - category '${category}' - selected ${issuesToTake} out of ${categoryIssues.length} issues`);
  });

  // Log the stats about the size of the filtered set
  const filteredSize = filteredIssues.reduce((sum, issue) => {
    const issueJson = JSON.stringify(issue);
    return sum + getStringByteLength(issueJson);
  }, 0);
  log.info(`${AUDIT_LOGGING_NAME} - Filtered ${totalFiltered} issues (${Math.round(filteredSize / 1024)} KB) from original ${issues.length} issues (${Math.round(totalSize / 1024)} KB)`);

  return { filteredIssues, wasReduced: true };
}

/**
 * Processes each entry in the given array of page URLs.
 * Returns statistical counts and all affected entries.
 *
 * @param {Object[]} pageUrls - An array of page URL objects to process.
 *                              See the structure returned by `processRedirectsFile`.
 * @param {string} fullBaseUrl - The base URL to use for relative URLs.
 * @param {Object} log - The logger object to use for logging.
 *
 * @returns {Promise<{counts: {}, entriesWithProblems: *[]}>}
 *           See the structures returned by `analyzeResults` for details.
 */
async function processEntries(pageUrls, fullBaseUrl, log) {
  // Step 1: Process all HTTP requests in parallel (the slow part)
  const results = await processEntriesInParallel(pageUrls, fullBaseUrl, log);

  // Step 2: Analyze results synchronously (the fast part)
  const { counts, entriesWithProblems } = analyzeResults(results);

  return { counts, entriesWithProblems };
}

/**
 * Calculates projected traffic metrics for redirect chains based on the number of issues found
 *
 * @param {number} totalIssues - The total number of redirect chains issues found
 * @returns {Object} Object containing projectedTrafficLost and projectedTrafficValue
 */
function calculateProjectedMetrics(totalIssues) {
  // Calculate projected traffic lost as a percentage of total issues.  Ex: 20% of total issues
  // Use Math.round for typical rounding (0.5 rounds up, less than 0.5 truncates)
  const projectedTrafficLost = Math.round(
    totalIssues * TRAFFIC_LOST_PERCENTAGE,
  );

  // Calculate projected traffic value as a dollar amount per projected traffic lost. Ex: $1 per
  // Use Math.round to ensure whole numbers
  const projectedTrafficValue = Math.round(
    projectedTrafficLost * DOLLAR_PER_TRAFFIC_LOST,
  );

  return {
    projectedTrafficLost,
    projectedTrafficValue,
  };
}

// ----- URL resolution  ---------------------------------------------------------------------------

/**
 * Determines the audit scope URL by following redirects and finding the longest common path prefix.
 * This URL defines which Source URLs in /redirects.json should be checked during the audit.
 * The function intelligently handles URL paths by finding the longest common prefix path:
 * - If the original baseUrl has NO subpath, strips all paths from the resolved URL
 * - If the original baseUrl HAS a subpath, keeps as many matching path segments as possible
 *
 * Examples:
 * - https://bulk.com → www.bulk.com/uk → returns https://www.bulk.com (strips all paths)
 * - https://bulk.com/fr → www.bulk.com/fr → returns https://www.bulk.com/fr (all segments match)
 * - https://kpmg.com → kpmg.com/xx/en.html → returns https://kpmg.com (strips all paths)
 * - https://realmadrid.com/area-vip → www.realmadrid.com/sites/area-vip → returns https://www.realmadrid.com (no matching segments)
 * - https://westjet.com/en-ca/book-trip/flights → www.westjet.com/en-ca/best-of-travel → returns https://www.westjet.com/en-ca (first segment matches)
 *
 * @param {string} baseUrl - The site's original base URL from site.getBaseURL()
 * @returns {Promise<string>} The audit scope URL that defines which Source URLs to check
 */
export async function determineAuditScope(baseUrl) {
  // Parse the original base URL to extract its path
  const originalUrl = new URL(prependSchema(baseUrl));
  const originalPath = originalUrl.pathname;
  const hasOriginalPath = originalPath && originalPath !== '/';

  // Get the audit scope URL by following redirects
  const auditScopeUrl = await composeAuditURL(baseUrl); // ex: www.example.com/fr
  const auditScopeUrlWithSchema = prependSchema(auditScopeUrl); // ex: https://www.example.com/fr
  const parsedAuditScopeUrl = new URL(auditScopeUrlWithSchema);

  // If the original URL has no subpath, strip all paths from the audit scope URL
  if (!hasOriginalPath) {
    return getUrlWithoutPath(auditScopeUrlWithSchema); // ex: https://www.example.com:4321
  }

  // Since the original URL has a subpath, find the longest common prefix path
  const auditScopePath = parsedAuditScopeUrl.pathname;

  // Split paths into segments (filter out empty strings from leading/trailing slashes)
  const originalSegments = originalPath.split('/').filter((seg) => seg.length > 0);
  const scopedSegments = auditScopePath.split('/').filter((seg) => seg.length > 0);

  // Find the longest common prefix by comparing segments from the beginning
  const commonSegments = [];
  const maxDepthAvailable = Math.min(originalSegments.length, scopedSegments.length);

  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < maxDepthAvailable; i++) {
    if (originalSegments[i] === scopedSegments[i]) {
      commonSegments.push(originalSegments[i]);
    } else {
      // Stop at the first non-matching segment
      break;
    }
  }

  // If we found matching segments, construct the path with them
  if (commonSegments.length > 0) {
    const commonPath = `/${commonSegments.join('/')}`;
    return `${parsedAuditScopeUrl.protocol}//${parsedAuditScopeUrl.host}${commonPath}`;
  }

  // No matching segments, strip all paths
  return getUrlWithoutPath(auditScopeUrlWithSchema);
}

// ----- audit runner  -----------------------------------------------------------------------------

/**
 * Runs the audit for the /redirects.json file.
 * @param baseUrl - The base URL from site.getBaseURL()
 * @param context - The audit context containing logger, data access, etc.
 * @returns {Promise<{
 *    fullAuditRef,
 *    auditResult: {
 *      success: boolean,
 *      reasons: [{value: string}],
 *      details: {issues: *[]},      // see `followAnyRedirectForUrl` for structure
 *      auditScopeUrl: string,
 *    }
 *  }>}
 */
export async function redirectsAuditRunner(baseUrl, context) {
  // setup
  const { log } = context;
  const startTime = process.hrtime(); // start timer
  const auditResult = {
    success: true, // default
    reasons: [{ value: 'File /redirects.json checked.' }],
    details: { issues: [] },
    auditScopeUrl: baseUrl, // use the baseUrl as the fallback URL for the audit's scope
  };
  log.info(`${AUDIT_LOGGING_NAME} - Original base URL: ${baseUrl}`);

  // Determine the audit scope URL to establish which Source URLs to check
  let auditScopeUrl;
  try {
    auditScopeUrl = await determineAuditScope(baseUrl);
    auditResult.auditScopeUrl = auditScopeUrl; // update with actual audit scope URL
    log.info(`${AUDIT_LOGGING_NAME} - Audit's scope URL determined: ${auditScopeUrl}`);
  } catch (error) {
    log.error(`${AUDIT_LOGGING_NAME} - Failed to determine the audit scope URL: ${error.message}`);
    auditResult.success = false;
    auditResult.reasons = [{ value: baseUrl, error: 'INVALID URL' }];
    return {
      fullAuditRef: baseUrl,
      auditResult,
    };
  }

  // get a pre-processed array of page URLs from the /redirects.json file
  log.info(`${AUDIT_LOGGING_NAME} - STARTED running audit worker for /redirects.json for ${auditScopeUrl}`);
  const pageUrls = await processRedirectsFile(auditScopeUrl, log);

  // process the entries & remember the results
  const fullBaseUrl = getUrlWithoutPath(auditScopeUrl);
  log.info(`${AUDIT_LOGGING_NAME} - Using the fullBaseUrl := ${fullBaseUrl}`); // TODO: !!REMOVE!!
  const { counts, entriesWithProblems } = await processEntries(pageUrls, fullBaseUrl, log);
  if (counts.countTotalEntriesWithProblems > 0) {
    // Filter issues to fit within size limit
    const { filteredIssues } = filterIssuesToFitIntoSpace(entriesWithProblems, log);
    auditResult.details.issues = filteredIssues;
    log.warn(`${AUDIT_LOGGING_NAME} - Issues could be reduced from ${entriesWithProblems.length} to ${filteredIssues.length} to fit within space limit`);
  }

  // end timer
  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  // echo the stats
  log.info(`${AUDIT_LOGGING_NAME} - STATS: /redirects.json has total number of entries checked:       ${pageUrls.length}`);
  log.info(`${AUDIT_LOGGING_NAME} - STATS: /redirects.json has total number of entries with problems: ${counts.countTotalEntriesWithProblems}`);
  if (counts.countTotalEntriesWithProblems > 0) {
    log.info(`${AUDIT_LOGGING_NAME} - STATS: /redirects.json .. duplicated Source URLs:       ${counts.countDuplicateSourceUrls}`);
    log.info(`${AUDIT_LOGGING_NAME} - STATS: /redirects.json .. too qualified URLs:           ${counts.countTooQualifiedUrls}`);
    log.info(`${AUDIT_LOGGING_NAME} - STATS: /redirects.json .. same Source and Dest URLs:    ${counts.countHasSameSrcDest}`);
    log.info(`${AUDIT_LOGGING_NAME} - STATS: /redirects.json .. resulted in HTTP error:       ${counts.countHttpErrors}`);
    log.info(`${AUDIT_LOGGING_NAME} - STATS: /redirects.json .. Final URL not match Dest URL: ${counts.countNotMatchDestinationUrl}`);
    log.info(`${AUDIT_LOGGING_NAME} - STATS: /redirects.json .. with too many redirects:      ${counts.countTooManyRedirects}`);
  }

  log.info(`${AUDIT_LOGGING_NAME} - DONE with audit worker for processing /redirects.json for ${auditScopeUrl}. Completed in ${formattedElapsed} seconds.`);
  return {
    fullAuditRef: auditScopeUrl,
    auditResult,
  };
}

/**
 * Returns an object with the suggested fix for the given result object.
 * @param {Object} result - The result object.
 *                          See the structure returned by `followAnyRedirectForUrl`.
 * @returns {Object} The suggested fix object with the following properties:
 *  {
 *    fix: string,      // the human-readable suggested fix, written for en_US locale
 *    finalUrl: string, // (in the style of the source URL)
 *    fixType: string,  // kabob-case tokens ...
 *       // {'duplicate-src', 'too-qualified', 'same-src-dest', 'manual-check', 'final-mismatch',
 *       //  'max-redirects-exceeded', 'high-redirect-count', '404-page', 'src-is-final', 'unknown'}
 *    canApplyFixAutomatically: boolean, // true if the fix could be applied automatically
 *  }
 */
export function getSuggestedFix(result) {
  // sanity check
  if (!result || (typeof result === 'object' && Object.keys(result).length === 0)) {
    return null;
  }

  // prep
  const baseUrl = new URL(result.referencedBy).origin;
  let finalUrl = result.fullFinal;
  if (result.fullDest.startsWith(baseUrl) // if the fully qualified destination URL has the base URL
    && finalUrl.startsWith(baseUrl) // and the fully qualified final URL also has the base URL
    && !result.origDest.startsWith(baseUrl)) { // but the original destination URL does not ...
    // remove the base URL from the final URL so it is in the spirit of the original destination URL
    finalUrl = finalUrl.replace(baseUrl, '');
  }
  const redirectChain = result.redirectChain || ''; // can be an empty string
  const errorMsg = result.error || '(not specified)'; // can be a default string

  const fixForUnknown = `No suggested fix available for this entry. Error message: ${errorMsg}`; // not expected to be returned
  const fixForDuplicate = 'Remove this entry since the same Source URL is used later in the redirects file.';
  const fixForTooQualified = `Update the Source URL and/or the Destination URL to use relative paths by removing the base URL: ${baseUrl}`;
  const fixForHasSameSrcDest = 'Remove this entry since the Source URL is the same as the Destination URL.';
  const fixForManualCheck = `Check the URL: ${finalUrl} since it resulted in an error code. Maybe remove the entry from the redirects file. Error message: ${errorMsg}`;
  const fixFor404page = 'Update, or remove, this entry since the Source URL redirects to a 404 page.';
  const fixForSrcRedirectsToSelf = 'Remove this entry since the Source URL redirects to itself.';
  const fixForFinalMismatch = 'Replace the Destination URL with the Final URL, since the Source URL actually redirects to the Final URL.';
  const fixForMaxRedirectsExceeded = `Redesign the redirects that start from the Source URL. An excessive number of redirects were encountered. Partial redirect chain is: ${redirectChain}`;
  const fixForHighRedirectCount = `Reduce the redirects that start from the Source URL. There are too many redirects to get to the Destination URL. Redirect chain is: ${redirectChain}`;

  // determine the suggested fix (or leave as the unexpected 'unknown')
  let fix = fixForUnknown;
  let fixType = 'unknown';
  let canApplyFixAutomatically = false; // default is to manually apply the suggested fix

  if (result.isDuplicateSrc) {
    fix = fixForDuplicate;
    fixType = 'duplicate-src';
    canApplyFixAutomatically = true;
  } else if (result.tooQualified) {
    fix = fixForTooQualified;
    fixType = 'too-qualified';
    canApplyFixAutomatically = true;
  } else if (result.hasSameSrcDest) {
    fix = fixForHasSameSrcDest;
    fixType = 'same-src-dest';
    canApplyFixAutomatically = true;
  } else if (result.status >= 400) {
    fix = fixForManualCheck;
    fixType = 'manual-check';
  } else if (!result.fullFinalMatchesDestUrl) {
    if (is404page(result.fullFinal)) {
      fix = fixFor404page;
      fixType = '404-page';
    } else if (result.fullFinal === result.fullSrc) {
      fix = fixForSrcRedirectsToSelf;
      fixType = 'src-is-final';
      canApplyFixAutomatically = true;
    } else {
      fix = fixForFinalMismatch;
      fixType = 'final-mismatch';
      canApplyFixAutomatically = true;
    }
  } else if (result.redirectCount >= STOP_AFTER_N_REDIRECTS) {
    fix = fixForMaxRedirectsExceeded;
    fixType = 'max-redirects-exceeded';
  } else if (result.redirectCount > MAX_REDIRECTS_TO_TOLERATE) {
    // although the "final" URL matched the expected "destination" URL,
    // there were too many redirects in between.
    fix = fixForHighRedirectCount;
    fixType = 'high-redirect-count';
  }
  return {
    fix,
    fixType,
    canApplyFixAutomatically,
    finalUrl, // the final URL we redirected to ... in the style of the source URL
  };
}

/**
 * For each entry in the audit data, generates a suggested fix based on the issues found for
 * that entry.  Note that some entries may be skipped based on certain conditions.
 *
 * @param auditUrl - The URL of the audit (original base URL from site.getBaseURL())
 * @param auditData - The audit data containing the audit result and additional details
 * @param context - The context object containing the logger
 * @returns {Object} The new "auditData" object containing an array of suggestions.
 */
export function generateSuggestedFixes(auditUrl, auditData, context) {
  const { log } = context;

  // Use the audit scope URL from the audit result
  const auditScopeUrl = auditData?.auditResult?.auditScopeUrl || auditUrl;
  log.info(`${AUDIT_LOGGING_NAME} - Using audit scope URL: ${auditScopeUrl}`);

  const suggestedFixes = []; // {key: '...', fix: '...'}
  const entriesWithIssues = auditData?.auditResult?.details?.issues ?? [];
  let skippedEntriesCount = 0; // Counter for skipped entries

  log.info(`${AUDIT_LOGGING_NAME} - Generating suggestions for URL ${auditScopeUrl} which has ${entriesWithIssues.length} affected entries.`);
  log.debug(`${AUDIT_LOGGING_NAME} - Audit data: ${JSON.stringify(auditData)}`);

  for (const row of entriesWithIssues) {
    const suggestedFixResult = getSuggestedFix(row);
    if (suggestedFixResult) {
      // Check for conditions that should exclude suggestions from being created
      const shouldSkipSuggestion = (
        // Network error case: HTTP 418 + "unexpected end of file" + source equals final
        (row.status === 418 // our internal HTTP error code for unexpected HTTP errors
         && row.error === 'unexpected end of file' // redirects could not be followed
         && row.fullSrc === row.fullFinal)
        // Add any future conditions like: (currentConditionAbove) || (someNewCondition)
      );
      if (shouldSkipSuggestion) {
        skippedEntriesCount += 1;
        log.debug(`${AUDIT_LOGGING_NAME} - Skipping suggestion for network error case: ${row.origSrc} -> ${row.origDest}`);
        // eslint-disable-next-line no-continue
        continue; // Skip this suggestion entirely
      }

      // IMPORTANT: The data format must be kept in sync with the backoffice code in
      // experience-success-studio-backoffice/src/.../opportunities/RedirectChainsOpportunity.js
      // Examples: when creating a new suggestion, and also when updating an existing suggestion.
      suggestedFixes.push({
        key: buildUniqueKey(row), // string

        // {'duplicate-src', 'too-qualified', 'same-src-dest', 'manual-check', 'final-mismatch',
        //  'max-redirects-exceeded', 'high-redirect-count', '404-page', 'src-is-final', 'unknown'}
        fixType: suggestedFixResult.fixType, // string: kabob-case tokens ... (see comments above)

        fix: suggestedFixResult.fix, // string: en_US locale. Used as a human-readable example.
        canApplyFixAutomatically: suggestedFixResult.canApplyFixAutomatically, // boolean
        redirectsFile: row.referencedBy, // string
        redirectCount: row.redirectCount, // int
        httpStatusCode: row.status, // int
        sourceUrl: row.origSrc, // string: the original source URL found in the redirects file
        sourceUrlFull: row.fullSrc, // string: fully qualified URL
        destinationUrl: row.origDest, // string: the original dest URL found in the redirects file
        destinationUrlFull: row.fullDest, // string: fully qualified URL
        finalUrl: suggestedFixResult.finalUrl, // string: (in the style of the source URL)
        finalUrlFull: row.fullFinal, // string: fully qualified URL
        // eslint-disable-next-line max-len
        ordinalDuplicate: row.ordinalDuplicate, // int: 0 = unique, 1 = 1st duplicate, 2 = 2nd duplicate, etc.
        // eslint-disable-next-line max-len
        redirectChain: row.redirectChain || row.fullSrc, // string: 1+ full URL strings separated by ' -> '
        // eslint-disable-next-line max-len
        errorMsg: row.error || '', // string: empty if no error (note: API returns null for empty strings), otherwise the error message
      });
    }
  }
  log.info(`${AUDIT_LOGGING_NAME} - Skipped ${skippedEntriesCount} entries due to exclusion criteria.`);
  log.info(`${AUDIT_LOGGING_NAME} - Generated ${suggestedFixes.length} suggested fixes.`);
  log.debug(`${AUDIT_LOGGING_NAME} - Suggested fixes: ${JSON.stringify(suggestedFixes)}`);

  // Calculate and log the size of suggestions
  const suggestionsJson = JSON.stringify(suggestedFixes);
  const sizeInBytes = getStringByteLength(suggestionsJson);
  const sizeInKB = Math.max(1, Math.round(sizeInBytes / 1024));

  log.info(`${AUDIT_LOGGING_NAME} - Total size of suggestions (rounded up): ${sizeInKB} KB`);

  // Analyze individual suggestion sizes for debugging
  if (suggestedFixes && suggestedFixes.length > 0) {
    const suggestionSizes = suggestedFixes.map((suggestion) => {
      const suggestionJson = JSON.stringify(suggestion);
      return getStringByteLength(suggestionJson);
    });

    const nonZeroSizes = suggestionSizes.filter((size) => size > 0);
    const smallestSize = nonZeroSizes.length > 0 ? Math.min(...nonZeroSizes) : 0;
    const largestSize = Math.max(...suggestionSizes);
    // eslint-disable-next-line max-len
    const averageSize = suggestionSizes.reduce((sum, size) => sum + size, 0) / suggestionSizes.length;
    const averageSizeKB = averageSize / 1024;
    const maxNumberFitInDB = Math.floor(MAX_DB_OBJ_SIZE_KB / averageSizeKB);

    log.info(`${AUDIT_LOGGING_NAME} - Suggestion size analysis: smallest non-zero size = ${smallestSize} bytes, average size = ${Math.round(averageSize)} bytes, largest size = ${largestSize} bytes`);
    log.info(`${AUDIT_LOGGING_NAME} - Suggestion database capacity: approximately ${maxNumberFitInDB} suggestions can be saved within ${MAX_DB_OBJ_SIZE_KB} KB limit (based on average size of ${averageSizeKB.toFixed(2)} KB per suggestion)`);
  }

  // Log warning if total suggestion size is >= maximum allowed size
  if (sizeInKB >= MAX_DB_OBJ_SIZE_KB) {
    log.warn(`${AUDIT_LOGGING_NAME} - WARNING: Total size of all suggestions (${sizeInKB} KB) is >= ${MAX_DB_OBJ_SIZE_KB} KB. This will be too large for the database!`);
  }

  // return what will become the next 'auditData' object
  return {
    ...auditData,
    suggestions: suggestedFixes,
  };
}

/**
 * Generates opportunities based on the audit data.
 * Synchronizes existing suggestions with new data by removing outdated suggestions and adding
 * new ones.
 *
 * @param auditUrl - The URL of the audit (original base URL from site.getBaseURL())
 * @param auditData - The audit data containing the audit result and additional details
 * @param context - The context object containing the logger
 * @returns {Promise<Object>} The updated auditData object
 */
export async function generateOpportunities(auditUrl, auditData, context) {
  const { log } = context;

  // Use the audit scope URL from the audit result
  const auditScopeUrl = auditData?.auditResult?.auditScopeUrl || auditUrl;
  log.info(`${AUDIT_LOGGING_NAME} - Using audit scope URL for opportunity generation: ${auditScopeUrl}`);

  // check if audit itself ran successfully
  if (auditData.auditResult.success === false) {
    log.info(`${AUDIT_LOGGING_NAME} - Audit itself failed, skipping opportunity creation`);
    return { ...auditData };
  }

  // check if the audit produced any suggestions to resolve the issues it found
  if (!auditData.suggestions || !auditData.suggestions.length) {
    log.info(`${AUDIT_LOGGING_NAME} - No suggested fixes found, skipping opportunity creation`);
    return { ...auditData };
  }

  // Calculate projected traffic metrics based on the number of issues found
  const totalIssues = auditData.suggestions.length;
  const { projectedTrafficLost, projectedTrafficValue } = calculateProjectedMetrics(totalIssues);
  log.info(`${AUDIT_LOGGING_NAME} - Calculated projected traffic metrics: ${projectedTrafficLost} traffic lost, $${projectedTrafficValue} traffic value for ${totalIssues} issues`);

  log.info(`${AUDIT_LOGGING_NAME} - Creating an opportunity for all the suggestions.`);
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
    {
      projectedTrafficLost,
      projectedTrafficValue,
      auditScopeUrl,
    },
  );

  log.info(`${AUDIT_LOGGING_NAME} - Creating each suggestion for this opportunity.`);
  const buildKey = (data) => data.key; // we use this simple function since we pre-built each key
  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions,
    context,
    buildKey,
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
  .withUrlResolver(noopUrlResolver) // == site.getBaseURL()
  .withRunner(redirectsAuditRunner)
  .withPostProcessors([generateSuggestedFixes, generateOpportunities])
  .build();
