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
import {
  extractDomainAndProtocol,
  getUrlWithoutPath,
} from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import {
  ensureFullUrl,
  is404page,
} from './opportunity-utils.js';

const auditType = 'redirect-chains';

export const AUDIT_DISPLAY_NAME = 'Redirect Chains'; // used for logging, and in unit tests
const USER_AGENT = 'Spacecat/1.0'; // identify ourselves in all HTTP requests
const KEY_SEPARATOR = '~|~'; // part of building a unique key for each entry in the suggestions
const STOP_AFTER_N_REDIRECTS = 5; // per entry tested ... used to prevent infinite redirects
const MAX_REDIRECTS_TO_TOLERATE = 1; // ex: only allow 1 redirect before we consider it a problem

// ----- support -----------------------------------------------------------------------------------

/**
 * Returns a unique key for the result object.  The result object represents a specific
 * "Source" and "Destination" URL pair.  The generated key handles any duplicates that were found.
 * This key is used to uniquely identify the entry when we run the audit repeatedly.
 *
 * @param {Object} result - The result object.
 *                          See the structure returned by `followAnyRedirectForUrl`.
 * @returns {string} The unique key.
 */
function buildUniqueKey(result) {
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
  const domain = new URL(url).hostname;
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
      redirectChain = `${redirectChain} -> ${redirectUrl}`;
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
      redirectCount: 0,
      redirectChain,
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
 * @param domain - Optional. The domain to prepend if missing from the URL
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
async function followAnyRedirectForUrl(urlStruct, domain = '') {
  // ensure full URLs
  const srcUrl = ensureFullUrl(urlStruct.origSrc, domain);
  let fullDest = urlStruct.origDest;
  if (fullDest) {
    fullDest = ensureFullUrl(fullDest, domain);
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
      isDuplicateSrc, // false
      ordinalDuplicate,
      tooQualified: isTooQualified,
      hasSameSrcDest,
      redirectCount: 0, // technically: unknown
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
        log.error(`${AUDIT_DISPLAY_NAME} - Error trying to get ${url} ... HTTP code: ${response.status}`);
      }
      return []; // return an empty array
    }
    return await response.json(); // return the data as JSON
  } catch (error) {
    log.error(`${AUDIT_DISPLAY_NAME} - Error in method "getJsonData" for URL: ${url} ...`, error);
    return []; // return an empty array if the fetch fails
  }
}

/**
 * Processes the /redirects.json file and returns a sorted array of all the page URLs referenced.
 *  * Duplicates are marked.  The last occurrence of a duplicate is kept as the original.
 *  * Marks any entries that are fully qualified (vs relative) as 'tooQualified'.
 *  * Marks any entries that have the same source and destination URLs as 'hasSameSrcDest'.
 * If there is no /redirects.json file, then an empty array is returned.
 *
 * @param {string} baseUrl - The site's base URL for the /redirects.json file.
 *                           Ex: https://www.example.com
 * @param {Object} log - The logger object to use for logging.
 * @returns {Promise<Object[]>} An array of page URLs.  Might be empty.
 */
