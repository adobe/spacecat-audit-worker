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
import { composeAuditURL, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { AbortController, AbortError } from '@adobe/fetch';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { enhanceBacklinksWithFixes } from '../support/utils.js';

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

export default async function auditBrokenBacklinks(message, context) {
  const { type, auditContext = {} } = message;
  const { dataAccess, log, sqs } = context;
  const {
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;
  const siteId = message.url || message.siteId;
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
    const configuration = await dataAccess.getConfiguration();
    if (!configuration.isHandlerEnabledForSite(type, site)) {
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
      const excludedURLs = site.getConfig().getExcludedURLs(type);
      const filteredBacklinks = result?.backlinks?.filter(
        (backlink) => !excludedURLs?.includes(backlink.url_to),
      );
      let brokenBacklinks = await filterOutValidBacklinks(filteredBacklinks, log);

      if (configuration.isHandlerEnabledForSite(`${type}-auto-suggest`, site)) {
        try {
          const topPages = await dataAccess.getTopPagesForSite(siteId, 'ahrefs', 'global');
          const keywords = topPages.map(
            (page) => ({
              url: page.getURL(),
              keyword: page.getTopKeyword(),
              traffic: page.getTraffic(),
            }),
          );
          brokenBacklinks = enhanceBacklinksWithFixes(brokenBacklinks, keywords, log);
        } catch (e) {
          log.error(`Enhancing backlinks with fixes for siteId ${siteId} failed with error: ${e.message}`, e);
        }
      }

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

    const audit = await dataAccess.addAudit(auditData);
    const data = {
      type,
      url: site.getBaseURL(),
      auditContext,
      auditResult,
    };

    const opportunities = await dataAccess.Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    let brokenBacklinksOppty = opportunities.find((oppty) => oppty.getType() === 'broken-backlinks');

    if (!brokenBacklinksOppty) {
      const opportunityData = {
        siteId: site.getId(),
        auditId: audit.getId(),
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/doc2.aspx?sourcedoc=%7BAC174971-BA97-44A9-9560-90BE6C7CF789%7D&file=Experience_Success_Studio_Broken_Backlinks_Runbook.docx&action=default&mobileredirect=true',
        type: 'broken-backlinks',
        origin: 'AUTOMATION',
        title: 'Authoritative Domains are linking to invalid URLs. This could impact your SEO.',
        description: 'Provide the correct target URL that each of the broken backlinks should be redirected to.',
        guidance: {
          steps: [
            'Review the list of broken target URLs and the suggested redirects.',
            'Manually override redirect URLs as needed.',
            'Copy redirects.',
            'Paste new entries in your website redirects file.',
            'Publish the changes.',
          ],
        },
        tags: ['traffic-acquisition'],
      };
      brokenBacklinksOppty = await dataAccess.Opportunity.create(opportunityData);
    } else {
      brokenBacklinksOppty = brokenBacklinksOppty.setAuditId(audit.getId());
    }

    const suggestions = await brokenBacklinksOppty.addSuggestions(data.auditResult.brokenBacklinks);
    if (suggestions.errorItems.length > 0) {
      log.error(`Suggestions for siteId ${siteId} contains ${suggestions.errorItems.length} items with errors`);
      suggestions.errorItems.forEach((errorItem) => {
        log.error(`Item ${errorItem.item} failed with error: ${errorItem.error}`);
      });
      if (suggestions.createdItems.length <= 0) {
        return internalServerError(`Failed to create suggestions for siteId ${siteId}`);
      }
    }
    await sqs.sendMessage(queueUrl, data);

    log.info(`Successfully audited ${siteId} for ${type} type audit`);
    return noContent();
  } catch (e) {
    log.error(`${type} type audit for ${siteId} failed with error: ${e.message}`, e);
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
