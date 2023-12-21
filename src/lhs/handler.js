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

import {
  internalServerError, noContent, notFound, ok,
} from '@adobe/spacecat-shared-http-utils';
import { hasText, isObject, isValidUrl } from '@adobe/spacecat-shared-utils';

import PSIClient, { PSI_STRATEGY_MOBILE, PSI_STRATEGY_DESKTOP } from '../support/psi-client.js';

import {
  extractAuditScores,
  extractThirdPartySummary,
  extractTotalBlockingTime,
  getContentLastModified,
} from '../utils/lhs.js';

const AUDIT_TYPE = 'lhs';
const AUDIT_TYPES = {
  MOBILE: `${AUDIT_TYPE}-${PSI_STRATEGY_MOBILE}`,
  DESKTOP: `${AUDIT_TYPE}-${PSI_STRATEGY_DESKTOP}`,
};

/**
 * Converts the audit type to a PSI strategy.
 *
 * @param {string} type - The audit type.
 * @return {string} - Returns the PSI strategy.
 * @throws {Error} - Throws an error if the type is not supported.
 */
const typeToPSIStrategy = (type) => {
  const strategyMap = {
    [AUDIT_TYPES.MOBILE]: PSI_STRATEGY_MOBILE,
    [AUDIT_TYPES.DESKTOP]: PSI_STRATEGY_DESKTOP,
  };

  if (!strategyMap[type]) {
    throw new Error('Unsupported type. Supported types are lhs-mobile and lhs-desktop.');
  }

  return strategyMap[type];
};

/**
 * Validates the given configuration object.
 *
 * @param {Object} config - The configuration object to validate.
 * @param {Object} config.dataAccess - The data access object for database operations.
 * @param {string} config.psiApiBaseUrl - The base URL for the PageSpeed Insights API.
 * @param {string} config.queueUrl - The URL of the SQS queue.
 * @param {Object} config.sqs - The SQS service object.
 * @returns {boolean|Array<string>} - Returns true if valid, otherwise an array of errors.
 */
const validateContext = (config) => {
  const {
    dataAccess, psiApiBaseUrl, queueUrl, sqs,
  } = config;
  const errors = [];
  if (!isObject(dataAccess)) errors.push('Invalid dataAccess object');
  if (!isValidUrl(psiApiBaseUrl)) errors.push('Invalid psiApiBaseUrl');
  if (!hasText(queueUrl)) errors.push('Invalid queueUrl');
  if (!isObject(sqs)) errors.push('Invalid sqs object');

  return errors.length === 0 ? true : errors;
};

/**
 * Creates audit data based on the site information and PageSpeed Insights data.
 *
 * @param {Object} site - The site object containing information about the site.
 * @param {Object} latestAudit - The latest audit for the site.
 * @param {Object} lighthouseResult - The PageSpeed Insights data.
 * @param {string} contentLastModified - The content last modified date in ISO format.
 * @param {string} fullAuditRef - The URL to the full audit results.
 * @param {string} strategy - The strategy of the audit.
 *
 * @returns {Object} - Returns the audit data.
 */
