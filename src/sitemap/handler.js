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
import { Audit } from '@adobe/spacecat-shared-data-access';
import {
  extractDomainAndProtocol,
  getBaseUrlPagesFromSitemapContents,
  getSitemapUrlsFromSitemapIndex,
  getUrlWithoutPath,
  toggleWWW,
  isLoginPage,
} from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const auditType = Audit.AUDIT_TYPES.SITEMAP;

// Performance tuning constants - Optimized for 20K-30K URLs in 15min Lambda
const BATCH_SIZE = 50; // Aggressive batching for high volume
const BATCH_DELAY_MS = 50; // Minimal delay to prevent server overload
const REQUEST_TIMEOUT_MS = 2000; // 2 second timeout for speed

const TRACKED_STATUS_CODES = Object.freeze([301, 302, 404]);

export const ERROR_CODES = Object.freeze({
  INVALID_URL: 'INVALID URL',
  NO_SITEMAP_IN_ROBOTS: 'NO SITEMAP FOUND IN ROBOTS',
  NO_VALID_PATHS_EXTRACTED: 'NO VALID URLs FOUND IN SITEMAP',
  SITEMAP_NOT_FOUND: 'NO SITEMAP FOUND',
  SITEMAP_EMPTY: 'EMPTY SITEMAP',
  SITEMAP_FORMAT: 'INVALID SITEMAP FORMAT',
  FETCH_ERROR: 'ERROR FETCHING DATA',
});

const VALID_MIME_TYPES = Object.freeze([
  'application/xml',
  'text/xml',
  'text/html',
  'text/plain',
]);

/**
 * Utility function to add delay between batch processing
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fetches content with timeout control
 */
export async function fetchContent(targetUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Fetch error for ${targetUrl} Status: ${response.status}`);
    }

    return {
      payload: await response.text(),
      type: response.headers.get('content-type'),
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
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
    const isNotFound = error.message.includes('404');
    return {
      existsAndIsValid: false,
      reasons: [isNotFound ? ERROR_CODES.SITEMAP_NOT_FOUND : ERROR_CODES.FETCH_ERROR],
    };
  }
}

/**
 * Simplified URL validation with better performance and rate limiting
 */
export async function filterValidUrls(urls) {
  if (!urls.length) {
    return {
      ok: [], notOk: [], networkErrors: [], otherStatusCodes: [],
    };
  }

  const controller = new AbortController();
  const results = {
    ok: [], notOk: [], networkErrors: [], otherStatusCodes: [],
  };

  const checkUrl = async (url) => {
    try {
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle successful responses
      if (response.status === 200) {
        return { type: 'ok', url };
      }

      // Handle redirects
      if (response.status === 301 || response.status === 302) {
        const redirectUrl = response.headers.get('location');
        const finalUrl = redirectUrl ? new URL(redirectUrl, url).href : null;

        // Check if redirect leads to login page (treat as valid)
        if (finalUrl && isLoginPage(finalUrl)) {
          return { type: 'ok', url };
        }

        // Try to check the final destination
        if (finalUrl) {
          try {
            const redirectTimeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            const redirectResponse = await fetch(finalUrl, {
              method: 'HEAD',
              redirect: 'follow',
              signal: controller.signal,
            });

            clearTimeout(redirectTimeoutId);

            // If the redirect destination returns a 404 or has 404 patterns, suggest homepage
            const is404 = redirectResponse.status === 404
              || finalUrl.includes('/404/')
              || finalUrl.includes('404.html')
              || finalUrl.includes('/errors/404/');

            const originalUrl = new URL(url);
            const homepageUrl = `${originalUrl.protocol}//${originalUrl.hostname}`;

            return {
              type: 'notOk',
              url,
              statusCode: response.status,
              urlsSuggested: is404 ? homepageUrl : finalUrl,
            };
          } catch {
            // If redirect check fails, also check for 404 patterns in the redirect URL
            const is404 = finalUrl.includes('/404/')
              || finalUrl.includes('404.html')
              || finalUrl.includes('/errors/404/');

            const originalUrl = new URL(url);
            const homepageUrl = `${originalUrl.protocol}//${originalUrl.hostname}`;

            return {
              type: 'notOk',
              url,
              statusCode: response.status,
              urlsSuggested: is404 ? homepageUrl : finalUrl,
            };
          }
        }

        // If no redirect URL, suggest homepage
        const originalUrl = new URL(url);
        const homepageUrl = `${originalUrl.protocol}//${originalUrl.hostname}`;

        return {
          type: 'notOk',
          url,
          statusCode: response.status,
          urlsSuggested: homepageUrl,
        };
      }

      // Handle 404s and other status codes
      if (response.status === 404) {
        return { type: 'notOk', url, statusCode: response.status };
      }

      return { type: 'otherStatus', url, statusCode: response.status };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return { type: 'networkError', url, error: 'NETWORK_ERROR' };
    }
  };

  // Process URLs in batches with rate limiting
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
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
    if (i + BATCH_SIZE < urls.length) {
      // eslint-disable-next-line no-await-in-loop
      await delay(BATCH_DELAY_MS);
    }
  }

  return results;
}

