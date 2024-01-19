/*
 * Copyright 2024 Adobe. All rights reserved.
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
import AhrefsAPIClient from '../support/ahrefs-client.js';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { toggleWWW } from '../apex/handler.js';

export default async function auditBrokenBacklinks(message, context) {
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

    const auditConfig = site.getAuditConfig();
    if (auditConfig.auditsDisabled()) {
      log.info(`Audits disabled for site ${siteId}`);
      return ok();
    }

    if (auditConfig.getAuditTypeConfig(type)?.disabled()) {
      log.info(`Audit type ${type} disabled for site ${siteId}`);
      return ok();
    }

    const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);
    const urls = [...new Set([site.getBaseURL(), toggleWWW(site.getBaseURL())])];

    await Promise.all(urls.map(async (url) => {
      try {
        const {
          result,
          fullAuditRef,
        } = await ahrefsAPIClient.getBrokenBacklinks(url);

        log.info(`Found ${result?.backlinks?.length} broken backlinks for siteId: ${siteId} and url ${url}`);

        const auditResult = {
          brokenBacklinks: result.backlinks,
        };
        const auditData = {
          siteId: site.getId(),
          isLive: site.isLive(),
          auditedAt: new Date().toISOString(),
          auditType: type,
          auditResult,
          fullAuditRef,
        };

        await dataAccess.addAudit(auditData);

        await sqs.sendMessage(queueUrl, {
          type,
          url,
          auditContext,
          auditResult,
        });
        log.info(`Successfully audited ${siteId} with url ${url} for ${type} type audit`);
      } catch (e) {
        log.error(`${type} type audit for ${siteId} with url ${url} failed with error: ${e.message}`, e);
      }
    }));

    log.info(`Successfully audited ${siteId} for ${type} type audit`);
    return noContent();
  } catch (e) {
    log.error(`${type} type audit for ${siteId} failed with error: ${e.message}`, e);
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
