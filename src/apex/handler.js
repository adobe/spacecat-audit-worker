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

import URI from 'urijs';
import { hasText } from '@adobe/spacecat-shared-utils';
import { fetch } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';

URI.preventInvalidHostname = true;

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
    log.info(`Request to ${baseUrl} fails for an unknown reason. Code: ${e.code}`, e);
    return {
      url: baseUrl,
      success: false,
    };
  }
  return {
    url: baseUrl,
    success: true,
    status: resp.status,
  };
}

/**
 * Perform an audit to check if both www and non-www versions of a domain are accessible.
 * If the site contains a subdomain, the audit is skipped for that specific subdomain.
 *
 * @async
 * @param {string} finalUrl - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function apexAuditRunner(finalUrl, context) {
  const { log } = context;

  if (hasNonWWWSubdomain(finalUrl)) {
    throw Error(`Url ${finalUrl} already has a subdomain. No need to run apex audit.`);
  }

  const urls = [finalUrl, toggleWWW(finalUrl)];
  const results = await Promise.all(urls.map((_url) => probeUrlConnection(_url, log)));

  return {
    auditResult: results,
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withRunner(apexAuditRunner)
  .build();
