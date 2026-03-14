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
  getLastNumberOfWeeks, llmoConfig,
} from '@adobe/spacecat-shared-utils';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import {
  compareConfigs, areCategoryNamesDifferent,
} from './utils.js';
import { getRUMUrl } from '../support/utils.js';
import { handleCdnBucketConfigChanges } from './cdn-config-handler.js';
import { sendOnboardingNotification } from './onboarding-notifications.js';

const REFERRAL_TRAFFIC_AUDIT = 'llmo-referral-traffic';
const REFERRAL_TRAFFIC_IMPORT = 'traffic-analysis';

const GEO_FREE_SPLIT_COUNT = 23;
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

  // If no config version provided, skip config comparison (no config to compare)
  if (!configVersion) {
    log.info('No config version provided; skipping config comparison');

    return {
      auditResult: {
        status: 'completed',
        configChangesDetected: false,
        message: 'Audits enabled (no config version provided, skipping config comparison)',
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

  const hasBrandPresenceChanges = changes.topics || changes.categories || changes.entities;
  const needsBrandPresenceRefresh = previousConfigVersion
    && (changes.brands || changes.competitors);

  if (hasBrandPresenceChanges || needsBrandPresenceRefresh) {
    log.info('LLMO config changes detected affecting brand presence; geo-brand-presence audits will pick up changes on next scheduled run');
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
