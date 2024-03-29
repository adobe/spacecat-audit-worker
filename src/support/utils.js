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
 * Finds and validates the sitemap for a given URL by checking:
 * robots.txt, sitemap.xml, and sitemap_index.xml.
 *
 * @async
 * @param {string} inputUrl - The URL for which to find and validate the sitemap.
 * @returns {Promise<Object>} -A Promise that resolves to an object
 * representing the success and reasons for the sitemap search and validation.
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

  // Check sitemap path in robots.txt
  const robotsResult = await checkRobotsForSitemap(protocol, domain);
  if (!robotsResult.path) {
    logMessages.push(...robotsResult.reasons.map((reason) => ({
      value: `${inputUrl}/robots.txt`,
      error: reason,
    })));
  } else if (robotsResult.path.length > 2) {
    let sitemapUrlFromRobots = robotsResult.path;
    if (robotsResult.path[0] === '/' && robotsResult.path[1] !== '/') {
      sitemapUrlFromRobots = `${protocol}://${domain}${sitemapUrlFromRobots}`;
    }

    const sitemapResult = await checkSitemap(sitemapUrlFromRobots);
    logMessages.push(...sitemapResult.reasons.map((reason) => ({
      value: sitemapUrlFromRobots,
      e: reason,
    })));
    if (sitemapResult.existsAndIsValid) {
      return {
        success: true,
        reasons: logMessages,
        paths: [sitemapUrlFromRobots],
      };
    }
  }

  // Check sitemap.xml
  const assumedSitemapUrl = `${protocol}://${domain}/sitemap.xml`;
  const sitemapResult = await checkSitemap(assumedSitemapUrl);
  if (sitemapResult.existsAndIsValid) {
    return {
      success: true,
      reasons: logMessages,
      paths: [assumedSitemapUrl],
    };
  } else {
    logMessages.push(...sitemapResult.reasons.map((reason) => ({
      value: assumedSitemapUrl,
      error: reason,
    })));
  }

  // Check sitemap_index.xml
  const sitemapIndexUrl = `${protocol}://${domain}/sitemap_index.xml`;
  const sitemapIndexResult = await checkSitemap(sitemapIndexUrl);
  logMessages.push(...sitemapIndexResult.reasons.map((reason) => ({
    value: sitemapIndexUrl,
    error: reason,
  })));
  if (sitemapIndexResult.existsAndIsValid) {
    return {
      success: true,
      reasons: logMessages,
      paths: [sitemapIndexUrl],
    };
  } else if (sitemapIndexResult.reasons.includes(ERROR_CODES.SITEMAP_NOT_FOUND)) {
    logMessages.push({
      value: sitemapIndexUrl,
      error: ERROR_CODES.SITEMAP_INDEX_NOT_FOUND,
    });
  }

  return {
    success: false,
    reasons: logMessages,
  };
}
