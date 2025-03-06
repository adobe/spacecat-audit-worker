/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { ok } from '@adobe/spacecat-shared-http-utils';
import { composeAuditURL, hasText } from '@adobe/spacecat-shared-utils';
import URI from 'urijs';

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { toggleWWWHostname } from '../support/utils.js';

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

export async function wwwUrlResolver(site, context) {
  const { log } = context;

  const baseURL = site.getBaseURL();
  const uri = new URI(baseURL);
  const hostname = uri.hostname();
  const subdomain = uri.subdomain();

  if (hasText(subdomain) && subdomain !== 'www') {
    return hostname;
  }

  const rumApiClient = RUMAPIClient.createFrom(context);

  try {
    const wwwToggledHostname = toggleWWWHostname(hostname);
    await rumApiClient.retrieveDomainkey(wwwToggledHostname);
    return wwwToggledHostname;
  } catch (e) {
    log.info(`Could not retrieved RUM domainkey for ${hostname}: ${e.message}`);
  }

  try {
    await rumApiClient.retrieveDomainkey(hostname);
    return hostname;
  } catch (e) {
    log.info(`Could not retrieved RUM domainkey for ${hostname}: ${e.message}`);
  }

  return hostname.startsWith('www.') ? hostname : `www.${hostname}`;
}

export async function noopUrlResolver(site) {
  return site.getBaseURL();
}

export const defaultPostProcessors = [];

export class BaseAudit {
  constructor(
    siteProvider,
    orgProvider,
    urlResolver,
    persister,
    messageSender,
    postProcessors,
  ) {
    this.siteProvider = siteProvider;
    this.orgProvider = orgProvider;
    this.urlResolver = urlResolver;
    this.persister = persister;
    this.messageSender = messageSender;
    this.postProcessors = postProcessors;
  }

  // Abstract method that subclasses must implement
  // eslint-disable-next-line class-methods-use-this,@typescript-eslint/no-unused-vars
  async run(message, context) {
    throw new Error('Subclasses must implement run()');
  }

  async processAuditResult(result, params, context) {
    const { type, site } = params;
    const { auditResult, fullAuditRef } = result;

    const auditData = {
      siteId: site.getId(),
      isLive: site.getIsLive(),
      auditedAt: new Date().toISOString(),
      auditType: type,
      auditResult,
      fullAuditRef,
    };

    const audit = await this.persister(auditData, context);
    context.audit = audit;
    return this.runPostProcessors(
      audit,
      result,
      // add auditId for the post-processing
      { ...params, auditData: { ...auditData, id: audit.getId() } },
      context,
    );
  }

  async runPostProcessors(audit, result, params, context) {
    const {
      type, site, finalUrl, auditData,
    } = params;
    const { auditResult, fullAuditRef } = result;
    const { log } = context;

    const resultMessage = {
      type,
      url: site.getBaseURL(),
      auditContext: {
        auditId: audit.getId(),
        finalUrl,
        fullAuditRef,
      },
      auditResult,
    };
    await this.messageSender(resultMessage, context);

    await this.postProcessors.reduce(async (previousProcessor, postProcessor) => {
      const updatedAuditData = await previousProcessor;

      try {
        const processedResult = await postProcessor(finalUrl, updatedAuditData, context, site);
        return processedResult || updatedAuditData;
      } catch (e) {
        log.error(`Post processor ${postProcessor.name} failed for ${type} audit failed for site ${site.getId()}. Reason: ${e.message}.\nAudit data: ${JSON.stringify(updatedAuditData)}`);
        throw e;
      }
    }, Promise.resolve(auditData));

    return ok();
  }
}
