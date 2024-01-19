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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { internalServerError, noContent, notFound } from '@adobe/spacecat-shared-http-utils';
import { retrieveSiteByURL } from '../utils/data-access.js';
import {
  getRUMUrl,
} from '../support/utils.js';

const AUDIT_TYPE = '404-report';

export function filter404Data(data) {
  return data.topurl.toLowerCase() !== 'other' && !!data.source; // ignore the combined result and the 404s with no source
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
 * @param {Object} dataAccess - Object containing the functions supported by the data
 * @param {Object} site - The site which to audit.
 * @param {Object} auditContext - The audit context object containing information about the audit.
 * @param {Object} result - The result object containing audit result.
 * @throws {Error} - Throws an error if any step in the audit process fails.
 */
async function processAuditResult(
  dataAccess,
  site,
  auditContext,
  result,
) {
  const auditData = {
    siteId: site.getId(),
    auditType: AUDIT_TYPE,
    auditedAt: new Date().toISOString(),
    isLive: site.isLive(),
    auditResult: { ...result, finalUrl: auditContext.finalUrl },
  };

  await dataAccess.addAudit(auditData);
}
export default async function audit404(message, context) {
  const { type, url, auditContext } = message;
  const { log, dataAccess } = context;

  try {
    log.info(`Received audit req for domain: ${url}`);
    const site = await retrieveSiteByURL(dataAccess, url, log);
    if (!site) {
      return notFound('Site not found');
    }

    const rumAPIClient = RUMAPIClient.createFrom(context);
    const finalUrl = await getRUMUrl(url);
    auditContext.finalUrl = finalUrl;

    const params = {
      url: finalUrl,
    };

    const data = await rumAPIClient.get404Sources(params);
    const auditResult = process404Response(data);
    await processAuditResult(dataAccess, site, auditContext, auditResult);

    log.info(`Successfully audited ${url} for ${type} type audit`);

    return noContent();
  } catch (e) {
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
