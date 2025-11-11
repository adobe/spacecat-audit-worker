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
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import {
  startOfWeek, subWeeks, addDays, isAfter,
} from 'date-fns';
import { getImsOrgId } from '../utils/data-access.js';
import { SERVICE_PROVIDER_TYPES } from '../utils/cdn-utils.js';

/**
 * Fetches commerce-fastly service for given domain
 */
export async function fetchCommerceFastlyService(domain, { log }) {
  if (!domain || !process.env.LLMO_HLX_API_KEY) return null;

  try {
    const res = await fetch('https://main--project-elmo-ui-data--adobe.aem.live/adobe-managed-domains/commerce-fastly-domains.json?limit=5000', {
      headers: { 'User-Agent': 'spacecat-audit-worker', Authorization: `token ${process.env.LLMO_HLX_API_KEY}` },
    });

    if (!res.ok) return null;

    const { data: services } = await res.json();
    if (!Array.isArray(services)) return null;
    const { host } = new URL(domain);
    const trimmedHost = host.trim().replace(/^www\./, '');

    const service = services
      .find(
        (
          { domains: serviceDomains, ServiceName, ServiceID },
        ) => serviceDomains && ServiceName && ServiceID
          && serviceDomains.split(',').some((d) => {
            const cleanDomain = d.trim();
            return cleanDomain && (cleanDomain === trimmedHost
              || cleanDomain.includes(trimmedHost));
          }),
      );

    return service ? {
      serviceName: service.ServiceName,
      serviceId: service.ServiceID,
      matchedDomains: service.domains.split(',').map((d) => d.trim()).filter(Boolean),
    } : null;
  } catch (error) {
    log.error(`Error fetching commerce-fastly domains: ${error.message}`);
    return null;
  }
}

async function handleAdobeFastly(
  siteId,
  {
    dataAccess: { Configuration, LatestAudit },
    sqs,
    log,
  },
) {
  const config = await Configuration.findLatest();
  const auditQueue = config.getQueues().audits;

  // Skip CDN analysis if current site already has cdn-logs-analysis with fullAuditRef
  const cdnLogsAnalysis = await LatestAudit.findBySiteIdAndAuditType(siteId, 'cdn-logs-analysis');
  const hasCdnAnalysisWithResults = cdnLogsAnalysis
    && cdnLogsAnalysis.getAuditResult()?.providers?.length > 0
    && cdnLogsAnalysis.getFullAuditRef();

  if (hasCdnAnalysisWithResults) {
    log.info(`Skipping CDN analysis for site ${siteId} - site already has cdn-logs-analysis with results`);
  } else {
    // Queue CDN analysis from last Monday until today
    const lastMonday = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });
    const today = new Date();

    const analysisPromises = [];
    for (let date = new Date(lastMonday); !isAfter(date, today); date = addDays(date, 1)) {
      analysisPromises.push(sqs.sendMessage(auditQueue, {
        type: 'cdn-logs-analysis',
        siteId,
        auditContext: {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour: 8,
          processFullDay: true,
        },
      }));
    }

    await Promise.all(analysisPromises);
  }

  // Always queue CDN logs report with delay
  await sqs.sendMessage(auditQueue, {
    type: 'cdn-logs-report',
    siteId,
    auditContext: { weekOffset: -1 },
  }, null, 900);
}

async function handleBucketConfiguration(siteId, bucketName, pathId, { dataAccess: { Site } }) {
  const site = await Site.findById(siteId);
  const config = site.getConfig();

  config.updateLlmoCdnBucketConfig({
    ...(bucketName && { bucketName }),
    ...(pathId && { orgId: pathId }),
  });
  site.setConfig(Config.toDynamoItem(config));
  await site.save();
}

/**
 * Handles CDN bucket configuration changes
 */
export async function handleCdnBucketConfigChanges(context, data) {
  /* c8 ignore next */
  const { siteId } = context.params || {};
  const { cdnProvider, allowedPaths, bucketName } = data;
  const { dataAccess: { Configuration }, log } = context;

  if (!siteId) throw new Error('Site ID is required for CDN configuration');
  if (!cdnProvider) throw new Error('CDN provider is required for CDN configuration');

  const site = await context.dataAccess.Site.findById(siteId);
  if (!site) throw new Error(`Site with ID ${siteId} not found`);

  let pathId;

  if (allowedPaths && allowedPaths.length > 0) {
    const [firstPath] = allowedPaths;
    [pathId] = firstPath.split('/');
  }

  if (cdnProvider === SERVICE_PROVIDER_TYPES.COMMERCE_FASTLY) {
    const service = await fetchCommerceFastlyService(site.getBaseURL(), context);
    if (service) {
      pathId = service.serviceName;
    }
  }

  if (cdnProvider.includes('ams')) {
    if (cdnProvider === SERVICE_PROVIDER_TYPES.AMS_CLOUDFRONT) {
      const imsOrgId = await getImsOrgId(site, context.dataAccess, log);
      if (imsOrgId) {
        pathId = imsOrgId.replace('@', ''); // Remove @ for filesystem-safe path
      }
    }
  }

  // Set bucket configuration
  if (bucketName || pathId) {
    await handleBucketConfiguration(siteId, bucketName, pathId, context);
  }

  // enable cdn-logs-analysis audit
  const configuration = await Configuration.findLatest();
  configuration.enableHandlerForSite('cdn-logs-analysis', site);
  await configuration.save();

  // Run analysis and reporting for CS fastly customers
  if (cdnProvider === SERVICE_PROVIDER_TYPES.AEM_CS_FASTLY) {
    await handleAdobeFastly(siteId, context);
  }
}
