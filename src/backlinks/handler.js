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
import { composeAuditURL } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { AbortController, AbortError } from '@adobe/fetch';
import { InvokeCommand, LambdaClient, LogType } from '@aws-sdk/client-lambda';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { findSitemap } from '../sitemap/handler.js';
// import { enhanceBacklinksWithFixes, fetch } from '../support/utils.js';

const TIMEOUT = 3000;

export async function filterOutValidBacklinks(backlinks, log) {
  const fetchWithTimeout = async (url, timeout) => {
    const controller = new AbortController();
    const { signal } = controller;
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, { signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      if (error instanceof AbortError) {
        log.warn(`Request to ${url} timed out after ${timeout}ms`);
        return { ok: false, status: 408 };
      }
    } finally {
      clearTimeout(id);
    }
    return null;
  };

  const isStillBrokenBacklink = async (backlink) => {
    try {
      const response = await fetchWithTimeout(backlink.url_to, TIMEOUT);
      if (!response.ok && response.status !== 404
        && response.status >= 400 && response.status < 500) {
        log.warn(`Backlink ${backlink.url_to} returned status ${response.status}`);
      }
      return !response.ok;
    } catch (error) {
      log.error(`Failed to check backlink ${backlink.url_to}: ${error.message}`);
      return true;
    }
  };

  const backlinkStatuses = await Promise.all(backlinks.map(isStillBrokenBacklink));
  return backlinks.filter((_, index) => backlinkStatuses[index]);
}

async function enhanceBacklinksWithGenAI(siteId, brokenBacklinks, sitemapUrls) {
  const invoke = async (funcName, payload) => {
    const client = new LambdaClient({
      region: 'us-east-1',
    });
    const command = new InvokeCommand({
      FunctionName: funcName,
      Payload: JSON.stringify(payload),
      LogType: LogType.Tail,
    });

    const { Payload, LogResult } = await client.send(command);
    const result = Buffer.from(Payload).toString();
    console.log(`Result: ${JSON.stringify(result)}`);
    console.log(`LogResult: ${JSON.stringify(LogResult)}`);
    const logs = Buffer.from(LogResult, 'base64').toString();

    return { result, logs };
  };

  const payload = {
    type: 'broken-backlinks',
    siteId,
    brokenBacklinks,
    sitemapUrls,
  };

  try {
    console.log(`Calling genai with payload: ${JSON.stringify(payload)}`);
    const { result } = await invoke('spacecat-services--genai', payload);

    return result;
  } catch (error) {
    console.error(error);
    return { error };
  }
}

export default async function auditBrokenBacklinks(message, context) {
  const { type, url: siteId, auditContext = {} } = message;
  const { dataAccess, log } = context;

  try {
    log.info(`Received ${type} audit request for siteId: ${siteId}`);

    const site = await retrieveSiteBySiteId(dataAccess, siteId, log);
    if (!site) {
      return notFound('Site not found');
    }

    if (!site.isLive()) {
      log.info(`Site ${siteId} is not live`);
      return ok();
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

    try {
      auditContext.finalUrl = await composeAuditURL(site.getBaseURL());
    } catch (e) {
      log.error(`Get final URL for siteId ${siteId} failed with error: ${e.message}`, e);
      return internalServerError(`Internal server error: ${e.message}`);
    }

    let auditResult;
    try {
      const {
        result,
        fullAuditRef,
      } = await ahrefsAPIClient.getBrokenBacklinks(auditContext.finalUrl);
      log.info(`Found ${result?.backlinks?.length} broken backlinks for siteId: ${siteId} and url ${auditContext.finalUrl}`);

      const excludedURLs = auditConfig.getAuditTypeConfig(type)?.getExcludedURLs();
      const filteredBacklinks = result?.backlinks?.filter(
        (backlink) => !excludedURLs.includes(backlink.url_to),
      );

      const brokenBacklinks = await filterOutValidBacklinks(filteredBacklinks, log);
      const baseUrl = site.getBaseURL();
      const sitemaps = await findSitemap(baseUrl);
      const sitemapUrls = Object.values(sitemaps.paths).reduce((acc, curr) => acc.concat(curr), []);

      // const topPages = await dataAccess.getTopPagesForSite(siteId, 'ahrefs', 'global');
      // const keywords = topPages.map(
      //   (page) => (
      //     { url: page.getURL(), keyword: page.getTopKeyword(), traffic: page.getTraffic() }
      //   ),
      // );

      // const enhancedBacklinks = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);
      // eslint-disable-next-line max-len
      const enhancedBacklinks = await enhanceBacklinksWithGenAI(siteId, brokenBacklinks, sitemapUrls);

      log.info(`Enhanced backlinks: ${JSON.stringify(enhancedBacklinks)}`);

      auditResult = {
        finalUrl: auditContext.finalUrl,
        brokenBacklinks,
        fullAuditRef,
      };
    } catch (e) {
      log.error(`${type} type audit for ${siteId} with url ${auditContext.finalUrl} failed with error: ${e.message}`, e);
      auditResult = {
        finalUrl: auditContext.finalUrl,
        error: `${type} type audit for ${siteId} with url ${auditContext.finalUrl} failed with error`,
      };
    }

    const auditData = {
      siteId: site.getId(),
      isLive: site.isLive(),
      auditedAt: new Date().toISOString(),
      auditType: type,
      fullAuditRef: auditResult?.fullAuditRef,
      auditResult,
    };

    // await dataAccess.addAudit(auditData);
    // const data = {
    //   type,
    //   url: site.getBaseURL(),
    //   auditContext,
    //   auditResult,
    // };
    // await sqs.sendMessage(queueUrl, data);
    //
    log.info(`auditData ${JSON.stringify(auditData)}`);
    log.info(`Successfully audited ${siteId} for ${type} type audit`);
    return noContent();
  } catch (e) {
    log.error(`${type} type audit for ${siteId} failed with error: ${e.message}`, e);
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
