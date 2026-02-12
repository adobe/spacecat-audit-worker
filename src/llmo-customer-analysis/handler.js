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

import {
  getLastNumberOfWeeks, isNonEmptyObject, llmoConfig,
} from '@adobe/spacecat-shared-utils';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { isAuditEnabledForSite } from '../common/audit-utils.js';
import {
  getLastSunday, compareConfigs, areCategoryNamesDifferent,
} from './utils.js';
import { getRUMUrl } from '../support/utils.js';
import { handleCdnBucketConfigChanges } from './cdn-config-handler.js';
import { sendOnboardingNotification } from './onboarding-notifications.js';
import { ContentAIClient } from '../utils/content-ai.js';

const REFERRAL_TRAFFIC_AUDIT = 'llmo-referral-traffic';
const REFERRAL_TRAFFIC_IMPORT = 'traffic-analysis';

const GEO_FREE_SPLIT_COUNT = 18;
const GEO_FREE_SPLITS = Array.from(
  { length: GEO_FREE_SPLIT_COUNT },
  (_, i) => `geo-brand-presence-free-${i + 1}`,
);

/**
 * Finds the geo-brand-presence-free split with the fewest enabled sites.
 * @param {object} configuration - Configuration instance
 * @returns {string} The split audit type to assign
 */
function findBestFreeSplit(configuration) {
  let bestSplit = GEO_FREE_SPLITS[0];
  let minCount = Infinity;

  for (const split of GEO_FREE_SPLITS) {
    const count = configuration.getEnabledSiteIdsForHandler(split).length;
    if (count < minCount) {
      minCount = count;
      bestSplit = split;
      if (count === 0) break;
    }
  }

  return bestSplit;
}

/* c8 ignore start */
/* this is actually running during tests. verified manually on 2025-12-10. */
/**
 * @param {object} site A site object
 * @param {object} context The request context object
 * @param {string[]} audits Array of audit types to enable
 * @param {object} [options]
 * @param {object} [options.configuration] A global configuration object.
 */
async function enableAudits(site, context, audits = [], options = undefined) {
  const { dataAccess } = context;
  const { Configuration } = dataAccess;

  const configuration = options?.configuration ?? await Configuration.findLatest();

  let hasChanges = false;
  audits.forEach((audit) => {
    if (!configuration.isHandlerEnabledForSite(audit, site)) {
      configuration.enableHandlerForSite(audit, site);
      hasChanges = true;
    }
  });

  if (hasChanges) {
    await configuration.save();
  }
  /* c8 ignore stop */
}

async function enableImports(siteId, context, imports = []) {
  const { dataAccess: { Site }, log } = context;

  const site = await Site.findById(siteId);
  const siteConfig = site.getConfig();

  let hasChanges = false;
  imports.forEach(({ type, options }) => {
    if (!siteConfig.isImportEnabled(type, options)) {
      siteConfig.enableImport(type, options);
      hasChanges = true;
    }
  });

  if (hasChanges) {
    log.info(`Enabling imports for site ${siteId}`);
    site.setConfig(Config.toDynamoItem(siteConfig));
    await site.save();
  }
}

async function checkOptelData(domain, context) {
  const { log } = context;
  const rumAPIClient = RUMAPIClient.createFrom(context);

  try {
    const url = await getRUMUrl(domain);
    const options = {
      domain: url,
    };
    const { pageviews } = await rumAPIClient.query('pageviews', options);
    return pageviews > 0;
  } catch (error) {
    log.error(`Failed to check OpTel data for domain ${domain}: ${error.message}`);
    return false;
  }
}

