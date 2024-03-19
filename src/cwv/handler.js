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
import { internalServerError, noContent } from '@adobe/spacecat-shared-http-utils';
import { composeAuditURL } from '@adobe/spacecat-shared-utils';
import { retrieveSiteBySiteId } from '../utils/data-access.js';

const PAGEVIEW_THRESHOLD = 7000;

export function filterRUMData(data) {
  return data.pageviews > PAGEVIEW_THRESHOLD // ignore the pages with low pageviews
      && data.url.toLowerCase() !== 'other'; // ignore the combined result
}

/**
 * url param in run-query@v3/rum-dashboard works in a 'startsWith' fashion. url=domain.com returns
 * an empty result whereas url=www.domain.com/ returns the desired result. To catch the redirects
 * to subdomains we issue a GET call to the domain, then use the final url after redirects
 * @param url
 * @returns finalUrl {Promise<string>}
 */

function processRUMResponse(data) {
  return data
    .filter(filterRUMData)
    .map((row) => ({
      url: row.url,
      pageviews: row.pageviews,
      avgcls: row.avgcls,
      avginp: row.avginp,
      avglcp: row.avglcp,
    }));
}
export default async function auditCWV(message, context) {
  const { type, url: siteId, auditContext = {} } = message;
  const { dataAccess, log, sqs } = context;
  const {
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;
  try {
    const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
    const url = site.getBaseURL();

    log.info(`Received audit req for domain: ${url}`);

    const rumAPIClient = RUMAPIClient.createFrom(context);
    const finalUrl = await composeAuditURL(url);
    auditContext.finalUrl = finalUrl;

    const params = {
      url: finalUrl,
    };

    const data = await rumAPIClient.getRUMDashboard(params);
    const auditResult = processRUMResponse(data);
    const fullAuditRef = await rumAPIClient.createRUMURL(params);

    const auditData = {
      siteId: site.getId(),
      isLive: site.isLive(),
      auditedAt: new Date().toISOString(),
      auditType: type,
      fullAuditRef,
      auditResult,
    };

    await dataAccess.addAudit(auditData);

    await sqs.sendMessage(queueUrl, {
      type,
      url,
      auditContext,
      auditResult,
    });

    log.info(`Successfully audited ${url} for ${type} type audit`);
    return noContent();
  } catch (e) {
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
