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
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import {
  getLastSunday, compareConfigs,
} from './utils.js';
import { getRUMUrl } from '../support/utils.js';

const REFERRAL_TRAFFIC_AUDIT = 'llmo-referral-traffic';
const REFERRAL_TRAFFIC_IMPORT = 'traffic-analysis';

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
    log.info(`Failed to check OpTel data for domain ${domain}: ${error.message}`);
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

  const cdnLogsMessage = {
    type: 'cdn-logs-report',
    siteId,
  };

  await sqs.sendMessage(configuration.getQueues().audits, cdnLogsMessage);

  log.info('Successfully triggered cdn-logs-report audit');
}

export async function triggerGeoBrandPresence(context, site) {
  const { sqs, dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const siteId = site.getSiteId();

  log.info(`Triggering geo-brand-presence audit for site: ${siteId}`);

  const geoBrandPresenceMessage = {
    type: 'geo-brand-presence',
    siteId,
    data: getLastSunday(),
  };

  await sqs.sendMessage(configuration.getQueues().audits, geoBrandPresenceMessage);

  log.info('Successfully triggered geo-brand-presence audit');
}

export async function runLlmoCustomerAnalysis(finalUrl, context, site, auditContext = {}) {
  const {
    log, s3Client,
  } = context;

  const siteId = site.getSiteId();
  const domain = finalUrl;

  log.info(`Starting LLMO customer analysis for site: ${siteId}, domain: ${domain}`);

  const triggeredSteps = [];
  const hasOptelData = await checkOptelData(domain, context);
  const isFirstTimeOnboarding = !auditContext.previousConfigVersion;

  if (hasOptelData && isFirstTimeOnboarding) {
    log.info('First-time LLMO onboarding detected with OpTel data; initiating referral traffic import for the last 4 full calendar weeks');
    await triggerReferralTrafficImports(context, site);
    triggeredSteps.push(REFERRAL_TRAFFIC_IMPORT);
  } else if (hasOptelData && !isFirstTimeOnboarding) {
    log.info('Subsequent LLMO config update detected; skipping historical referral traffic imports (only triggered on first-time onboarding)');
  } else {
    log.info('Domain has no OpTel data available; skipping referral traffic import');
  }

  const { configVersion, previousConfigVersion } = auditContext;

  if (!configVersion) {
    log.info('No config version provided in audit context; skipping config comparison');
    return {
      auditResult: { status: 'completed', message: 'No config version provided' },
      fullAuditRef: finalUrl,
    };
  }

  log.info(`Fetching LLMO config versions - current: ${configVersion}, previous: ${previousConfigVersion || 'none'}`);

  const newConfigResult = await llmoConfig.readConfig(siteId, s3Client, { version: configVersion });
  const newConfig = newConfigResult.config;
  let oldConfig;

  if (previousConfigVersion) {
    const oldConfigResult = await llmoConfig.readConfig(
      siteId,
      s3Client,
      { version: previousConfigVersion },
    );
    oldConfig = oldConfigResult.config;
  } else {
    oldConfig = llmoConfig.defaultConfig();
  }

  const changes = compareConfigs(oldConfig, newConfig);
  const hasCdnLogsChanges = changes.categories;

  if (hasCdnLogsChanges) {
    log.info('LLMO config changes detected in categories; triggering cdn-logs-report audit');
    await triggerCdnLogsReport(context, site);
    triggeredSteps.push('cdn-logs-report');
  }

  const hasBrandPresenceChanges = changes.brands
    || changes.competitors || changes.topics || changes.categories || changes.entities;

  if (hasBrandPresenceChanges) {
    log.info('LLMO config changes detected in brands, competitors, topics, categories, or entities; triggering geo-brand-presence audit');
    await triggerGeoBrandPresence(context, site);
    triggeredSteps.push('geo-brand-presence');
  }

  if (triggeredSteps.length > 0) {
    log.info(`LLMO config changes detected; triggered steps: ${triggeredSteps.join(', ')}`);

    return {
      auditResult: {
        status: 'completed',
        configChangesDetected: true,
        changes,
        triggeredSteps,
      },
      fullAuditRef: finalUrl,
    };
  }

  log.info('No relevant LLMO config changes detected; no audits triggered');

  return {
    auditResult: {
      status: 'completed',
      configChangesDetected: false,
    },
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withRunner(runLlmoCustomerAnalysis)
  .withUrlResolver(wwwUrlResolver)
  .build();