export async function triggerReferralTrafficImports(context, site) {
  const { sqs, dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const siteId = site.getSiteId();
  const last4Weeks = getLastNumberOfWeeks(4);

  log.info(`Triggering ${last4Weeks.length} referral traffic imports for site: ${siteId}`);

  for (const week of last4Weeks) {
    const referralMessage = {
      type: REFERRAL_TRAFFIC_IMPORT,
      siteId,
      auditContext: {
        auditType: REFERRAL_TRAFFIC_AUDIT,
        week: week.week,
        year: week.year,
      },
    };
    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(configuration.getQueues().imports, referralMessage);
  }

  log.info(`Successfully triggered ${last4Weeks.length} referral traffic imports`);
}

export async function triggerCdnLogsReport(context, site) {
  const { sqs, dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const siteId = site.getSiteId();

  log.info(`Triggering cdn-logs-report audit for site: ${siteId}`);

  // first send with categoriesUpdated flag for last week
  await sqs.sendMessage(configuration.getQueues().audits, {
    type: 'cdn-logs-report',
    siteId,
    auditContext: {
      weekOffset: -1,
      categoriesUpdated: true,
    },
  });

  log.info('Successfully triggered cdn-logs-report audit');
}

export async function triggerGeoBrandPresence(context, site, auditContext = {}) {
  const { sqs, dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const siteId = site.getSiteId();

  // Priority: auditContext > site config > default
  const cadence = auditContext?.brandPresenceCadence
    || site.getConfig()?.getBrandPresenceCadence?.()
    || 'weekly';

  const auditType = cadence === 'daily' ? 'geo-brand-presence-daily' : 'geo-brand-presence';

  log.info(`Triggering ${auditType} audit for site: ${siteId} (cadence: ${cadence})`);

  // Check if the selected audit type is enabled
  const isAuditEnabled = await isAuditEnabledForSite(auditType, site, context);
  if (!isAuditEnabled) {
    log.warn(`${auditType} audit is not enabled for site ${siteId}, skipping geo-brand-presence trigger`);
    return;
  }

  // Optional: Warn if the opposite audit type is also enabled
  const oppositeAuditType = cadence === 'daily' ? 'geo-brand-presence' : 'geo-brand-presence-daily';
  const isOppositeEnabled = await isAuditEnabledForSite(oppositeAuditType, site, context);
  if (isOppositeEnabled) {
    log.warn(`Both ${auditType} and ${oppositeAuditType} are enabled for site ${siteId}. Consider disabling ${oppositeAuditType} to avoid duplicate processing.`);
  }

  const geoBrandPresenceMessage = {
    type: auditType,
    siteId,
    data: getLastSunday(),
  };

  await sqs.sendMessage(configuration.getQueues().audits, geoBrandPresenceMessage);

  log.info(`Successfully triggered ${auditType} audit`);
}

export async function triggerGeoBrandPresenceRefresh(context, site, configVersion) {
  const { sqs, dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const auditType = 'geo-brand-presence-trigger-refresh';
  const siteId = site.getSiteId();

  log.info('Triggering %s audit for site: %s', auditType, siteId);

  await sqs.sendMessage(configuration.getQueues().audits, {
    type: auditType,
    siteId,
    auditContext: { configVersion },
  });
  log.info(`Successfully triggered ${auditType} audit`);
}

async function triggerAllSteps(context, site, log, triggeredSteps, auditContext = {}) {
  log.info('Triggering all relevant audits (no config version provided or first-time setup)');

  await triggerGeoBrandPresence(context, site, auditContext);
  triggeredSteps.push(auditContext?.brandPresenceCadence === 'daily' ? 'geo-brand-presence-daily' : 'geo-brand-presence');
}

async function triggerMystiqueCategorization(context, siteId, domain) {
  const {
    env, log, s3Client,
  } = context;

  const s3Bucket = env.S3_IMPORTER_BUCKET_NAME;
  const mystiqueApiBaseUrl = env.MYSTIQUE_API_BASE_URL;
  const categorizationEndpoint = `${mystiqueApiBaseUrl}/v1/categorization/site`;

  const {
    config,
    exists,
  } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket });

  if (exists && isNonEmptyObject(config.categories)) {
    log.info('Config categories already exist; skipping Mystique categorization');
    return;
  }

  log.info(`Triggering Mystique categorization for siteId: ${siteId}, domain: ${domain}`);
  const imsContext = {
    log,
    env: {
      IMS_HOST: env.IMS_HOST,
      IMS_CLIENT_ID: env.IMS_CLIENT_ID,
      IMS_CLIENT_CODE: env.IMS_CLIENT_CODE,
      IMS_CLIENT_SECRET: env.IMS_CLIENT_SECRET,
    },
  };
  const imsClient = ImsClient.createFrom(imsContext);
  const { access_token: accessToken } = await imsClient.getServiceAccessToken();

  try {
    const response = await fetch(categorizationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: accessToken,
      },
      body: JSON.stringify({
        url: domain,
      }),
      timeout: 60000,
    });

    const data = await response.json();
    const { categories } = data.categories;
    config.categories = categories;
    await llmoConfig.writeConfig(siteId, config, s3Client, { s3Bucket });
  } catch (error) {
    log.error(`Failed to trigger Mystique categorization: ${error.message}`);
  }
}

