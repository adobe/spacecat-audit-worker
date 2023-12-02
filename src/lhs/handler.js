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

import { createUrl, Response } from '@adobe/fetch';
import { hasText, isObject, isValidUrl } from '@adobe/spacecat-shared-utils';

import { ensureValidUrl, fetch } from '../support/utils.js';

const AUDIT_TYPES = {
  MOBILE: 'lhs-mobile',
  DESKTOP: 'lhs-desktop',
};

/**
 * Converts the audit type to a PSI strategy.
 *
 * @param {string} type - The audit type.
 * @return {string} - Returns the PSI strategy.
 * @throws {Error} - Throws an error if the type is not supported.
 */
const typeToPSIStrategy = (type) => {
  let strategy;
  switch (type) {
    case AUDIT_TYPES.MOBILE:
      strategy = 'mobile';
      break;
    case AUDIT_TYPES.DESKTOP:
      strategy = 'desktop';
      break;
    default:
      throw new Error('Unsupported type. Supported types are lhs-mobile and lhs-desktop.');
  }
  return strategy;
};

/**
 * Validates the given configuration object.
 *
 * @param {Object} config - The configuration object to validate.
 * @param {Object} config.dataAccess - The data access object for database operations.
 * @param {string} config.psiApiBaseUrl - The base URL for the PageSpeed Insights API.
 * @param {string} config.queueUrl - The URL of the SQS queue.
 * @param {Object} config.sqs - The SQS service object.
 * @returns {boolean} - Returns true if the configuration is valid, otherwise false.
 */
const validateContext = (config) => {
  const {
    dataAccess, psiApiBaseUrl, queueUrl, sqs,
  } = config;
  return !(!isObject(dataAccess)
    || !isValidUrl(psiApiBaseUrl)
    || !hasText(queueUrl)
    || !isObject(sqs));
};

/**
 * Creates audit data based on the site information and PageSpeed Insights data.
 *
 * @param {Object} site - The site object containing information about the site.
 * @param {Object} psiData - The PageSpeed Insights data.
 * @param {string} psiApiBaseUrl - The base URL for the PageSpeed Insights API.
 * @param {string} fullAuditRef - The URL to the full audit results.
 * @param {string} strategy - The strategy of the audit.
 * @returns {Object} - Returns an object containing the audit data.
 */
const createAuditData = (site, psiData, psiApiBaseUrl, fullAuditRef, strategy) => {
  const { categories } = psiData.lighthouseResult;
  return {
    siteId: site.getId(),
    auditType: `lhs-${strategy}`,
    auditedAt: new Date().toISOString(),
    fullAuditRef,
    auditResult: {
      // TODO: add content and github diff here
      scores: {
        performance: categories.performance.score,
        seo: categories.seo.score,
        accessibility: categories.accessibility.score,
        'best-practices': categories['best-practices'].score,
      },
    },
  };
};

/**
 * Creates a message object to be sent to SQS.
 *
 * @param {Object} site - The site object containing information about the site.
 * @param {Object} auditData - The audit data to be included in the message.
 * @param {Object} originalMessage - The original message received for auditing.
 * @returns {Object} - Returns a message object formatted for SQS.
 */
const createSQSMessage = (site, auditData, originalMessage) => ({
  type: originalMessage.type,
  url: originalMessage.url,
  auditContext: originalMessage.auditContext,
  auditResult: {
    siteId: site.getId(),
    scores: auditData.auditResult,
  },
});

/**
 * Fetches PageSpeed Insights data for the given URL and PSI strategy. The data is fetched from the
 * PSI API URL provided in the configuration. The PSI API URL is expected to return
 * a 302 redirect to the actual data. This is currently provided by the EaaS API.
 *
 * @async
 * @param {string} psiApiBaseUrl - The base URL for the PageSpeed Insights API.
 * @param {string} url - The URL of the site to fetch PSI data for.
 * @param {string} strategy - The strategy of the audit.
 * @throws {Error} - Throws an error if the expected HTTP responses are not received.
 * @returns {Promise<Object>} - Returns an object containing PSI data and a task ID.
 */
const fetchPsiData = async (psiApiBaseUrl, url, strategy) => {
  const urlToBeAudited = ensureValidUrl(url);
  const psiUrl = createUrl(psiApiBaseUrl, { url: urlToBeAudited, strategy });

  const response = await fetch(psiUrl);

  if (response.status !== 200) {
    throw new Error('Expected a 200 status from PSI API');
  }

  const psiData = await response.json();

  return { psiData, fullAuditRef: response.url };
};

