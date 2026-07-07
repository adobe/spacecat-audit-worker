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
import DrsClient from '@adobe/spacecat-shared-drs-client';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import {
  compareConfigs,
} from './utils.js';
import {
  isBrandalfEnabled,
  resolveOrganizationIdForSite,
} from '../utils/brandalf-utils.js';
import { getRUMUrl } from '../support/utils.js';
import { handleCdnBucketConfigChanges } from './cdn-config-handler.js';
import { sendOnboardingNotification } from './onboarding-notifications.js';
import { findActiveBrandForSite } from '../utils/brand-resolver.js';

const REFERRAL_TRAFFIC_AUDIT = 'llmo-referral-traffic';
const REFERRAL_TRAFFIC_DAILY_AUDIT = 'llmo-referral-traffic-daily';
const REFERRAL_TRAFFIC_IMPORT = 'traffic-analysis';
/* c8 ignore start */
/* this is actually running during tests. verified manually on 2025-12-10. */
/**
 * Enables each listed audit handler for the site and persists configuration.
 * Intentionally does not call isHandlerEnabledForSite — callers must only invoke this on
 * first-time flows (e.g. no previousConfigVersion) so disabled handlers are not re-toggled
 * on every LLMO analysis.
 *
 * @param {object} site
 * @param {object} context
 * @param {string[]} audits
 * @param {{ configuration: object }} options
 */