async function getBaseUrlBySiteId(siteId, context) {
  const { dataAccess, log } = context;
  const { Site } = dataAccess;

  try {
    const site = await Site.findById(siteId);
    /* c8 ignore next */
    return site?.getBaseURL() || '';
  } catch /* c8 ignore start */ {
    log.info(`Unable to fetch base URL for siteId: ${siteId}`);
    return '';
  } /* c8 ignore stop */
}

export async function runLlmoCustomerAnalysis(finalUrl, context, site, auditContext = {}) {
  const {
    env, log, s3Client,
  } = context;

  const siteId = site.getSiteId();
  const domain = finalUrl;

  // Ensure relevant audits and imports are enabled
  try {
    const { Configuration } = context.dataAccess;
    const configuration = await Configuration.findLatest();

    const auditsToEnable = [
      'scrape-top-pages',
      'headings',
      'llm-blocked',
      'llm-error-pages',
      'summarization',
      'faqs',
      REFERRAL_TRAFFIC_AUDIT,
      'cdn-logs-report',
      'readability',
      'wikipedia-analysis',
    ];
    const [isDailyEnabled, isPaidEnabled] = await Promise.all([
      configuration.isHandlerEnabledForSite('geo-brand-presence-daily', site),
      configuration.isHandlerEnabledForSite('geo-brand-presence-paid', site),
    ]);

    // don't tamper with configuration if daily geo brand presence is already enabled.
    if (!isDailyEnabled) {
      auditsToEnable.push('geo-brand-presence');
      // only enable free geo brand presence if paid is not already enabled
      if (!isPaidEnabled) {
        const targetSplit = findBestFreeSplit(configuration);
        auditsToEnable.push(targetSplit);
      }
    }

    await enableAudits(site, context, auditsToEnable, { configuration });
  } catch (error) {
    log.error(`Failed to enable audits for site ${siteId}: ${error.message}`);
  }

  // Enable ContentAI for the site
  try {
    const contentAIClient = new ContentAIClient(context);
    await contentAIClient.initialize();
    await contentAIClient.createConfiguration(site);
    log.info(`Successfully processed ContentAI for site ${siteId}`);
  } catch (error) {
    log.error(`Failed to process ContentAI for site ${siteId}: ${error.message}`);
  }

  try {
    await enableImports(siteId, context, [
      { type: REFERRAL_TRAFFIC_IMPORT },
      { type: 'llmo-prompts-ahrefs', options: { limit: 25 } },
      { type: 'top-pages' },
    ]);
  } catch (error) {
    log.error(`Failed to enable imports for site ${siteId}: ${error.message}`);
  }

  log.info(`Starting LLMO customer analysis for site: ${siteId}, domain: ${domain}`);

  const triggeredSteps = [];
  const hasOptelData = await checkOptelData(domain, context);
  const { configVersion, previousConfigVersion } = auditContext;
  const isFirstTimeOnboarding = !previousConfigVersion;

  if (isFirstTimeOnboarding) {
    await triggerMystiqueCategorization(context, siteId, domain);
    await sendOnboardingNotification(context, site, 'first_onboarding');
  }

  // Handle referral traffic imports for first-time onboarding
  if (hasOptelData && isFirstTimeOnboarding) {
    log.info('First-time LLMO onboarding detected with OpTel data; initiating referral traffic import for the last 4 full calendar weeks');
    await triggerReferralTrafficImports(context, site);
    triggeredSteps.push(REFERRAL_TRAFFIC_IMPORT);
  } else if (hasOptelData && !isFirstTimeOnboarding) {
    log.info('Subsequent LLMO config update detected; skipping historical referral traffic imports (only triggered on first-time onboarding)');
  } else {
    log.info('Domain has no OpTel data available; skipping referral traffic import');
  }

  // If no config version provided, trigger all steps
  if (!configVersion) {
    log.info('No config version provided; triggering all relevant audits');
    await triggerAllSteps(context, site, log, triggeredSteps, auditContext);

    return {
      auditResult: {
        status: 'completed',
        configChangesDetected: true,
        message: 'All audits triggered (no config version provided)',
        triggeredSteps,
        previousConfigVersion,
        configVersion,
      },
      fullAuditRef: finalUrl,
    };
  }

  // Fetch and compare configs
  log.info(`Fetching LLMO config versions - current: ${configVersion}, previous: ${previousConfigVersion || 'none'}`);

  const s3Bucket = env.S3_IMPORTER_BUCKET_NAME;
  const newConfigResult = await llmoConfig.readConfig(
    siteId,
    s3Client,
    { s3Bucket, version: configVersion },
  );
  const newConfig = newConfigResult.config;
  let oldConfig;

  if (previousConfigVersion) {
    const oldConfigResult = await llmoConfig.readConfig(
      siteId,
      s3Client,
      { s3Bucket, version: previousConfigVersion },
    );
    oldConfig = oldConfigResult.config;
  } else {
    oldConfig = llmoConfig.defaultConfig();
  }

  const changes = compareConfigs(oldConfig ?? {}, newConfig ?? {});
  const hasCdnLogsChanges = changes.categories
    && areCategoryNamesDifferent(oldConfig.categories, newConfig.categories);

  if (changes.cdnBucketConfig) {
    try {
      log.info('LLMO config changes detected in CDN bucket configuration; processing CDN config changes', {
        siteId,
        cdnBucketConfig: changes.cdnBucketConfig,
      });

      /* c8 ignore next */
      if (isFirstTimeOnboarding || !oldConfig.cdnBucketConfig) {
        await sendOnboardingNotification(context, site, 'cdn_provisioning', { cdnBucketConfig: changes.cdnBucketConfig });
        log.info('First-time LLMO CDN bucket configuration changes detected', {
          siteId,
          cdnBucketConfig: changes.cdnBucketConfig,
        });
      }

      const cdnConfigContext = {
        ...context,
        params: { siteId },
      };

      await handleCdnBucketConfigChanges(cdnConfigContext, newConfig.cdnBucketConfig);
      triggeredSteps.push('cdn-bucket-config');
    } catch (error) {
      log.error(`Error processing CDN bucket configuration changes for siteId: ${siteId}`, error);
    }
  }

  if (hasCdnLogsChanges) {
    log.info('LLMO config changes detected in categories; triggering cdn-logs-report audit');
    await triggerCdnLogsReport(context, site);
    triggeredSteps.push('cdn-logs-report');
  }

  const brandPresenceCadence = auditContext?.brandPresenceCadence || 'weekly';
  const hasBrandPresenceChanges = changes.topics || changes.categories || changes.entities;
  const needsBrandPresenceRefresh = previousConfigVersion
    && (changes.brands || changes.competitors);

  const baseUrl = await getBaseUrlBySiteId(siteId, context);
  const isAdobe = baseUrl.startsWith('https://adobe.com');

  if (hasBrandPresenceChanges && !isAdobe) {
    const isAICategorizationOnly = changes.metadata?.isAICategorizationOnly || false;

    if (isAICategorizationOnly) {
      log.info('LLMO config changes detected from AI categorization flow; triggering geo-brand-presence refresh');
      await triggerGeoBrandPresenceRefresh(context, site, configVersion);
      triggeredSteps.push('geo-brand-presence-refresh');
    } else {
      log.info('LLMO config changes detected in topics, categories, or entities; triggering geo-brand-presence audit');
      await triggerGeoBrandPresence(context, site, auditContext);
      triggeredSteps.push(brandPresenceCadence === 'daily' ? 'geo-brand-presence-daily' : 'geo-brand-presence');
    }
  }
  if (needsBrandPresenceRefresh && !isAdobe) {
    log.info('LLMO config changes detected in brand or competitor aliases; triggering geo-brand-presence-refresh');
    await triggerGeoBrandPresenceRefresh(context, site, configVersion);
    triggeredSteps.push('geo-brand-presence-refresh');
  }

  if (triggeredSteps.length > 0) {
    log.info(`LLMO config changes detected; triggered steps: ${triggeredSteps.join(', ')}`);

    return {
      auditResult: {
        status: 'completed',
        configChangesDetected: true,
        triggeredSteps,
        previousConfigVersion,
        configVersion,
      },
      fullAuditRef: finalUrl,
    };
  }

  log.info('No relevant LLMO config changes detected; no audits triggered');

  return {
    auditResult: {
      status: 'completed',
      configChangesDetected: false,
      previousConfigVersion,
      configVersion,
    },
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withRunner(runLlmoCustomerAnalysis)
  .withUrlResolver(wwwUrlResolver)
  .build();
