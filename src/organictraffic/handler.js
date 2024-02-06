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
import {
  isArray,
} from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '../support/ahrefs-client.js';
import { retrieveLatestAuditOfTypeForSite, retrieveSiteBySiteId } from '../utils/data-access.js';
import { hasNonWWWSubdomain } from '../apex/handler.js';
import { formatDate } from '../support/utils.js';

function useWWWOrSubdomain(baseUrl) {
  if (hasNonWWWSubdomain(baseUrl) || baseUrl.startsWith('https://www')) {
    return baseUrl;
  }
  return baseUrl.replace('https://', 'https://www.');
}

function getPreviousMonday(currentDate) {
  const day = currentDate.getDay();
  const diff = currentDate.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
  const lastMonday = new Date(currentDate.setDate(diff));
  return formatDate(lastMonday);
}

function getLatestDate(metrics) {
  if (!isArray(metrics) || metrics.length === 0) {
    return null;
  }

  return metrics.reduce((latest, metric) => {
    const metricDate = new Date(metric.date);
    return metricDate > latest ? metricDate : latest;
  }, new Date(metrics[0].date));
}

export default async function auditOrganicTraffic(message, context) {
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

    const latestAudit = await retrieveLatestAuditOfTypeForSite(dataAccess, siteId, type, log);
    const lastAuditDate = getLatestDate(latestAudit?.auditResult?.metrics);
    const startDate = getPreviousMonday(new Date(lastAuditDate || site.getIsLiveToggledAt()));
    const today = new Date();
    const endDate = getPreviousMonday(today);
    const url = useWWWOrSubdomain(site.getBaseURL());
    log.info(`Auditing ${type} for ${siteId} and url ${url} between ${startDate} and ${endDate}`);
    if (startDate === endDate) {
      log.info(`${siteId} already audited for ${type} type audit`);
      return noContent();
    }

    const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);

    let auditResult = {};
    let fullAuditRef;
    try {
      const fullResult = await ahrefsAPIClient.getOrganicTraffic(url, startDate, endDate);
      auditResult.metrics = fullResult?.result.metrics;
      fullAuditRef = fullResult?.fullAuditRef;
      log.info(`Found ${auditResult.metrics?.length} weeks between ${startDate} and ${endDate} for siteId: ${siteId} and url ${url}, full audit ref ${fullAuditRef}`);
    } catch (e) {
      log.error(`${type} type audit for ${siteId} with url ${url} failed with error: ${e.message}`, e);
      auditResult = {
        error: `${type} type audit for ${siteId} with url ${url} failed with error`,
      };
    }

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
