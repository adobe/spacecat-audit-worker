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

import { internalServerError, noContent, notFound } from '@adobe/spacecat-shared-http-utils';
import URI from 'urijs';
import { hasText } from '@adobe/spacecat-shared-utils';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { fetch } from '../support/utils.js';

URI.preventInvalidHostname = true;

function stripUrl(baseUrl) {
  return baseUrl.replace(/^(https?:\/\/)/, '');
}

/**
 * Checks if a given URL contains a domain with a non-www subdomain.
 *
 * @param {string} baseUrl - The URL to check for the presence of a domain with a non-www subdomain.
 * @returns {boolean} - Returns true if the baseUrl param contains a domain with a non-www
 * subdomain, otherwise false
 */
export function hasNonWWWSubdomain(baseUrl) {
  try {
    const uri = new URI(baseUrl);
    return hasText(uri.domain()) && hasText(uri.subdomain()) && uri.subdomain() !== 'www';
  } catch (e) {
    throw new Error(`Cannot parse baseURL: ${baseUrl}`);
  }
}

export function toggleWWW(baseUrl) {
  if (hasNonWWWSubdomain(baseUrl)) return baseUrl;
  return baseUrl.startsWith('https://www')
    ? baseUrl.replace('https://www.', 'https://')
    : baseUrl.replace('https://', 'https://www.');
}

/**
 * Probes the connection to a given URL using the fetch API
 *
 * @param {string} baseUrl - The base URL to probe for connectivity.
 * @param {Object} log - The logger object.
 * @returns {Promise<boolean>} - A Promise that resolves to true if the URL is reachable,
 *                              and false if the connection fails with ECONNREFUSED.
 */
async function probeUrlConnection(baseUrl, log) {
  let resp;
  try {
    resp = await fetch(baseUrl, { redirect: 'manual' });
  } catch (e) {
    if (e.erroredSysCall === 'connect') {
      log.info(`Request to ${baseUrl} fails due to a connection issue`, e);
      return {
        url: baseUrl,
        success: false,
      };
    }
    // failures for unknown reasons (ie bot detection) are not marked as 'failure' as intended
    // such failures are logged as error to receive an alert about it for investigation
    log.error(`Request to ${baseUrl} fails for an unknown reason`, e);
  }
  return {
    url: baseUrl,
    success: true,
    status: resp ? resp.status : 'unknown',
  };
}

/**
 * Perform an audit to check if both www and non-www versions of a domain are accessible.
 * If the site contains a subdomain, the audit is skipped for that specific subdomain.
 *
 * @async
 * @param {Object} message - The audit request message containing the type, URL, and audit context.
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
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
      return notFound('Site not found');
    }

    const baseURL = site.getBaseURL();

    if (hasNonWWWSubdomain(baseURL)) {
      log.info(`Url ${baseURL} already has a subdomain. No need to run apex audit.`);
      return noContent();
    }

    const urls = [baseURL, toggleWWW(baseURL)];
    const results = await Promise.all(urls.map((_url) => probeUrlConnection(_url, log)));

    const url = stripUrl(baseURL);

    await sqs.sendMessage(queueUrl, {
      type,
      url,
      auditContext,
      auditResult: results,
    });

    log.info(`Successfully audited ${url} for ${type} type audit`);

    return noContent();
  } catch (e) {
    return internalServerError('Apex audit failed');
  }
}