export async function processRedirectsFile(baseUrl, log) {
  // create the URL for the /redirects.json file
  const redirectsUrl = `${baseUrl}/redirects.json`;
  // retrieve the entire /redirects.json file
  let redirectsJson = await getJsonData(redirectsUrl, log);
  if (!redirectsJson || !redirectsJson.data || !redirectsJson.data.length) {
    return []; // no /redirects.json file found, or there are no entries in the file
  }
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
    log.warn(`${AUDIT_DISPLAY_NAME} - Expected ${totalEntries} entries in ${redirectsUrl}, but found only ${redirectsJson.data.length}.`);
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
    if (pageUrls[i].origSrc.startsWith(baseUrl) || pageUrls[i].origDest.startsWith(baseUrl)) {
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
  if (pageUrls[pageUrls.length - 1].origSrc.startsWith(baseUrl)
    || pageUrls[pageUrls.length - 1].origDest.startsWith(baseUrl)) {
    pageUrls[pageUrls.length - 1].tooQualified = true; // "too qualified"
  }
  if (pageUrls[pageUrls.length - 1].origSrc === pageUrls[pageUrls.length - 1].origDest) {
    pageUrls[pageUrls.length - 1].hasSameSrcDest = true; // "has same source and destination URLs"
  }
  return pageUrls;
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
 * @param {string} baseUrl - The base URL to use for relative URLs.
 * @param {Object} log - The logger object to use for logging.
 * @param {number} maxConcurrency - The maximum number of concurrent requests to process.
 *
 * @returns {Promise<Object[]>} An array of results for each processed page URL.
 *  Each result object has the structure as returned by `followAnyRedirectForUrl`
 */
export async function processEntriesInParallel(pageUrls, baseUrl, log, maxConcurrency = 1000) {
  const BATCH_SIZE = maxConcurrency; // processing takes about 0.015 seconds per entry
  const allResults = [];

  // Process in batches to control concurrency
  for (let i = 0; i < pageUrls.length; i += BATCH_SIZE) {
    const batch = pageUrls.slice(i, i + BATCH_SIZE);

    // Process current batch in parallel
    const batchPromises = batch.map(async (row) => followAnyRedirectForUrl(row, baseUrl));

    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults);

    // Log progress
    log.info(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pageUrls.length / BATCH_SIZE)}`);
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
 *    count400Errors: number,               // HTTP error codes 400+
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
    count400Errors: 0,
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
      counts.count400Errors += 1;
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
 * Processes each entry in the given array of page URLs.
 * Returns statistical counts and all affected entries.
 *
 * @param {Object[]} pageUrls - An array of page URL objects to process.
 *                              See the structure returned by `processRedirectsFile`.
 * @param {string} baseUrl - The base URL to use for relative URLs.
 * @param {Object} log - The logger object to use for logging.
 *
 * @returns {Promise<{counts: {}, entriesWithProblems: *[]}>}
 *           See the structures returned by `analyzeResults` for details.
 */
async function processEntries(pageUrls, baseUrl, log) {
  // Step 1: Process all HTTP requests in parallel (the slow part)
  const results = await processEntriesInParallel(pageUrls, baseUrl, log);

  // Step 2: Analyze results synchronously (the fast part)
  const { counts, entriesWithProblems } = analyzeResults(results);

  return { counts, entriesWithProblems };
}

// ----- audit runner  -----------------------------------------------------------------------------

/**
 * Runs the audit for the /redirects.json file.
 * @param baseUrl
 * @param context
 * @returns {Promise<{
 *    fullAuditRef,
 *    url,
 *    auditResult: {
 *      success: boolean,
 *      reasons: [{value: string}],
 *      details: {issues: *[]}       // see `followAnyRedirectForUrl` for structure
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
  };

  // run the audit
  log.info(`${AUDIT_DISPLAY_NAME} - STARTED running audit for /redirects.json for ${baseUrl}`);
  if (!extractDomainAndProtocol(baseUrl)) {
    auditResult.success = false;
    auditResult.reasons = [{ value: baseUrl, error: 'INVALID URL' }];
  }

  // get a pre-processed array of page URLs from the /redirects.json file
  let pageUrls = [];
  if (auditResult.success) {
    log.info(`${AUDIT_DISPLAY_NAME} - PROCESSING /redirects.json for ${baseUrl}`);
    pageUrls = await processRedirectsFile(baseUrl, log);
  }

  // process the entries & remember the results
  const { counts, entriesWithProblems } = await processEntries(pageUrls, baseUrl, log);
  if (counts.countTotalEntriesWithProblems > 0) {
    auditResult.details.issues = entriesWithProblems;
  }

  // end timer
  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  // echo the stats
  log.info(`${AUDIT_DISPLAY_NAME} - STATS: /redirects.json has total number of entries checked:       ${pageUrls.length}`);
  log.info(`${AUDIT_DISPLAY_NAME} - STATS: /redirects.json has total number of entries with problems: ${counts.countTotalEntriesWithProblems}`);
  if (counts.countTotalEntriesWithProblems > 0) {
    log.info(`${AUDIT_DISPLAY_NAME} - STATS: /redirects.json .. duplicate Source URLs:        ${counts.countDuplicateSourceUrls}`);
    log.info(`${AUDIT_DISPLAY_NAME} - STATS: /redirects.json .. too qualified URLs:           ${counts.countTooQualifiedUrls}`);
    log.info(`${AUDIT_DISPLAY_NAME} - STATS: /redirects.json .. same Source and Dest URLs:    ${counts.countHasSameSrcDest}`);
    log.info(`${AUDIT_DISPLAY_NAME} - STATS: /redirects.json .. resulted in HTTP error:       ${counts.count400Errors}`);
    log.info(`${AUDIT_DISPLAY_NAME} - STATS: /redirects.json .. Final URL not match Dest URL: ${counts.countNotMatchDestinationUrl}`);
    log.info(`${AUDIT_DISPLAY_NAME} - STATS: /redirects.json .. with too many redirects:      ${counts.countTooManyRedirects}`);
  }

  log.info(`${AUDIT_DISPLAY_NAME} - DONE running audit for /redirects.json for ${baseUrl}. Completed in ${formattedElapsed} seconds.`);
  return {
    fullAuditRef: baseUrl,
    url: baseUrl,
    auditResult,
  };
}

/**
 * Returns the suggested fix for the given result object.
 * @param {Object} result - The result object.
 *                          See the structure returned by `followAnyRedirectForUrl`.
 * @returns {string} The suggested fix.
 */
export function getSuggestedFix(result) {
  if (!result || (typeof result === 'object' && Object.keys(result).length === 0)) {
    return '';
  }

  // prep
  let fix = '(no pre-determined fix)';

  const baseUrl = new URL(result.referencedBy).origin;
  let finalUrl = result.fullFinal;
  if (result.fullDest.startsWith(baseUrl) // if the fully qualified destination URL has the base URL
    && finalUrl.startsWith(baseUrl) // and the fully qualified final URL also has the base URL
    && !result.origDest.startsWith(baseUrl)) { // but the original destination URL does not ...
    // remove the base URL from the final URL so it is in the spirit of the original destination URL
    finalUrl = finalUrl.replace(baseUrl, '');
  }

  const fixForDuplicate = `Automatically remove this entry: Source URL: ${result.origSrc} with the Destination URL: ${result.origDest} ... found in the ${result.referencedBy} file`;
  const fixForTooQualified = `Automatically fix the actual Source URL and/or the Destination URL to use relative paths by removing the base URL: ${baseUrl} ... found in the ${result.referencedBy} file`;
  const fixForHasSameSrcDest = `The Source URL: ${result.origSrc} and the Destination URL: ${result.origDest} are the same.  Automatically remove the entry from the ${result.referencedBy} file.`;
  const fixForManualCheck = `Manually check the URL: ${finalUrl} since it resulted in an error code. Maybe remove the ${result.origSrc} entry from the ${result.referencedBy} file.`;
  const fixFor404page = `It seems that the final URL: ${finalUrl} is a 404 page.  If so, then manually remove the ${result.origSrc} entry from the ${result.referencedBy} file.`;
  const fixForFinalMismatch = `Automatically replace the Destination URL: ${result.origDest} with the final URL: ${finalUrl} ... found in the ${result.referencedBy} file`;
  const fixForCircularRedirect = `There seem to be circular redirects (stopped after (${result.redirectCount} redirects).  Manually check the redirects that start from the Source URL: ${result.origSrc} ... found in the ${result.referencedBy} file`;
  const fixForHighRedirectCount = `There were too many redirects (${result.redirectCount}) to get to the final URL: ${finalUrl}.  Manually check the redirects that start from the Source URL: ${result.origSrc} ... found in the ${result.referencedBy} file.`;

  // determine the suggested fix
  if (result.isDuplicateSrc) {
    fix = fixForDuplicate;
  } else if (result.tooQualified) {
    fix = fixForTooQualified;
  } else if (result.hasSameSrcDest) {
    fix = fixForHasSameSrcDest;
  } else if (result.status >= 400) {
    fix = fixForManualCheck;
  } else if (!result.fullFinalMatchesDestUrl) {
    if (is404page(result.fullFinal)) {
      fix = fixFor404page;
    } else {
      fix = fixForFinalMismatch;
    }
  } else if (result.redirectCount >= STOP_AFTER_N_REDIRECTS) {
    fix = fixForCircularRedirect;
  } else if (result.redirectCount > MAX_REDIRECTS_TO_TOLERATE) {
    // although the "final" URL matched the expected "destination" URL,
    // there were too many redirects in between.
    fix = fixForHighRedirectCount;
  }
  return fix;
}

/**
 * For each entry in the audit data, generates a suggested fix based on the issues found for
 * that entry.
 *
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details
 * @param context - The context object containing the logger
 * @returns {Array} The new "auditData" object containing an array of suggestions.
 */
export function generateSuggestedFixes(auditUrl, auditData, context) {
  const { log } = context;

  const suggestedFixes = []; // {key: '...', fix: '...'}
  const entriesWithIssues = auditData?.auditResult?.details?.issues ?? [];

  log.info(`${AUDIT_DISPLAY_NAME} - Generating suggestions for URL ${auditUrl} which has ${entriesWithIssues.length} affected entries.`);
  log.debug(`${AUDIT_DISPLAY_NAME} - Audit data: ${JSON.stringify(auditData)}`);

  for (const row of entriesWithIssues) {
    const suggestedFix = getSuggestedFix(row);
    if (suggestedFix) {
      suggestedFixes.push({ key: buildUniqueKey(row), fix: suggestedFix });
    }
  }
  log.info(`${AUDIT_DISPLAY_NAME} - Generated ${suggestedFixes.length} suggested fixes.`);
  log.debug(`${AUDIT_DISPLAY_NAME} - Suggested fixes: ${JSON.stringify(suggestedFixes)}`);

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
 * @param auditUrl - The URL of the audit
 * @param auditData - The audit data containing the audit result and additional details
 * @param context - The context object containing the logger
 * @returns {Promise<*>}
 */
export async function generateOpportunities(auditUrl, auditData, context) {
  const { log } = context;

  // check if audit itself ran successfully
  if (auditData.auditResult.success === false) {
    log.info(`${AUDIT_DISPLAY_NAME} audit itself failed, skipping opportunity creation`);
    return { ...auditData };
  }

  // check if the audit produced any suggestions to resolve the issues it found
  if (!auditData.suggestions || !auditData.suggestions.length) {
    log.info(`${AUDIT_DISPLAY_NAME} has no suggested fixes found, skipping opportunity creation`);
    return { ...auditData };
  }

  log.info(`${AUDIT_DISPLAY_NAME} generated ${auditData.suggestions.length} suggestions.  Now creating opportunities for these.`);
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const buildKey = (data) => data.key;
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
  .withRunner(redirectsAuditRunner)
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL())
    .then((url) => getUrlWithoutPath(prependSchema(url))))
  .withPostProcessors([generateSuggestedFixes, generateOpportunities])
  .build();
