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
  getLastNumberOfWeeks, llmoConfig, tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import DrsClient from '@adobe/spacecat-shared-drs-client';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import {
  compareConfigs, areCategoryNamesDifferent,
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

/**
 * Creates a brand presence schedule in DRS and triggers it immediately.
 * This is called during first-time onboarding so that brand presence data
 * collection starts right away instead of waiting for the next scheduled run.
 *
 * @param {object} context - Universal context with env and log
 * @param {string} siteId - SpaceCat site ID
 * @param {string} domain - Site domain for the schedule description
 * @param {object} [options]
 * @param {string} [options.brandId] - Brand UUID for v2 schedules (required for v2 scheduler)
 * @param {string} [options.organizationId] - SpaceCat org UUID for v2 schedules
 */
export async function createAndTriggerBrandPresenceSchedule(context, siteId, domain, opts = {}) {
  const { brandId, organizationId } = opts;
  const { env, log } = context;
  const { DRS_API_URL: drsApiUrl, DRS_API_KEY: drsApiKey } = env;

  if (!drsApiUrl || !drsApiKey) {
    throw new Error('DRS API URL or key not configured; skipping brand presence schedule creation');
  }

  // Strip trailing slashes from the API URL
  let baseUrl = drsApiUrl;
  while (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': drsApiKey,
  };

  const schedulePayload = {
    site_id: siteId,
    ...(brandId && { brand_id: brandId }),
    ...(organizationId && { spacecat_org_id: organizationId }),
    frequency: 'weekly',
    cron_expression: 'auto',
    description: `Onboarding brand presence: ${domain} (${siteId})`,
    job_config: {
      provider_ids: ['brightdata', 'google_ai_overviews', 'openai_web_search'],
      priority: 'LOW',
      enable_brand_presence: true,
      cadence: 'weekly',
      provider_parameters: {
        brightdata: {
          siteId,
          metadata: { site: siteId },
          dataset_id: 'chatgpt_free,perplexity,gemini,copilot,aimode',
          platforms: ['chatgpt_free', 'perplexity', 'gemini', 'copilot', 'aimode'],
        },
        google_ai_overviews: {
          siteId,
          metadata: { site: siteId },
        },
        openai_web_search: {
          siteId,
          metadata: { site: siteId },
        },
      },
    },
  };

  // Step 1: Create the schedule
  log.info(`Creating brand presence schedule for site ${siteId}`);
  const createResponse = await fetch(`${baseUrl}/schedules`, {
    method: 'POST',
    headers,
    body: JSON.stringify(schedulePayload),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Failed to create brand presence schedule: ${createResponse.status} - ${errorText}`);
  }

  const schedule = await createResponse.json();
  const scheduleId = schedule.schedule_id || schedule.id;

  if (!scheduleId) {
    throw new Error('DRS schedule creation succeeded but no schedule_id returned');
  }

  log.info(`Brand presence schedule created: ${scheduleId} for site ${siteId}`);

  // Step 2: Trigger the schedule immediately
  log.info(`Triggering brand presence schedule ${scheduleId} for site ${siteId}`);
  const triggerResponse = await fetch(`${baseUrl}/schedules/${siteId}/${scheduleId}/trigger`, {
    method: 'POST',
    headers,
  });

  if (!triggerResponse.ok) {
    const errorText = await triggerResponse.text();
    throw new Error(`Failed to trigger brand presence schedule: ${triggerResponse.status} - ${errorText}`);
  }

  log.info(`Brand presence schedule ${scheduleId} triggered successfully for site ${siteId}`);

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
      refreshAgenticDailyExport: true,
    },
  });

  log.info('Successfully triggered cdn-logs-report audit');
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

// V2 (brandalf) dispatch contract — see LLMO-4744.
// BrandsController in spacecat-api-service dispatches one message per site
// after every customer-config mutation. The legacy v1 S3 snapshot diff is
// frozen for brandalf orgs, so we route by an explicit `changeKind` instead.
const V2_CHANGE_KINDS = Object.freeze({
  BRANDS: 'brands',
  COMPETITORS: 'competitors',
  CATEGORIES: 'categories',
  TOPICS: 'topics',
  ENTITIES: 'entities',
  PROMPTS: 'prompts',
});

const V2_FIRES_BRAND_PRESENCE_REFRESH = new Set([
  V2_CHANGE_KINDS.BRANDS,
  V2_CHANGE_KINDS.COMPETITORS,
  V2_CHANGE_KINDS.PROMPTS,
]);

const V2_FIRES_BRAND_DETECTION = new Set([
  V2_CHANGE_KINDS.CATEGORIES,
  V2_CHANGE_KINDS.TOPICS,
  V2_CHANGE_KINDS.ENTITIES,
  V2_CHANGE_KINDS.PROMPTS,
]);

const V2_CONFIG_VERSION_SENTINEL = 'v2';

function buildV2NoOpResult(changeKind, finalUrl) {
  return {
    auditResult: {
      status: 'completed',
      configChangesDetected: false,
      onboardingMode: 'v2',
      changeKind,
      triggeredSteps: [],
    },
    fullAuditRef: finalUrl,
  };
}

/**
 * Handle a v2 customer-analysis dispatch from spacecat-api-service.
 *
 * Routes triggers from `auditContext.changeKind` instead of diffing two S3
 * snapshots — the v1 mirror is frozen for brandalf orgs, so the snapshot
 * diff cannot fire. Skips CDN logs (out of scope under brandalf).
 *
 * @param {object} context Audit-worker context
 * @param {object} site Site model
 * @param {object} auditContext Message auditContext
 * @param {string} finalUrl Resolved site URL
 * @returns {Promise<object>} Audit framework result
 */
async function handleV2ChangeKindDispatch(context, site, auditContext, finalUrl) {
  const { env, log } = context;
  const { changeKind, organizationId: ctxOrgId } = auditContext;
  const siteId = site.getSiteId();
  const orgId = site.getOrganizationId?.() || ctxOrgId;

  if (!Object.values(V2_CHANGE_KINDS).includes(changeKind)) {
    log.warn(`Ignoring v2 customer-analysis dispatch with unknown changeKind="${changeKind}" for site ${siteId}`);
    return buildV2NoOpResult(changeKind, finalUrl);
  }

  if (!orgId) {
    log.warn(`v2 customer-analysis dispatch for site ${siteId} has no organizationId; cannot verify brandalf flag`);
    return buildV2NoOpResult(changeKind, finalUrl);
  }

  const brandalf = await isBrandalfEnabled(orgId, env, log);
  if (!brandalf) {
    log.warn(`v2 customer-analysis dispatch for site ${siteId} but brandalf is not enabled for org ${orgId}; skipping triggers`);
    return buildV2NoOpResult(changeKind, finalUrl);
  }

  const triggeredSteps = [];

  if (V2_FIRES_BRAND_DETECTION.has(changeKind)) {
    const drsClient = DrsClient.createFrom(context);
    if (drsClient.isConfigured()) {
      await drsClient.triggerBrandDetection(siteId);
      triggeredSteps.push('drs-brand-detection');
    } else {
      log.warn(`DRS not configured; skipping brand detection trigger for site ${siteId} (v2 changeKind=${changeKind})`);
    }
  }

  if (V2_FIRES_BRAND_PRESENCE_REFRESH.has(changeKind)) {
    await triggerGeoBrandPresenceRefresh(context, site, V2_CONFIG_VERSION_SENTINEL);
    triggeredSteps.push('geo-brand-presence-trigger-refresh');
  }

  log.info(`v2 customer-analysis dispatch handled for site ${siteId}, changeKind=${changeKind}, triggered: ${triggeredSteps.join(', ') || 'none'}`);

  return {
    auditResult: {
      status: 'completed',
      configChangesDetected: triggeredSteps.length > 0,
      onboardingMode: 'v2',
      changeKind,
      triggeredSteps,
    },
    fullAuditRef: finalUrl,
  };
}

export async function runLlmoCustomerAnalysis(finalUrl, context, site, auditContext = {}) {
  const {
    env, log, s3Client,
  } = context;
  const { Configuration } = context.dataAccess;

  const siteId = site.getSiteId();
  const domain = finalUrl;

  // Ensure relevant audits and imports are enabled
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

    await enableAudits(site, context, auditsToEnable, { configuration });
  } catch (error) {
    log.error(`Failed to enable audits for site ${siteId}: ${error.message}`);
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
  const {
    configVersion, previousConfigVersion, onboardingMode, changeKind,
  } = auditContext;

  // V2 dispatch (LLMO-4744): BrandsController emits one message per site
  // with `changeKind` after every customer-config mutation. Short-circuit
  // before first-onboarding logic so we do not re-create BP schedules on
  // subsequent edits (createAndTriggerBrandPresenceSchedule is not
  // idempotent), and before the v1 S3 diff because the v1 mirror is
  // frozen under brandalf.
  if (changeKind !== undefined) {
    return handleV2ChangeKindDispatch(context, site, auditContext, finalUrl);
  }

  const hasOptelData = await checkOptelData(domain, context);
  const isFirstTimeOnboarding = !previousConfigVersion;

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
      const isV2 = onboardingMode !== 'v1' && await isBrandalfEnabled(orgId, env, log);
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
        message: 'Audits enabled (no config version provided, skipping config comparison)',
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
    const configuration = await Configuration.findLatest();
    const isCdnLogsReportEnabled = await configuration.isHandlerEnabledForSite('cdn-logs-report', site);

    if (isCdnLogsReportEnabled) {
      log.info('LLMO config changes detected in categories; triggering cdn-logs-report audit');
      await triggerCdnLogsReport(context, site);
      triggeredSteps.push('cdn-logs-report');
    } else {
      log.info('LLMO config changes detected in categories; skipping cdn-logs-report because it is disabled for this site');
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