/**
 * Retrieves base URL pages from sitemaps with improved error handling
 */
export async function getBaseUrlPagesFromSitemaps(baseUrl, urls) {
  const baseUrlVariant = toggleWWW(baseUrl);
  const contentsCache = {};

  // Check all sitemap URLs concurrently
  const checkPromises = urls.map(async (url) => {
    // checkSitemap handles its own errors and does not throw
    const urlData = await checkSitemap(url);
    contentsCache[url] = urlData;
    return { url, urlData };
  });

  const results = await Promise.all(checkPromises);
  const matchingUrls = [];

  // Process results and handle sitemap indices
  for (const { url, urlData } of results) {
    if (urlData.existsAndIsValid) {
      if (urlData.details?.isSitemapIndex) {
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
  }

  // Extract pages from matching URLs
  const pagesPromises = matchingUrls.map(async (matchingUrl) => {
    if (!contentsCache[matchingUrl]) {
      contentsCache[matchingUrl] = await checkSitemap(matchingUrl);
    }

    if (contentsCache[matchingUrl].existsAndIsValid) {
      const pages = getBaseUrlPagesFromSitemapContents(
        baseUrl,
        contentsCache[matchingUrl].details,
      );

      if (pages.length > 0) {
        return { [matchingUrl]: pages };
      }
    }

    return null;
  });

  const pageResults = await Promise.allSettled(pagesPromises);

  return pageResults.reduce((acc, result) => {
    if (result.status === 'fulfilled' && result.value) {
      Object.assign(acc, result.value);
    }
    return acc;
  }, {});
}

/**
 * Main sitemap discovery and validation function
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

  // Try to find sitemaps in robots.txt
  try {
    const robotsResult = await checkRobotsForSitemap(protocol, domain);
    if (robotsResult?.paths?.length) {
      sitemapUrls.ok = robotsResult.paths;
    }
  } catch (error) {
    // If robots.txt fails, return error immediately (to match test expectations)
    return {
      success: false,
      reasons: [{ value: `${error.message}`, error: ERROR_CODES.FETCH_ERROR }],
    };
  }

  // If no sitemaps found in robots.txt, try common locations
  if (!sitemapUrls.ok.length) {
    const commonSitemapUrls = [
      `${protocol}://${domain}/sitemap.xml`,
      `${protocol}://${domain}/sitemap_index.xml`,
    ];
    sitemapUrls = await filterValidUrls(commonSitemapUrls);

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

  // Filter sitemaps that match the input URL domain
  const inputUrlToggledWww = toggleWWW(inputUrl);
  const filteredSitemapUrls = sitemapUrls.ok.filter(
    (path) => path.startsWith(inputUrl) || path.startsWith(inputUrlToggledWww),
  );

  // Extract and validate pages from sitemaps
  const extractedPaths = await getBaseUrlPagesFromSitemaps(inputUrl, filteredSitemapUrls);
  const notOkPagesFromSitemap = {};

  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    for (const sitemapUrl of Object.keys(extractedPaths)) {
      const urlsToCheck = extractedPaths[sitemapUrl];

      if (urlsToCheck?.length) {
        // eslint-disable-next-line no-await-in-loop
        const existingPages = await filterValidUrls(urlsToCheck);

        // Collect issues for tracked status codes only
        if (existingPages.notOk?.length > 0) {
          const trackedIssues = existingPages.notOk
            .filter((issue) => TRACKED_STATUS_CODES.includes(issue.statusCode));
          if (trackedIssues.length > 0) {
            notOkPagesFromSitemap[sitemapUrl] = trackedIssues;
          }
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
  }

  // Return final result
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
  const suggestions = [...response, ...pagesWithIssues]
    .filter(Boolean)
    .map((issue) => ({
      ...issue,
      recommendedAction: issue.urlsSuggested
        ? `use this url instead: ${issue.urlsSuggested}`
        : 'Make sure your sitemaps only include URLs that return the 200 (OK) response code.',
    }));

  log.info(`Generated ${suggestions.length} suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  if (auditData.auditResult.success === false) {
    log.info('Sitemap audit failed, skipping opportunity and suggestions creation');
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
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL())
    .then((url) => getUrlWithoutPath(prependSchema(url))))
  .withPostProcessors([generateSuggestions, opportunityAndSuggestions])
  .build();
