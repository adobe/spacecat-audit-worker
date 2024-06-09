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

import { S3Client } from '@aws-sdk/client-s3';
import {
  internalServerError, noContent, notFound, ok,
} from '@adobe/spacecat-shared-http-utils';
import { composeAuditURL } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { retrieveSiteBySiteId } from '../utils/data-access.js';
import { extractKeywordsFromUrl, fetch, getStoredMetrics } from '../support/utils.js';

export async function filterOutValidBacklinks(backlinks, log) {
  const isStillBrokenBacklink = async (backlink) => {
    try {
      const response = await fetch(backlink.url_to);
      if (!response.ok && response.status !== 404
        && response.status >= 400 && response.status < 500) {
        log.warn(`Backlink ${backlink.url_to} returned status ${response.status}`);
      }
      return !response.ok;
    } catch (error) {
      log.error(`Failed to check backlink ${backlink.url_to}: ${error}`);
      return true;
    }
  };

  const backlinkStatuses = await Promise.all(backlinks.map(isStillBrokenBacklink));
  return backlinks.filter((_, index) => backlinkStatuses[index]);
}

export default async function auditBrokenBacklinks(message, context) {
  const { type, url: siteId, auditContext = {} } = message;
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

      // const brokenBacklinks = await filterOutValidBacklinks(result?.backlinks, log);
      const brokenBacklinks = result?.backlinks;

      const s3Client = new S3Client(context);
      const keywords = await getStoredMetrics(s3Client, { siteId, source: 'ahrefs', metric: 'organic-keywords' }, context);

      for (const backlink of brokenBacklinks) {
        log.info(`trying to find redirect for: ${backlink.url_to}`);
        const extractedKeywords = extractKeywordsFromUrl(backlink.url_to);
        let filteredData = keywords.filter(
          (entry) => extractedKeywords.some((k) => entry.keyword.includes(k)),
        );

        // try again and split extracted keywords that have multiple words
        if (filteredData.length === 0) {
          const splitKeywords = extractedKeywords.map((keyword) => keyword.split(' ')).flat();
          filteredData = keywords.filter(
            (entry) => splitKeywords.some((k) => entry.keyword.includes(k)),
          );
        }

        // sort by traffic
        filteredData.sort((a, b) => b.traffic - a.traffic);

        if (filteredData.length > 0) {
          log.info(`found ${filteredData.length} keywords for backlink ${backlink.url_to}`);
          backlink.url_suggested = filteredData[0].url;
        } else {
          log.info(`could not find suggested URL for backlink ${backlink.url_to} with keywords ${extractedKeywords.join(', ')}`);
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

    await dataAccess.addAudit(auditData);

    await sqs.sendMessage(queueUrl, {
      type,
      url: site.getBaseURL(),
      auditContext,
      auditResult,
    });

    log.info(`Successfully audited ${siteId} for ${type} type audit`);
    return noContent();
  } catch (e) {
    log.error(`${type} type audit for ${siteId} failed with error: ${e.message}`, e);
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
