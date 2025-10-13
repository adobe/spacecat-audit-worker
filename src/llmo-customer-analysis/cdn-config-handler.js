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
import { composeBaseURL } from '@adobe/spacecat-shared-utils';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import {
  startOfWeek, subWeeks, addDays, isAfter,
} from 'date-fns';
import { getImsOrgId } from '../utils/data-access.js';
import { SERVICE_PROVIDER_TYPES } from '../utils/cdn-utils.js';

/**
 * Enables CDN analysis for one domain per service
 */
export async function enableCdnAnalysisPerService(serviceName, domains, context) {
  const { log, dataAccess: { Site, LatestAudit, Configuration } } = context;

  if (!domains?.length) return null;

  try {
    const domainStatuses = await Promise.all(
      domains
        .filter(Boolean)
        .map(async (domain) => {
          try {
            const site = await Site.findByBaseURL(composeBaseURL(`https://${domain}`));
            if (!site) return null;

            const hasAnalysis = await LatestAudit?.findBySiteIdAndAuditType(site.getId(), 'cdn-analysis');
            return { domain, site, enabled: hasAnalysis?.length > 0 };
          } catch (error) {
            log.error(`Error processing domain ${domain}:`, error.message);
            return null;
          }
        }),
    );

    const validDomains = domainStatuses.filter(Boolean);
    if (!validDomains.length) return { enabled: false, serviceName, message: 'No valid domains found' };

    const enabledDomains = validDomains.filter((d) => d.enabled);
    const config = await Configuration.findLatest();

    // More than one enabled: disable all
    if (enabledDomains.length > 1) {
      enabledDomains.forEach(({ site }) => config.disableHandlerForSite('cdn-analysis', site));
      await config.save();
      return { enabled: false, serviceName, message: `Disabled ${enabledDomains.length} domains` };
    }

    // Exactly one enabled: leave it
    if (enabledDomains.length === 1) {
      const existing = enabledDomains[0];
      return {
        enabled: false, serviceName, domain: existing.domain, message: `Already enabled: ${existing.domain}`,
      };
    }

    // None enabled: enable first available
    const firstDomain = validDomains[0];
    config.enableHandlerForSite('cdn-analysis', firstDomain.site);
    await config.save();
    return {
      enabled: true, serviceName, domain: firstDomain.domain, message: `Enabled: ${firstDomain.domain}`,
    };
  } catch (error) {
    log.error(`CDN analysis enablement failed for service ${serviceName}:`, error.message);
    throw error;
  }
}

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

// Enables cdn-analysis audit for first site in org only
async function enableCdnAnalysisPerOrg(site, { dataAccess: { Configuration, Site } }) {
  const [config, sitesInOrg] = await Promise.all([
    Configuration.findLatest(),
    Site.allByOrganizationId(site.getOrganizationId()),
  ]);

  if (!sitesInOrg.some((s) => config.isHandlerEnabledForSite('cdn-analysis', s))) {
    config.enableHandlerForSite('cdn-analysis', site);
    await config.save();
  }
}

async function handleAdobeFastly(siteId, { dataAccess: { Configuration, LatestAudit }, sqs }) {
  // Skip if CDN logs report already exists
  const existingAnalysis = await LatestAudit?.findBySiteIdAndAuditType(siteId, 'cdn-analysis');
  if (existingAnalysis?.length > 0 && existingAnalysis[0]?.fullAuditRef?.length > 0) return;

  const config = await Configuration.findLatest();
  const auditQueue = config.getQueues().audits;

  // Queue CDN analysis from last Monday until today
  const lastMonday = startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 });
  const today = new Date();

  const analysisPromises = [];
  for (let date = new Date(lastMonday); !isAfter(date, today); date = addDays(date, 1)) {
    analysisPromises.push(sqs.sendMessage(auditQueue, {
      type: 'cdn-analysis',
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

  // Queue CDN logs report with delay
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
      await enableCdnAnalysisPerService(service.serviceName, service.matchedDomains, context);
    }
  }

  if (cdnProvider.includes('ams')) {
    if (cdnProvider === SERVICE_PROVIDER_TYPES.AMS_CLOUDFRONT) {
      const imsOrgId = await getImsOrgId(site, context.dataAccess, log);
      if (imsOrgId) {
        pathId = imsOrgId.replace('@', ''); // Remove @ for filesystem-safe path
      }
    }
    await enableCdnAnalysisPerOrg(site, context);
  }

  // Set bucket configuration
  if (bucketName || pathId) {
    await handleBucketConfiguration(siteId, bucketName, pathId, context);
  }

  // Enable audits and run analysis
  if (cdnProvider === SERVICE_PROVIDER_TYPES.AEM_CS_FASTLY) {
    await Promise.all([
      enableCdnAnalysisPerOrg(site, context),
      handleAdobeFastly(siteId, context),
    ]);
  }

  if (cdnProvider?.includes('byocdn')) {
    const configuration = await Configuration.findLatest();
    configuration.enableHandlerForSite('cdn-analysis', site);
    await configuration.save();
  }
}