const createAuditData = (
  site,
  latestAudit,
  lighthouseResult,
  contentLastModified,
  fullAuditRef,
  strategy,
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
    siteId: site.getId(),
    auditType: AUDIT_TYPES[strategy.toUpperCase()],
    auditedAt: new Date().toISOString(),
    fullAuditRef,
    isLive: site.isLive(),
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
 * Creates a message object to be sent to SQS.
 *
 * @param {Object} auditContext - The audit context object containing information about the audit.
 * @param {Object} site - The site object containing information about the site.
 * @param {Object} auditData - The audit data to be included in the message.
 * @returns {Object} - Returns a message object formatted for SQS.
 */
const createSQSMessage = (auditContext, site, auditData) => ({
  type: auditData.auditType,
  url: site.getBaseURL(),
  gitHubUrl: site.getGitHubURL(),
  auditContext: {
    ...auditContext,
    finalUrl: auditData.auditResult.finalUrl,
  },
  auditResult: {
    siteId: site.getId(),
    finalUrl: auditData.auditResult.finalUrl,
    scores: auditData.auditResult.scores,
  },
});

/**
 * Fetches site data based on the given base URL. If no site is found for the given
 * base URL, null is returned. Otherwise, the site object is returned. If an error
 * occurs while fetching the site, an error is thrown.
 *
 * @async
 * @param {Object} dataAccess - The data access object for database operations.
 * @param {string} siteId - The siteId of the site to fetch data for.
 * @param {Object} log - The logging object.
 * @throws {Error} - Throws an error if the site data cannot be fetched.
 * @returns {Promise<Object|null>} - Returns the site object if found, otherwise null.
 */
const retrieveSite = async (dataAccess, siteId, log) => {
  try {
    const site = await dataAccess.getSiteByID(siteId);
    if (!isObject(site)) {
      log.warn(`Site not found for site: ${siteId}`);
      return null;
    }
    return site;
  } catch (e) {
    throw new Error(`Error getting site ${siteId}: ${e.message}`);
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
  let finalMessage = `LHS Audit Error: ${message}`;
  if (e) {
    finalMessage += `: ${e.message}`;
    log.error(finalMessage, e);
  } else {
    log.error(finalMessage);
  }
  return internalServerError('Internal Server Error');
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
    throw new Error(`Failed to send message to SQS: ${e.message}`);
  }
};

/**
 * Processes the audit by fetching site data,PSI data, code diff and content last modified date
 * creating audit data, and sending a message to SQS.
 *
 * @async
 * @param {Object} services - The services object containing the PSI client,
 * content client, and more.
 * @param {Object} site - The site which to audit.
 * @param {Object} auditContext - The audit context object containing information about the audit.
 * @param {string} queueUrl - The URL of the SQS queue.
 * @param {string} strategy - The strategy of the audit.
 * @param {Object} log - The logging object.
 *
 * @throws {Error} - Throws an error if any step in the audit process fails.
 */
async function processAudit(
  services,
  site,
  auditContext,
  queueUrl,
  strategy,
  log = console,
) {
  const {
    dataAccess, psiClient, sqs,
  } = services;

  const baseURL = site.getBaseURL();
  const auditType = AUDIT_TYPES[strategy.toUpperCase()];

  const latestAudit = await dataAccess.getLatestAuditForSite(
    site.getId(),
    auditType,
  );

  const { lighthouseResult, fullAuditRef } = await psiClient.runAudit(baseURL, strategy);

  if (isObject(lighthouseResult.runtimeError)) {
    log.error(
      `Audit error for site ${baseURL} with id ${site.getId()}: ${lighthouseResult.runtimeError.message}`,
      { code: lighthouseResult.runtimeError.code, auditType, strategy },
    );
  }

  const contentLastModified = await getContentLastModified(baseURL, log);

  const auditData = createAuditData(
    site,
    latestAudit,
    lighthouseResult,
    contentLastModified,
    fullAuditRef,
    strategy,
  );

  await dataAccess.addAudit(auditData);

  const message = createSQSMessage(auditContext, site, auditData);
  await sendMessageToSQS(sqs, queueUrl, message, log);
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
  } = config;

  const psiClient = PSIClient({ apiKey: psiApiKey, apiBaseUrl: psiApiBaseUrl }, log);

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
 * @param {Object} message - The audit request message containing the type, URL, and audit context.
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export default async function audit(message, context) {
  const { type, url: siteId, auditContext } = message;
  const { dataAccess, log, sqs } = context;
  const {
    PAGESPEED_API_BASE_URL: psiApiBaseUrl,
    PAGESPEED_API_KEY: psiApiKey,
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;

  try {
    const strategy = typeToPSIStrategy(type);

    const validationResults = validateContext({
      dataAccess, psiApiBaseUrl, queueUrl, sqs,
    });

    if (validationResults !== true) {
      return respondWithError(`Invalid configuration: ${validationResults.join(', ')}`, log);
    }

    log.info(`Received ${type} audit request for siteId: ${siteId}`);

    const site = await retrieveSite(dataAccess, siteId, log);
    if (!site) {
      return notFound('Site not found');
    }

    const auditConfig = site.getAuditConfig();
    if (auditConfig.auditsDisabled()) {
      log.info(`Audits disabled for site ${siteId}`);
      return ok();
    }

    if (auditConfig.getAuditTypeConfig(type)?.disabled()) {
      log.info(`Audit type ${type} disabled for site ${siteId}`);
      return ok();
    }

    const services = initServices({
      psiApiKey,
      psiApiBaseUrl,
      sqs,
      dataAccess,
    }, log);

    const startTime = process.hrtime();
    await processAudit(
      services,
      site,
      auditContext,
      queueUrl,
      strategy,
      log,
    );
    const endTime = process.hrtime(startTime);
    const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
    const formattedElapsed = elapsedSeconds.toFixed(2);

    log.info(`LHS Audit of type ${type} completed in ${formattedElapsed} seconds`);

    return noContent();
  } catch (e) {
    return respondWithError('Unexpected error occurred', log, e);
  }
}
