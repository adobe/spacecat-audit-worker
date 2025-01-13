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

import { composeAuditURL, hasText } from '@adobe/spacecat-shared-utils';
import { ok } from '@adobe/spacecat-shared-http-utils';
import URI from 'urijs';
import { retrieveSiteBySiteId } from '../utils/data-access.js';

// eslint-disable-next-line no-empty-function
export async function defaultMessageSender() {}

export async function defaultPersister(auditData, context) {
  const { dataAccess } = context;
  const { Audit } = dataAccess;
  return Audit.create(auditData);
}

export async function noopPersister(auditData) {
  return { getId: () => auditData.id || 'noop' };
}

export async function defaultSiteProvider(siteId, context) {
  const { log, dataAccess } = context;

  const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
  if (!site) {
    throw new Error(`Site with id ${siteId} not found`);
  }

  return site;
}

export async function defaultOrgProvider(orgId, context) {
  const { dataAccess } = context;
  const { Organization } = dataAccess;

  const org = await Organization.findById(orgId);
  if (!org) {
    throw new Error(`Org with id ${orgId} not found`);
  }

  return org;
}

export async function defaultUrlResolver(site) {
  return composeAuditURL(site.getBaseURL());
}

export function wwwUrlResolver(site) {
  const baseURL = site.getBaseURL();
  const uri = new URI(baseURL);
  return hasText(uri.subdomain()) ? baseURL.replace(/https?:\/\//, '') : baseURL.replace(/https?:\/\//, 'www.');
}

export async function noopUrlResolver(site) {
  return site.getBaseURL();
}

export const defaultPostProcessors = [];

export class Audit {
  constructor(
    siteProvider,
    orgProvider,
    urlResolver,
    runner,
    persister,
    messageSender,
    postProcessors,
  ) {
    this.siteProvider = siteProvider;
    this.orgProvider = orgProvider;
    this.urlResolver = urlResolver;
    this.runner = runner;
    this.persister = persister;
    this.messageSender = messageSender;
    this.postProcessors = postProcessors;
  }

  async run(message, context) {
    const { log, dataAccess } = context;
    const { Configuration } = dataAccess;
    const {
      type,
      siteId,
      auditContext = {},
    } = message;

    try {
      const site = await this.siteProvider(siteId, context);
      const configuration = await Configuration.findLatest();
      if (!configuration.isHandlerEnabledForSite(type, site)) {
        log.warn(`${type} audits disabled for site ${siteId}, skipping...`);
        return ok();
      }
      const finalUrl = await this.urlResolver(site);

      // run the audit business logic
      const {
        auditResult,
        fullAuditRef,
      } = await this.runner(finalUrl, context, site);
      const auditData = {
        siteId: site.getId(),
        isLive: site.getIsLive(),
        auditedAt: new Date().toISOString(),
        auditType: type,
        auditResult,
        fullAuditRef,
      };
      const audit = await this.persister(auditData, context);
      auditContext.finalUrl = finalUrl;
      auditContext.fullAuditRef = fullAuditRef;

      const resultMessage = {
        type,
        url: site.getBaseURL(),
        auditContext,
        auditResult,
      };

      await this.messageSender(resultMessage, context);
      // add auditId for the post-processing
      auditData.id = audit.getId();
      for (const postProcessor of this.postProcessors) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await postProcessor(finalUrl, auditData, context, site);
        } catch (e) {
          log.error(`Post processor ${postProcessor.name} failed for ${type} audit failed for site ${siteId}. Reason: ${e.message}.\nAudit data: ${JSON.stringify(auditData)}`);
          throw e;
        }
      }

      return ok();
    } catch (e) {
      throw new Error(`${type} audit failed for site ${siteId}. Reason: ${e.message}`);
    }
  }
}
