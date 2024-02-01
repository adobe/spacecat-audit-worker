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

import { internalServerError, noContent, notFound } from '@adobe/spacecat-shared-http-utils';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { fetch } from '../support/utils.js';

const ERROR_CODES = {
  INVALID_URL: 'ERR_INVALID_URL',
  ROBOTS_NOT_FOUND: 'ERR_ROBOTS_NOT_FOUND',
  NO_SITEMAP_IN_ROBOTS: 'ERR_NO_SITEMAP_IN_ROBOTS',
  SITEMAP_NOT_FOUND: 'ERR_SITEMAP_NOT_FOUND',
  SITEMAP_EMPTY: 'ERR_SITEMAP_EMPTY',
  SITEMAP_NOT_XML: 'ERR_SITEMAP_NOT_XML',
  FETCH_ERROR: 'ERR_FETCH_ERROR',
};

/**
 * Fetches the content from a given URL.
 *
 * @async
 * @param {string} targetUrl - The URL from which to fetch the content.
 * @returns {Promise<string|null>} - A Promise that resolves to the content
 * of the response as a string if the request was successful, otherwise null.
 */
async function fetchContent(targetUrl) {
  const response = await fetch(targetUrl);
  return response.ok ? response.text() : null;
}

/**
 * Extracts the domain and protocol from a given URL.
 *
 * @param {string} inputUrl - The URL to extract domain and protocol from.
 * @returns {{ domain: string, protocol: string }|null} - An object containing
 * the domain and protocol if successfully extracted,
 * or null if the URL is invalid.
 */
function extractDomainAndProtocol(inputUrl) {
  try {
    const parsedUrl = new URL(inputUrl);
    return { domain: parsedUrl.hostname, protocol: parsedUrl.protocol };
  } catch (error) {
    return null;
  }
}

/**
 * Checks the robots.txt file for a sitemap and returns the sitemap path if found.
 *
 * @async
 * @param {string} protocol - The protocol (http or https) of the site.
 * @param {string} domain - The domain of the site.
 * @returns {Promise<{ path: string|null, reasons: string[] }>} - A Promise that resolves
 * to an object containing the sitemap path and reasons for success or failure.
 */
async function checkRobotsForSitemap(protocol, domain) {
  const robotsUrl = `${protocol}//${domain}/robots.txt`;
  try {
    const robotsContent = await fetchContent(robotsUrl);
    const sitemapMatch = robotsContent.match(/Sitemap:\s*(.*)/i);
    return sitemapMatch && sitemapMatch[1]
      ? { path: sitemapMatch[1].trim(), reasons: [] }
      : { path: null, reasons: [ERROR_CODES.NO_SITEMAP_IN_ROBOTS] };
  } catch (error) {
    return { path: null, reasons: [ERROR_CODES.ROBOTS_NOT_FOUND] };
  }
}

/**
 * Checks the validity and existence of a sitemap by fetching its content.
 *
 * @async
 * @param {string} sitemapUrl - The URL of the sitemap to check.
 * @returns {Promise<Object>} - A Promise that resolves to an object
 * representing the result of the sitemap check.
 */
async function checkSitemap(sitemapUrl) {
  try {
    const sitemapContent = await fetchContent(sitemapUrl);
    if (!sitemapContent) {
      return {
        existsAndIsValid: false,
        reasons: [ERROR_CODES.SITEMAP_NOT_FOUND, ERROR_CODES.SITEMAP_EMPTY],
      };
    }
    const isValidXml = sitemapContent.trim().startsWith('<?xml');
    return {
      existsAndIsValid: isValidXml,
      reasons: isValidXml ? [] : [ERROR_CODES.SITEMAP_NOT_XML],
    };
  } catch (error) {
    return { existsAndIsValid: false, reasons: [ERROR_CODES.FETCH_ERROR] };
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
async function findSitemap(inputUrl) {
  const logMessages = [];

  const parsedUrl = extractDomainAndProtocol(inputUrl);
  if (!parsedUrl) {
    logMessages.push(ERROR_CODES.INVALID_URL);
    console.log(logMessages.join(' '));
    return {
      success: false,
      reasons: logMessages,
    };
  }

  const { protocol, domain } = parsedUrl;

  // Check sitemap from robots.txt
  const robotsResult = await checkRobotsForSitemap(protocol, domain);
  logMessages.push(...robotsResult.reasons.map((reason) => ({
    value: parsedUrl,
    error: reason,
  })));
  if (robotsResult.path) {
    const sitemapResult = await checkSitemap(robotsResult.path);
    logMessages.push(...sitemapResult.reasons.map((reason) => ({
      value: robotsResult.path,
      error: reason,
    })));
    if (sitemapResult.existsAndIsValid) {
      console.log(logMessages.join(' '));
      return {
        success: true,
        reasons: logMessages,
      };
    }
  } else {
    logMessages.push(...robotsResult.reasons.map((reason) => ({
      value: parsedUrl,
      error: reason,
    })));
  }

  // Check /sitemap.xml
  const assumedSitemapUrl = `${protocol}//${domain}/sitemap.xml`;
  const sitemapResult = await checkSitemap(assumedSitemapUrl);
  logMessages.push(...sitemapResult.reasons.map((reason) => ({
    value: assumedSitemapUrl,
    error: reason,
  })));
  if (sitemapResult.existsAndIsValid) {
    console.log(logMessages.join(' '));
    return {
      success: true,
      reasons: logMessages,
    };
  } else {
    // optimization: change from array of err messages to objects with the {item: url1, error: err1}
    logMessages.push(...robotsResult.reasons.map((reason) => ({
      value: assumedSitemapUrl,
      error: reason,
    })));
  }

  // Check /sitemap_index.xml
  const sitemapIndexUrl = `${protocol}//${domain}/sitemap_index.xml`;
  const sitemapIndexResult = await checkSitemap(sitemapIndexUrl);
  logMessages.push(...sitemapIndexResult.reasons.map((reason) => ({
    value: assumedSitemapUrl,
    error: reason,
  })));
  if (sitemapIndexResult.existsAndIsValid) {
    console.log(logMessages.join(' '));
    return {
      success: true,
      reasons: logMessages,
    };
  }

  console.log(logMessages.join(' '));
  return {
    success: false,
    reasons: logMessages,
  };
}

/**
 * Performs an audit for a specified site based on the audit request message.
 *
 * @async
 * @param {Object} message - The audit request message containing the type, URL, and audit context.
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Promise<Response>} - A Promise that resolves to a response object
 * indicating the result of the audit process.
 */
export default async function audit(message, context) {
  const { type, url: siteId, auditContext } = message;
  const { dataAccess, log, sqs } = context;
  const {
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;

  try {
    log.info(`Received ${type} audit request for siteId: ${siteId}`);

    const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
    if (!site) {
      log.error(`No site with siteId "${siteId}" exists.`);
      return notFound('Site not found');
    }

    const baseURL = site.getBaseURL();
    const auditResult = await findSitemap(baseURL);

    log.info(`Audit result for ${baseURL}:\n${JSON.stringify(auditResult, null, 2)}`);

    await sqs.sendMessage(queueUrl, {
      type,
      baseURL,
      auditContext,
      auditResult,
    });

    log.info(`Successfully audited ${baseURL} for ${type} type audit`);

    return noContent();
  } catch (e) {
    return internalServerError('sitemap audit failed');
  }
}
