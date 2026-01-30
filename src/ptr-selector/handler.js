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
  AWSAthenaClient,
} from '@adobe/spacecat-shared-athena-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { getWeekInfo, getTemporalCondition, getLastNumberOfWeeks } from '@adobe/spacecat-shared-utils';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getTotalPageViewsTemplate } from './queries.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const IMPORT_TYPE_TRAFFIC_ANALYSIS = 'traffic-analysis';

const THRESHOLD_LOW = 50000;
const THRESHOLD_HIGH = 200000;

const REPORT_DECISION = {
  NOT_ENOUGH_DATA: 'not enough data',
  MONTHLY: 'monthly report',
  WEEKLY: 'weekly report',
};

function isImportEnabled(importType, imports) {
  return imports?.find((importConfig) => importConfig.type === importType)?.enabled;
}

async function enableImport(site, importType, log) {
  const siteConfig = site.getConfig();
  if (!siteConfig) {
    const errorMsg = `Cannot enable import ${importType} for site ${site.getId()}: site config is null`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  siteConfig.enableImport(importType);
  site.setConfig(Config.toDynamoItem(siteConfig));
  await site.save();
}

function getConfig(env) {
  const {
    RUM_METRICS_DATABASE: rumMetricsDatabase,
    RUM_METRICS_COMPACT_TABLE: rumMetricsCompactTable,
    S3_IMPORTER_BUCKET_NAME: bucketName,
  } = env;

  if (!bucketName) {
    throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for ptr-selector audit');
  }

  return {
    rumMetricsDatabase: rumMetricsDatabase ?? 'rum_metrics',
    rumMetricsCompactTable: rumMetricsCompactTable ?? 'compact_metrics',
    bucketName,
    athenaTemp: `s3://${bucketName}/rum-metrics-compact/temp/out`,
  };
}

function determineReportDecision(totalPageViewSum) {
  if (totalPageViewSum < THRESHOLD_LOW) {
    return REPORT_DECISION.NOT_ENOUGH_DATA;
  }
  if (totalPageViewSum < THRESHOLD_HIGH) {
    return REPORT_DECISION.MONTHLY;
  }
  return REPORT_DECISION.WEEKLY;
}

async function enableAuditForSite(auditType, site, dataAccess, log) {
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();

  if (!configuration.isHandlerEnabledForSite(auditType, site)) {
    configuration.enableHandlerForSite(auditType, site);
    await configuration.save();
    log.info(`[ptr-selector] Enabled ${auditType} for site ${site.getId()}`);
  } else {
    log.info(`[ptr-selector] ${auditType} already enabled for site ${site.getId()}`);
  }
}

function createImportStep(weekIndex) {
  return async function triggerTrafficAnalysisImportStep(context) {
    const { site, finalUrl, log } = context;
    const siteId = site.getId();

    const weeks = getLastNumberOfWeeks(4);
    const { week, year } = weeks[weekIndex];

    log.info(`[ptr-selector] [Site: ${finalUrl}] Import step ${weekIndex + 1}/4: Triggering traffic-analysis import for week ${week}/${year}`);

    if (weekIndex === 0) {
      const siteConfig = site.getConfig();
      const imports = siteConfig?.getImports() || [];

      if (!isImportEnabled(IMPORT_TYPE_TRAFFIC_ANALYSIS, imports)) {
        log.debug(`[ptr-selector] [Site: ${finalUrl}] Enabling ${IMPORT_TYPE_TRAFFIC_ANALYSIS} import for site ${siteId}`);
        await enableImport(site, IMPORT_TYPE_TRAFFIC_ANALYSIS, log);
      }
    }

    return {
      auditResult: {
        status: 'pending',
        message: `Importing traffic-analysis data for week ${week}/${year}`,
      },
      fullAuditRef: finalUrl,
      type: IMPORT_TYPE_TRAFFIC_ANALYSIS,
      siteId,
      allowCache: true,
      auditContext: {
        week,
        year,
      },
    };
  };
}

export const importWeekStep0 = createImportStep(0);
export const importWeekStep1 = createImportStep(1);
export const importWeekStep2 = createImportStep(2);
export const importWeekStep3 = createImportStep(3);

export async function runPtrSelectorAnalysisStep(context) {
  const {
    site, finalUrl, log, dataAccess, env,
  } = context;

  const siteId = site.getId();
  log.info(`[ptr-selector] [Site: ${finalUrl}] Step 5: Running ptr-selector analysis`);

  const config = getConfig(env);
  const { week, year } = getWeekInfo();
  const temporalCondition = getTemporalCondition({ week, year, numSeries: 4 });
  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;

  const athenaClient = AWSAthenaClient.fromContext(context, `${config.athenaTemp}/ptr-selector/${siteId}-${Date.now()}`);

  try {
    const query = getTotalPageViewsTemplate({
      siteId,
      tableName,
      temporalCondition,
    });

    log.debug(`[ptr-selector] [Site: ${finalUrl}] Executing total pageviews query`);

    const result = await athenaClient.query(
      query,
      config.rumMetricsDatabase,
      `ptr-selector total pageviews for siteId: ${siteId}`,
    );

    const totalPageViewSum = parseInt(result?.[0]?.total_pageview_sum || 0, 10);
    const reportDecision = determineReportDecision(totalPageViewSum);

    const auditResult = { totalPageViewSum, reportDecision };

    if (reportDecision === REPORT_DECISION.WEEKLY) {
      await enableAuditForSite('paid-traffic-analysis-weekly', site, dataAccess, log);
      log.info(`[ptr-selector] totalPageViewSum=${totalPageViewSum}. Enabled paid-traffic-analysis-weekly for site ${siteId}.`);
    } else if (reportDecision === REPORT_DECISION.MONTHLY) {
      await enableAuditForSite('paid-traffic-analysis-monthly', site, dataAccess, log);
      log.info(`[ptr-selector] totalPageViewSum=${totalPageViewSum}. Enabled paid-traffic-analysis-monthly for site ${siteId}.`);
    } else {
      log.info(`[ptr-selector] totalPageViewSum=${totalPageViewSum} is below 50K threshold. No audit enabled.`);
    }

    return {
      auditResult,
      fullAuditRef: finalUrl,
    };
  } catch (error) {
    log.error(`[ptr-selector] [Site: ${finalUrl}] Athena query failed: ${error.message}`);
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-week-0', importWeekStep0, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('import-week-1', importWeekStep1, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('import-week-2', importWeekStep2, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('import-week-3', importWeekStep3, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('run-ptr-selector-analysis', runPtrSelectorAnalysisStep)
  .build();
