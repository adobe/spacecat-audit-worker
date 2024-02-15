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

import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { getRUMUrl } from '../support/utils.js';

export async function defaultMessageSender(resultMessage, context) {
  const { sqs } = context;
  const { AUDIT_RESULTS_QUEUE_URL: queueUrl } = context;

  await sqs.sendMessage(queueUrl, resultMessage);
}

export async function defaultPersister(auditData, context) {
  const { dataAccess } = context;
  await dataAccess.addAudit(auditData);
}

export async function defaultSiteProvider(message, lambdaContext) {
  const { type, url: siteId } = message;
  const { log, dataAccess } = lambdaContext;

  const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
  if (!site) {
    throw Error('Site not found');
  }

  if (!site.isLive()) {
    throw Error(`Site ${siteId} is not live`);
  }

  const auditConfig = site.getAuditConfig();
  if (auditConfig.auditsDisabled()) {
    throw Error(`Audits disabled for site ${siteId}`);
  }

  if (auditConfig.getAuditTypeConfig(type)?.disabled()) {
    throw Error(`Audit type ${type} disabled for site ${siteId}`);
  }

  return site;
}

export async function defaultUrlResolver(site) {
  return site.getBaseURL();
}
export async function followRedirects(site) {
  return getRUMUrl(site.getBaseURL());
}

export async function noopAuditStep() {
  // no-op
  return {};
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
    const { type, url: siteId, auditContext } = message;

    const site = await this.siteProvider(siteId, context);
    const finalUrl = this.urlResolver(site);

    // run the audit business logic
    const { auditResult, fullAuditRef } = this.runner(finalUrl, context);

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
  }
}
