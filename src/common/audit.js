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

import { composeAuditURL, isAuditsDisabled } from '@adobe/spacecat-shared-utils';
import { ok } from '@adobe/spacecat-shared-http-utils';
import { retrieveSiteBySiteId } from '../utils/data-access.js';

export async function defaultMessageSender(resultMessage, context) {
  const { sqs } = context;
  const { AUDIT_RESULTS_QUEUE_URL: queueUrl } = context.env;

  await sqs.sendMessage(queueUrl, resultMessage);
}

export async function defaultPersister(auditData, context) {
  const { dataAccess } = context;
  await dataAccess.addAudit(auditData);
}

export async function defaultSiteProvider(siteId, context) {
  const { log, dataAccess } = context;

  const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
  if (!site) {
    throw new Error(`Site with id ${siteId} not found`);
  }

  return site;
}

export async function defaultUrlResolver(site) {
  return composeAuditURL(site.getBaseURL());
}

export async function noopUrlResolver(site) {
  return site.getBaseURL();
}

async function assertAuditsDisabled(type, site, dataAccess) {
  const org = await dataAccess.getOrganizationByID(site.getOrganizationId());
  if (isAuditsDisabled(site, org, type)) {
    throw new Error(`${type} audits are disabled for the site: ${site.getId()}`);
  }
}

export class Audit {
  constructor(siteProvider, urlResolver, runner, persister, messageSender) {
    this.siteProvider = siteProvider;
    this.urlResolver = urlResolver;
    this.runner = runner;
    this.persister = persister;
    this.messageSender = messageSender;
  }

  async run(message, context) {
    const {
      type,
      auditContext = {},
    } = message;
    const siteId = message.url || message.siteId;
    const { dataAccess } = context;

    try {
      const site = await this.siteProvider(siteId, context);

      await assertAuditsDisabled(type, site, dataAccess);

      const finalUrl = await this.urlResolver(site);

      // run the audit business logic
      const {
        auditResult,
        fullAuditRef,
      } = await this.runner(finalUrl, context);

      const auditData = {
        siteId: site.getId(),
        isLive: site.isLive(),
        auditedAt: new Date().toISOString(),
        auditType: type,
        auditResult,
        fullAuditRef,
      };

      await this.persister(auditData, context);

      auditContext.finalUrl = finalUrl;

      const resultMessage = {
        type,
        url: site.getBaseURL(),
        auditContext,
        auditResult,
      };

      await this.messageSender(resultMessage, context);
      return ok();
    } catch (e) {
      throw new Error(`${type} audit failed for site ${siteId}. Reason: ${e.message}`);
    }
  }
}
