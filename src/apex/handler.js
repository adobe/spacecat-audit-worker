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

// eslint-disable-next-line import/no-cycle
import { fetch, hasNonWWWSubdomain, toggleWWW } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/audit.js';

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
 * @param {string} baseURL - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function apexAuditRunner(baseURL, context) {
  const { log } = context;

  if (hasNonWWWSubdomain(baseURL)) {
    throw Error(`Url ${baseURL} already has a subdomain. No need to run apex audit.`);
  }

  const urls = [baseURL, toggleWWW(baseURL)];
  const results = await Promise.all(urls.map((_url) => probeUrlConnection(_url, log)));

  return {
    auditResult: results,
    fullAuditRef: baseURL,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(apexAuditRunner)
  .build();
