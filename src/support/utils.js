/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { context as h2, h1 } from '@adobe/fetch';
// eslint-disable-next-line import/no-cycle
import { checkRobotsForSitemap, checkSitemap, ERROR_CODES } from '../sitemap/handler.js';
// eslint-disable-next-line import/no-cycle
import { toggleWWW } from '../apex/handler.js';

/* c8 ignore next 3 */
export const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? h1()
  : h2();

// weekly pageview threshold to eliminate urls with lack of samples

export async function getRUMUrl(url) {
  const urlWithScheme = url.startsWith('http') ? url : `https://${url}`;
  const resp = await fetch(urlWithScheme);
  const finalUrl = resp.url.split('://')[1];
  return finalUrl.endsWith('/') ? finalUrl.slice(0, -1) : /* c8 ignore next */ finalUrl;
}

/**
 * Extracts the domain and protocol from a given URL.
 *
 * @param {string} inputUrl - The URL to extract domain and protocol from.
 * @returns {{ domain: string, protocol: string }|null} - An object containing
 * the domain and protocol if successfully extracted,
 * or null if the URL is invalid.
 */
export function extractDomainAndProtocol(inputUrl) {
  try {
    const parsedUrl = new URL(inputUrl);
    return {
      protocol: parsedUrl.protocol.slice(0, -1),
      domain: parsedUrl.hostname,
    };
  } catch (error) {
    return null;
  }
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

  const robotsResult = await checkRobotsForSitemap(protocol, domain);
  // todo: add log messages if robots txt doesn't exist or not having sitemaps

  const inputUrlToggledWww = toggleWWW(inputUrl);
  const sitemapUrls = robotsResult.paths.filter((path) => path.startsWith(inputUrl)
      || path.startsWith(inputUrlToggledWww));

  // eslint-disable-next-line no-use-before-define
  const extractedPathsResponse = getBaseUrlPagesFromSitemaps(inputUrl, sitemapUrls);

  if (extractedPathsResponse.length() > 0) {
    // todo: with this map of sitemap to list of URLs that have the prefix of the baseURL,
    //  go on an filter out / check out the 200 entries from the top pages
    return {
      success: true,
      reasons: logMessages,
      paths: extractedPathsResponse.result,
    };
  } else {
    for (const logEntry of extractedPathsResponse.reasons) {
      logMessages.push(logEntry);
    }
    return {
      success: false,
      reasons: logMessages,
    };
  }
}

export async function getBaseUrlPagesFromSitemaps(baseUrl, urls) {
  const response = {
    results: {},
    reasons: [],
  };

  const baseUrlVariant = toggleWWW(baseUrl);

  // eslint-disable-next-line max-len
  const contentsCache = {};
  const matchingUrls = [];

  for (const url of urls) {
    if (contentsCache[url] !== undefined) {
      break; // already saw that URL
    }

    // eslint-disable-next-line no-await-in-loop
    const urlData = await checkSitemap(url);
    contentsCache[url] = urlData;

    if (urlData.existsAndIsValid) {
      if (urlData?.details?.isSitemapIndex) {
        // eslint-disable-next-line no-use-before-define
        const extractedSitemaps = getSitemapUrlsFromSitemapIndex(urlData.details.sitemapContent);
        for (const extractedSitemapUrl of extractedSitemaps) {
          if (contentsCache[extractedSitemapUrl] !== undefined) {
            break; // already saw that URL
          }

          // eslint-disable-next-line no-shadow,no-await-in-loop
          const urlData = await checkSitemap(extractedSitemapUrl);
          contentsCache[extractedSitemapUrl] = urlData;

          if (urlData.existsAndIsValid) {
            if (extractedSitemapUrl.startsWith(baseUrl)
                || extractedSitemapUrl.startsWith(baseUrlVariant)) { // covered step 3 here
              matchingUrls.push(extractedSitemapUrl);
            }
          }
        }
      } else {
        // eslint-disable-next-line no-lonely-if
        if (url.startsWith(baseUrl) || url.startsWith(baseUrlVariant)) { // covered step 3 here
          matchingUrls.push(url);
        }
      }
    }
  }

  if (matchingUrls.length === 1) {
    // eslint-disable-next-line max-len,no-use-before-define
    const pages = getBaseUrlPagesFromSitemapContents(baseUrl, contentsCache[matchingUrls[0]].details);
    if (pages > 0) {
      response[matchingUrls[0]] = pages;
    }
  } else if (matchingUrls.length > 1) {
    let shortestPathCounter = -1;
    let shortestPathSitemapUrls = [];

    for (const url of matchingUrls) {
      const currentCounter = url.split('/').length;
      if (shortestPathCounter > currentCounter) {
        shortestPathSitemapUrls = [url];
        shortestPathCounter = currentCounter;
      } else if (shortestPathCounter === currentCounter) {
        shortestPathSitemapUrls.push(url);
      } else if (shortestPathCounter === -1) {
        shortestPathCounter = currentCounter;
        shortestPathSitemapUrls.push(url);
      }
    }

    // eslint-disable-next-line guard-for-in,no-restricted-syntax
    for (const url in shortestPathSitemapUrls) {
      // eslint-disable-next-line no-use-before-define
      const pages = getBaseUrlPagesFromSitemapContents(baseUrl, contentsCache[url].details);
      if (pages > 0) {
        response[url] = pages;
      }
    }
  } else { // todo delete this
  }

  return response;
}

export function getBaseUrlPagesFromSitemapContents(baseUrl, sitemapDetails) {
  const baseUrlVariant = toggleWWW(baseUrl);
  const pages = [];

  if (sitemapDetails.isText) {
    const text = sitemapDetails.sitemapContent.payload;
    const lines = text.split('\n');
    for (const line of lines) {
      const content = line.trim();
      if (content.length > 0 && (content.startsWith(baseUrl)
          || content.startsWith(baseUrlVariant))) {
        pages.push(content);
      }
    }
  } else {
    // eslint-disable-next-line no-use-before-define
    const sitemapPages = getPagesFromSitemap(sitemapDetails.sitemapContent);
    for (const url of sitemapPages) {
      if (url.startsWith(baseUrl) || url.startsWith(baseUrlVariant)) {
        pages.push(url);
      }
    }
  }
  return pages;
}

export function extractTagLocValues(content, tagName) {
  // eslint-disable-next-line no-undef
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(content.payload, content.type);
  const urls = [];
  const sitemaps = xmlDoc.getElementsByTagName(tagName);
  for (let i = 0; i < sitemaps.length; i += 1) {
    const loc = sitemaps[i].getElementsByTagName('loc')[0];
    if (loc) {
      urls.push(loc.textContent);
    }
  }
  return urls;
}

// todo check with various sitemap XML structures to check if a simple `>https://(.*)<` regex could be used instead
export function getPagesFromSitemap(content) {
  return extractTagLocValues(content, 'url');
}

export function getSitemapUrlsFromSitemapIndex(content) {
  return extractTagLocValues(content, 'sitemap');
}
