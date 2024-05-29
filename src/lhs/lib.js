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

import { isObject, isValidUrl } from '@adobe/spacecat-shared-utils';

import PSIClient from '../support/psi-client.js';
import { fetch } from '../support/utils.js';
import { retrieveSiteBySiteId } from '../utils/data-access.js';

/**
 * Extracts audit scores from an audit.
 *
 * @param {Object} categories - The categories object from the audit.
 * @return {Object} - The extracted audit scores.
 */
export function extractAuditScores(categories) {
  const {
    performance, seo, accessibility, 'best-practices': bestPractices,
  } = categories;
  return {
    performance: performance.score,
    seo: seo.score,
    accessibility: accessibility.score,
    'best-practices': bestPractices.score,
  };
}

/**
 * Extracts total blocking time from an audit.
 *
 * @param {Object} psiAudit - The audit to extract tbt from.
 * @return {Object} - The extracted tbt.
 */
export function extractTotalBlockingTime(psiAudit) {
  return psiAudit?.['total-blocking-time']?.numericValue || null;
}

/**
 * Extracts third party summary from an audit.
 *
 * @param {Object} psiAudit - The audit to extract third party summary from.
 * @return {Object} - The extracted third party summary.
 */
export function extractThirdPartySummary(psiAudit) {
  const items = psiAudit?.['third-party-summary']?.details?.items || [];

  return Object.values(items)
    .map((item) => ({
      entity: item.entity,
      blockingTime: item.blockingTime,
      mainThreadTime: item.mainThreadTime,
      transferSize: item.transferSize,
    }));
}

/**
 * Retrieves the last modified date of the content from a given URL. If the URL is not accessible,
 * the function returns the current date in ISO format.
 * @param {string} finalURL - The URL from which to fetch the content's last modified date.
 * @param {Object} log - Logger object for error logging.
 * @returns {Promise<string>} - A promise that resolves to the content's
 * last modified date in ISO format.
 */
export async function getContentLastModified(finalURL, log) {
  let lastModified = new Date();
  try {
    const response = await fetch(finalURL, { method: 'HEAD' });
    if (response.ok) {
      const headerValue = response.headers.get('last-modified');
      if (headerValue && !Number.isNaN(new Date(headerValue).getTime())) {
        lastModified = new Date(headerValue);
      }
    } else {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    log.error(`Error fetching content last modified for ${finalURL}: ${error.message}`);
  }

  return lastModified.toISOString();
}

/**
 * Creates audit data based on the PageSpeed Insights data.
 *
 * @param {Object} lighthouseResult - The PageSpeed Insights data.
 * @param {string} contentLastModified - The content last modified date in ISO format.
 * @param {string} fullAuditRef - The URL to the full audit results.
 *
 * @returns {Object} - Returns the audit data.
 */
const createAuditData = (
  lighthouseResult,
  contentLastModified,
  fullAuditRef,
) => {
  const {
    audits,
    categories,
    finalUrl,
    runtimeError = {},
  } = lighthouseResult;

  const scores = extractAuditScores(categories);
  const totalBlockingTime = extractTotalBlockingTime(audits);
  const thirdPartySummary = extractThirdPartySummary(audits);

  return {
    fullAuditRef,
    auditResult: {
      finalUrl,
      contentLastModified,
      scores,
      thirdPartySummary,
      totalBlockingTime,
      runtimeError,
    },
  };
};

/**
 * Processes the audit by fetching site data,PSI data, code diff and content last modified date
 * creating audit data, and sending a message to SQS.
 *
 * @async
 * @param {Object} services - The services object containing the PSI client,
 * content client, and more.
 * @param {String} baseURL - The final URL to audit.
 * @param {Object} auditContext - The audit context object containing information about the audit.
 * @param {string} strategy - The strategy of the audit.
 * @param {Object} log - The logging object.
 * @returns {Object} - Returns the audit data.
 *
 * @throws {Error} - Throws an error if any step in the audit process fails.
 */
async function processAudit(
  services,
  baseURL,
  auditContext,
  strategy,
  log = console,
) {
  const { dataAccess, psiClient } = services;

  const site = await retrieveSiteBySiteId(dataAccess, baseURL, log);

  const { lighthouseResult, fullAuditRef, finalUrl } = await psiClient.runAudit(
    baseURL,
    strategy,
    site.getId(),
  );

  if (isObject(lighthouseResult.runtimeError)) {
    log.error(
      `Audit error for site ${baseURL}: ${lighthouseResult.runtimeError.message}`,
      { code: lighthouseResult.runtimeError.code, strategy },
    );
  }

  const contentLastModified = await getContentLastModified(finalUrl, log);

  return createAuditData(
    lighthouseResult,
    contentLastModified,
    fullAuditRef,
  );
}

/**
 * Initializes the services used by the audit process.
 *
 * @param {Object} config - The configuration object.
 * @param {Object} config.site - The site object containing information about the site.
 * @param {string} config.psiApiKey - The PageSpeed Insights API key.
 * @param {string} config.psiApiBaseUrl - The PageSpeed Insights API base URL.
 * @param {Object} config.sqs - The SQS service object.
 * @param {Object} config.dataAccess - The data access object for database operations.
 * @param {Object} log - The logging object.
 *
 * @returns {Object} - Returns an object containing the services.
 * @throws {Error} - Throws an error if any of the services cannot be initialized.
 */
function initServices(config, log = console) {
  const {
    psiApiKey,
    psiApiBaseUrl,
    sqs,
    dataAccess,
    environment,
  } = config;

  const psiClient = PSIClient(
    {
      apiKey: psiApiKey,
      apiBaseUrl: psiApiBaseUrl,
      environment,
    },
    log,
  );

  return {
    dataAccess,
    psiClient,
    sqs,
  };
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
 * @param {String} baseURL - The final URL to audit.
 * @param {String} strategy - The strategy of the audit.
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 */
async function lhsAuditRunner(baseURL, strategy, context) {
  const { dataAccess, log, sqs } = context;
  const {
    PAGESPEED_API_BASE_URL: psiApiBaseUrl,
    PAGESPEED_API_KEY: psiApiKey,
  } = context.env;

  if (!isValidUrl(psiApiBaseUrl)) {
    throw new Error('Invalid PageSpeed API base URL');
  }

  log.info(`Received ${strategy} audit request for: ${baseURL}`);

  const services = initServices({
    psiApiKey,
    psiApiBaseUrl,
    sqs,
    dataAccess,
    environment: context.func.version === 'v1' ? 'prod' : 'dev',
  }, log);

  const startTime = process.hrtime();
  const auditData = await processAudit(
    services,
    baseURL,
    context,
    strategy,
    log,
  );
  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`LHS Audit of type ${strategy} completed in ${formattedElapsed} seconds for ${baseURL}`);

  return auditData;
}

/**
 * Creates an LHS audit runner function based on the strategy.
 *
 * @param {string} strategy - The strategy of the audit.
 *
 * @returns {function(*, *): Promise<Object>} - Returns the LHS audit runner function.
 */
export default function createLHSAuditRunner(strategy) {
  return async (finalURL, context) => lhsAuditRunner(finalURL, strategy, context);
}
