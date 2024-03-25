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
// eslint-disable-next-line import/no-cycle
import { findSitemap, fetch } from '../support/utils.js';

export const ERROR_CODES = {
  INVALID_URL: 'INVALID_URL',
  ROBOTS_NOT_FOUND: 'ROBOTS_TXT_NOT_FOUND',
  NO_SITEMAP_IN_ROBOTS: 'NO_SITEMAP_IN_ROBOTS_TXT',
  SITEMAP_NOT_FOUND: 'SITEMAP_NOT_FOUND',
  SITEMAP_INDEX_NOT_FOUND: 'SITEMAP_INDEX_NOT_FOUND',
  SITEMAP_EMPTY: 'SITEMAP_EMPTY',
  SITEMAP_NOT_XML: 'SITEMAP_NOT_XML',
  FETCH_ERROR: 'FETCH_ERROR',
};

/**
 * Fetches the content from a given URL.
 *
 * @async
 * @param {string} targetUrl - The URL from which to fetch the content.
 * @returns {Promise<string|null>} - A Promise that resolves to the content
 * of the response as a string if the request was successful, otherwise null.
 */
export async function fetchContent(targetUrl) {
  const response = await fetch(targetUrl);
  return response.ok ? response.text() : null;
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
export async function checkRobotsForSitemap(protocol, domain) {
  const robotsUrl = `${protocol}://${domain}/robots.txt`;
  try {
    const robotsContent = await fetchContent(robotsUrl);
    if (robotsContent !== null) {
      const sitemapMatch = robotsContent.match(/Sitemap:\s*(.*)/i);
      if (sitemapMatch && sitemapMatch[1]) {
        return { path: sitemapMatch[1].trim(), reasons: [] };
      }
      return { path: null, reasons: [ERROR_CODES.NO_SITEMAP_IN_ROBOTS] };
    }
  } catch (error) {
    // ignore
  }
  return { path: null, reasons: [ERROR_CODES.ROBOTS_NOT_FOUND] };
}

/**
 * Checks the validity and existence of a sitemap by fetching its content.
 *
 * @async
 * @param {string} sitemapUrl - The URL of the sitemap to check.
 * @returns {Promise<Object>} - A Promise that resolves to an object
 * representing the result of the sitemap check.
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
      url: baseURL,
      auditContext,
      auditResult,
    });

    log.info(`Successfully audited ${baseURL} for ${type} type audit`);

    return noContent();
  } catch (e) {
    return internalServerError('Sitemap audit failed');
  }
}
