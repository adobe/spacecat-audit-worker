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

import RUMAPIClient, { create404URL } from '@adobe/spacecat-shared-rum-api-client';
import { internalServerError, noContent, notFound } from '@adobe/spacecat-shared-http-utils';
import { dateAfterDays } from '@adobe/spacecat-shared-utils';
import { retrieveSiteByURL } from '../utils/data-access.js';
import {
  getRUMUrl,
} from '../support/utils.js';

const AUDIT_TYPE = '404';
const PAGEVIEW_THRESHOLD = 100;

export function filter404Data(data) {
  return data.views > PAGEVIEW_THRESHOLD
      && data.topurl.toLowerCase() !== 'other'
      && !!data.source;
}

function process404Response(data) {
  return data
    .filter(filter404Data)
    .map((row) => ({
      url: row.topurl,
      pageviews: row.views,
      source: row.source,
    }));
}

/**
 * Processes the audit by fetching site data,PSI data, code diff and content last modified date
 * creating audit data, and sending a message to SQS.
 *
 * @async
 * @param {Object} services - The services object containing the dataAccess and sqs service.
 * @param {Object} site - The site which to audit.
 * @param {Object} auditContext - The audit context object containing information about the audit.
 * @param {Object} queueUrl - The SQS queue URL.
 * @param {Object} result - The result object containing audit result.
 * @param {Object} log - The logger.
 * @throws {Error} - Throws an error if any step in the audit process fails.
 */
async function processAuditResult(
  services,
  site,
  auditContext,
  queueUrl,
  result,
  log,
) {
  const {
    dataAccess, sqs,
  } = services;
  const auditData = {
    siteId: site.getId(),
    auditType: AUDIT_TYPE,
    auditedAt: new Date().toISOString(),
    fullAuditRef: create404URL(auditContext),
    isLive: site.isLive(),
    auditResult: { result, finalUrl: auditContext.url },
  };
  try {
    log.info(`Saving audit ${JSON.stringify(auditData)}`);
    await dataAccess.addAudit(auditData);

    await sqs.sendMessage(queueUrl, {
      type: AUDIT_TYPE,
      url: site.getBaseURL(),
      auditContext: { finalUrl: auditContext.url },
      auditResult: result,
    });
  } catch (e) {
    log.error(`Error writing ${AUDIT_TYPE} to audit table: ${e.message}`);
    throw e;
  }
}
export default async function audit404(message, context) {
  const { type, url } = message;
  const { log, dataAccess } = context;
  const {
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;

  try {
    log.info(`Received audit req for domain: ${url}`);
    const site = await retrieveSiteByURL(dataAccess, url, log);
    log.info(`Retrieved site by url: ${url}`);
    if (!site) {
      log.error(`Site not found: ${url}`);
      return notFound('Site not found');
    }
    const finalUrl = await getRUMUrl(url);

    const rumAPIClient = RUMAPIClient.createFrom(context);
    const startDate = dateAfterDays(-7);

    const params = {
      url: finalUrl,
      interval: -1,
      startdate: startDate.toISOString().split('T')[0],
      enddate: new Date().toISOString().split('T')[0],
    };

    const data = await rumAPIClient.get404Sources(params);
    const auditResult = process404Response(data);
    await processAuditResult(
      { ...context, rumAPIClient },
      site,
      params,
      queueUrl,
      auditResult,
      log,
    );

    log.info(`Successfully audited ${url} for ${type} type audit`);

    return noContent();
  } catch (e) {
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