/**
 * Fetches site data based on the given base URL. If no site is found for the given
 * base URL, null is returned. Otherwise, the site object is returned. If an error
 * occurs while fetching the site, an error is thrown.
 *
 * @async
 * @param {Object} dataAccess - The data access object for database operations.
 * @param {string} url - The base URL of the site to fetch data for.
 * @param {Object} log - The logging object.
 * @throws {Error} - Throws an error if the site data cannot be fetched.
 * @returns {Promise<Object|null>} - Returns the site object if found, otherwise null.
 */
const retrieveSite = async (dataAccess, url, log) => {
  try {
    const site = await dataAccess.getSiteByBaseURL(url);
    if (!isObject(site)) {
      log.warn(`Site not found for baseURL: ${url}`);
      return null;
    }
    return site;
  } catch (e) {
    throw new Error(`Error getting site with baseURL ${url}`);
  }
};

/**
 * Responds with an error message and logs the error.
 *
 * @param {string} message - The error message to respond with.
 * @param {Object} log - The logging object.
 * @param {Error} [e] - Optional. The error object to log.
 * @returns {Response} - Returns a response object with status 500.
 */
const respondWithError = (message, log, e) => {
  const finalMessage = `LHS Audit Error: ${message}`;
  if (e) {
    log.error(finalMessage, e);
  } else {
    log.error(finalMessage);
  }
  return new Response(message, { status: 500 });
};

/**
 * Sends a message to an SQS queue.
 *
 * @async
 * @param {Object} sqs - The SQS service object.
 * @param {string} queueUrl - The URL of the SQS queue.
 * @param {Object} message - The message object to send.
 * @param {Object} log - The logging object.
 * @throws {Error} - Throws an error if the message cannot be sent to the queue.
 */
const sendMessageToSQS = async (sqs, queueUrl, message, log) => {
  try {
    await sqs.sendMessage(queueUrl, message);
  } catch (e) {
    log.error('Error while sending audit result to queue', e);
  }
};

/**
 * Processes the audit by fetching site data, PSI data, creating audit data,
 * and sending a message to SQS.
 *
 * @async
 * @param {Object} dataAccess - The data access object for database operations.
 * @param {string} queueUrl - The URL of the SQS queue.
 * @param {Object} sqs - The SQS service object.
 * @param {string} psiApiBaseUrl - The base URL for the PageSpeed Insights API.
 * @param {string} url - The URL of the site to audit.
 * @param {string} strategy - The strategy of the audit.
 * @param {Object} log - The logging object.
 *
 * @throws {Error} - Throws an error if any step in the audit process fails.
 */
async function processAudit(
  dataAccess,
  queueUrl,
  sqs,
  psiApiBaseUrl,
  url,
  strategy,
  log,
) {
  const site = await retrieveSite(dataAccess, url, log);
  if (!site) {
    throw new Error('Site not found');
  }

  const { psiData, fullAuditRef } = await fetchPsiData(psiApiBaseUrl, url, strategy);
  const auditData = createAuditData(site, psiData, psiApiBaseUrl, fullAuditRef, strategy);
  await dataAccess.addAudit(auditData);

  // TODO: Uncomment this once the audit result queue is ready.
  // const message = createSQSMessage(site, auditData, context.message);
  // await sendMessageToSQS(sqs, queueUrl, message, log);
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
  const { type, url } = message;
  const { dataAccess, log, sqs } = context;
  const {
    PAGESPEED_API_BASE_URL: psiApiBaseUrl,
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;

  const strategy = typeToPSIStrategy(type);

  try {
    if (!validateContext({
      dataAccess, psiApiBaseUrl, queueUrl, sqs,
    })) {
      return respondWithError('Invalid configuration', log);
    }

    log.info(`Received ${type} audit request for baseURL: ${url}`);

    const startTime = process.hrtime();
    await processAudit(dataAccess, queueUrl, sqs, psiApiBaseUrl, url, strategy, log);
    const endTime = process.hrtime(startTime);

    const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
    const formattedElapsed = elapsedSeconds.toFixed(2);

    log.info(`Audit for ${type} completed in ${formattedElapsed} seconds`);

    return new Response('', { status: 204 });
  } catch (e) {
    return respondWithError('Unexpected error occurred', log, e);
  }
}
