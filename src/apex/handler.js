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
  return baseUrl.startsWith('https://') ? baseUrl.slice(8) /* c8 ignore next */ : baseUrl;
}

/**
 * Checks if a given URL contains an apex domain without a subdomain.
 *
 * @param {string} baseUrl - The URL to check for the presence of an apex domain.
 * @returns {boolean} - Returns true if the baseUrl param contains an apex domain, otherwise false
 */
export function isApex(baseUrl) {
  try {
    const uri = new URI(baseUrl);
    return hasText(uri.domain()) && !hasText(uri.subdomain());
  } catch (e) {
    throw new Error(`Cannot parse baseURL: ${baseUrl}`);
  }
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
  try {
    await fetch(baseUrl); // no need for the return value just checking
  } catch (e) {
    log.info(`HTTP call to apex ${baseUrl} fails`);
    return false;
  }
  return true;
}

/**
 * The main function to handle audit requests. This function is invoked by the
 * SpaceCat runtime when a message is received on the audit request queue.
 * The message is expected to contain the following properties:
 * - type: The type of audit to perform.
 * - url: The base URL of the site to audit.
 * - auditContext: The audit context object containing information about the audit.
 * The context object is expected to contain the following properties:
 * - dataAccess: The data access object for database operations.
 * - log: The logging object.
 * - env: The environment variables.
 * - sqs: The SQS service object.
 * - message: The original message received from SQS.
 * The function performs the following steps:
 * - Determines the audit strategy based on the audit type.
 * - Validates the context object.
 * - Fetches site data.
 * - Fetches PSI data for the site and strategy.
 * - Creates audit data.
 * - Sends a message to SQS.
 * - Returns a 204 response.
 * If any step fails, an error is thrown and a 500 response is returned.
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

    if (!isApex(baseURL)) {
      log.info(`Url ${baseURL} already has a subdomain. No need to run apex audit.`);
      return noContent();
    }

    const result = await probeUrlConnection(baseURL, log);
    const url = stripUrl(baseURL);

    await sqs.sendMessage(queueUrl, {
      type,
      url,
      auditContext,
      auditResult: {
        success: result,
      },
    });

    log.info(`Successfully audited ${url} for ${type} type audit`);

    return noContent();
  } catch (e) {
    return internalServerError('Apex audit failed');
  }
}