async function enableAudits(site, context, audits, options) {
  const { configuration } = options;
  audits.forEach((audit) => {
    configuration.enableHandlerForSite(audit, site);
  });
  await configuration.save();
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

/**
 * Creates and triggers the recurring brand-presence schedule for a first-time
 * onboarded site, via the shared `createBrandPresenceSchedule` drs-client helper
 * (LLMO-5605). That helper is the single definition of the brand-presence schedule:
 * the self-serve activate-brand endpoint (spacecat-api-service) creates the same
 * schedule through it, so the two paths can't drift (DRS dedups on the provider-set).
 * Triggered immediately so collection starts right away instead of waiting for the
 * next scheduled run.
 *
 * @param {object} context - Universal context with env and log
 * @param {string} siteId - SpaceCat site ID
 * @param {string} domain - Site domain (used for the schedule description)
 * @param {object} [opts]
 * @param {string} [opts.brandId] - Brand UUID for v2 schedules (required for v2 dedup)
 * @param {string} [opts.organizationId] - SpaceCat org UUID for v2 schedules
 * @returns {Promise<string>} The created (or existing) schedule id
 */
export async function createAndTriggerBrandPresenceSchedule(context, siteId, domain, opts = {}) {
  const { brandId, organizationId } = opts;
  const { log } = context;

  const drsClient = DrsClient.createFrom(context);
  if (!drsClient.isConfigured()) {
    throw new Error('DRS API URL or key not configured; skipping brand presence schedule creation');
  }

  log.info(`Creating brand presence schedule for site ${siteId}`);
  const { scheduleId, alreadyExisted } = await drsClient.createBrandPresenceSchedule({
    siteId,
    brandId,
    orgId: organizationId,
    description: `Onboarding brand presence: ${domain} (${siteId})`,
    triggerImmediately: true,
  });

  log.info(
    `Brand presence schedule ${alreadyExisted ? 'already existed' : 'created'}: `
    + `${scheduleId} for site ${siteId}${alreadyExisted ? '' : ' (triggered)'}`,
  );

  return scheduleId;
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

async function triggerGeoBrandPresenceRefresh(context, site, configVersion) {
  const { sqs, dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const siteId = site.getSiteId();
  log.info('Triggering geo-brand-presence-trigger-refresh for site: %s', siteId);
  await sqs.sendMessage(configuration.getQueues().audits, {
    type: 'geo-brand-presence-trigger-refresh',
    siteId,
    auditContext: { configVersion },
  });
  log.info('Successfully triggered geo-brand-presence-trigger-refresh');
}

export async function runLlmoCustomerAnalysis(finalUrl, context, site, auditContext = {}) {
  const {
    env, log, s3Client,
  } = context;
  const { Configuration } = context.dataAccess;

  const siteId = site.getSiteId();
  const domain = finalUrl;

  const { configVersion, previousConfigVersion, onboardingMode } = auditContext;
  const isFirstTimeOnboarding = !previousConfigVersion;

  if (isFirstTimeOnboarding) {
    try {
      const configuration = await Configuration.findLatest();
      const auditsToEnable = [
        'scrape-top-pages',
        'headings',
        'llm-blocked',
        'llm-error-pages',
        'summarization',
        REFERRAL_TRAFFIC_AUDIT,
        REFERRAL_TRAFFIC_DAILY_AUDIT,
        'readability',
        'wikipedia-analysis',
      ];
      // enableAudits intentionally bypasses isHandlerEnabledForSite (see its JSDoc); only
      // call it from first-time onboarding paths so previously disabled handlers are not
      // silently re-toggled on subsequent runs.
      await enableAudits(site, context, auditsToEnable, { configuration });
    } catch (error) {
      log.error(`Failed to enable audits for site ${siteId}: ${error.message}`);
    }
  }

  try {
    await enableImports(siteId, context, [
      { type: REFERRAL_TRAFFIC_IMPORT },
      { type: 'top-pages' },
    ]);
  } catch (error) {
    log.error(`Failed to enable imports for site ${siteId}: ${error.message}`);
  }

  log.info(`Starting LLMO customer analysis for site: ${siteId}, domain: ${domain}`);

  const triggeredSteps = [];
  const hasOptelData = await checkOptelData(domain, context);

  // For brandalf-enabled orgs, resolve brand ID so the DRS scheduler can use v2 prompts.
  // If onboardingMode is explicitly 'v1' (set by api-service for mixed-state orgs with
  // pre-Brandalf sites), skip v2 brand resolution — the org has brandalf=true but was
  // onboarded via the v1 path, so no customer config brand exists yet.
  let brandId;
  let organizationId;
  if (isFirstTimeOnboarding) {
    const orgId = await resolveOrganizationIdForSite({
      site,
      fallbackOrganizationId: auditContext.imsOrgId,
      log,
    });
    if (orgId) {
      const isV2 = onboardingMode !== 'v1'
        && await isBrandalfEnabled(orgId, context.dataAccess?.services?.postgrestClient, log);
      if (isV2) {
        organizationId = orgId;
        const brand = await findActiveBrandForSite(context, { orgId, siteId });
        if (brand) {
          brandId = brand.brandId;
          log.info(`Resolved brand ${brandId} for site ${siteId} (v2 onboarding)`);
        } else {
          log.warn(`No brand resolved for site ${siteId} in org ${organizationId} for v2 BP schedule`);
        }
      }
    }
  }

  let bpScheduleId;
  if (isFirstTimeOnboarding) {
    await sendOnboardingNotification(context, site, 'first_onboarding');

    // Create and trigger brand presence schedule via DRS API (non-fatal)
    try {
      const bpOpts = { brandId, organizationId };
      bpScheduleId = await createAndTriggerBrandPresenceSchedule(context, siteId, domain, bpOpts);
      triggeredSteps.push('brand-presence-schedule');
    } catch (error) {
      log.error(`Failed to create/trigger brand presence schedule for site ${siteId}: ${error.message}`);
    }
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
        message: 'No config version provided; skipping config comparison',
        triggeredSteps,
        brandPresenceScheduleId: bpScheduleId,
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

  const hasBrandPresenceChanges = changes.topics || changes.categories || changes.entities;
  const needsBrandPresenceRefresh = previousConfigVersion
    && (changes.brands || changes.competitors);

  if (hasBrandPresenceChanges) {
    const drsClient = DrsClient.createFrom(context);
    if (drsClient.isConfigured()) {
      await drsClient.triggerBrandDetection(siteId);
      triggeredSteps.push('drs-brand-detection');
    } else {
      log.warn('DRS not configured; skipping brand detection trigger');
    }
  }

  if (needsBrandPresenceRefresh) {
    await triggerGeoBrandPresenceRefresh(context, site, configVersion);
    triggeredSteps.push('geo-brand-presence-trigger-refresh');
  }

  if (triggeredSteps.length > 0) {
    log.info(`LLMO config changes detected; triggered steps: ${triggeredSteps.join(', ')}`);

    return {
      auditResult: {
        status: 'completed',
        configChangesDetected: true,
        triggeredSteps,
        brandPresenceScheduleId: bpScheduleId,
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
