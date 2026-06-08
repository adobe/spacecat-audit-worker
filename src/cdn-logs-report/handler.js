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

import { AuditBuilder } from '../common/audit-builder.js';
import {
  loadSql,
  generateReportingPeriods,
} from './utils/report-utils.js';
import { fetchAgenticUrlClassificationRules } from '../common/agentic-url-classification-rules.js';
import {
  pathHasData,
  getS3Config,
  getCdnAwsRuntime,
} from '../utils/cdn-utils.js';
import { wwwUrlResolver } from '../common/base-audit.js';
import { getConfigs } from './constants/report-configs.js';
import { generatePatternsWorkbook } from './patterns/patterns-uploader.js';
import { runAgenticDbExports } from './utils/agentic-db-export.js';
import { runDailyReferralExport } from './referral-daily-export.js';

/**
 * Picks the single week offset used to sample CDN logs for pattern generation.
 * An explicit weekOffset wins; otherwise the previous full week on Mondays,
 * else the current week.
 */
function resolvePatternWeekOffset(auditContext) {
  if (auditContext?.weekOffset !== undefined && auditContext?.weekOffset !== null) {
    return auditContext.weekOffset;
  }
  return new Date().getUTCDay() === 1 ? -1 : 0;
}

/**
 * Weekly (non-daily) step: refresh the agentic URL classification rules and sync
 * them to the database. The weekly SharePoint .xlsx reports were retired once the
 * dashboards moved to PostgreSQL, so this is the only remaining weekly work.
 *
 * @returns {Promise<{ agenticReportHasData: boolean }>} whether agentic data was found
 */
async function generateAgenticPatterns({
  site,
  context,
  s3Client,
  athenaClient,
  s3Config,
  agenticReportConfig,
  auditContext,
}) {
  const { log } = context;

  if (!agenticReportConfig) {
    log.info('No agentic report config found - skipping patterns generation');
    return { agenticReportHasData: false };
  }

  try {
    if (!(await pathHasData(s3Client, agenticReportConfig.aggregatedLocation))) {
      log.info('No agentic report data found - skipping patterns generation');
      return { agenticReportHasData: false };
    }

    // Pattern generation queries Athena, so ensure the database exists first.
    const sqlDb = await loadSql('create-database', { database: s3Config.databaseName });
    await athenaClient.execute(
      sqlDb,
      s3Config.databaseName,
      `[Athena Query] Create database ${s3Config.databaseName}`,
    );

    const existingPatterns = await fetchAgenticUrlClassificationRules(site, context);
    const hasExistingPatterns = (existingPatterns?.pagePatterns?.length || 0) > 0
      && (existingPatterns?.topicPatterns?.length || 0) > 0;

    if (existingPatterns?.error) {
      log.info(`Skipping fresh patterns generation for ${site.getId()}; DB rule fetch failed`);
    } else if (!hasExistingPatterns) {
      log.info('Agentic URL classification rules not found, generating DB rules...');
      const periods = generateReportingPeriods(new Date(), resolvePatternWeekOffset(auditContext));

      await generatePatternsWorkbook({
        site,
        context,
        athenaClient,
        s3Config: { ...s3Config, tableName: agenticReportConfig.tableName },
        periods,
        existingPatterns,
      });
    }

    return { agenticReportHasData: true };
  } catch (error) {
    // Patterns generation is best-effort: a transient Athena/DB failure here must
    // not block the daily agentic/referral DB exports, which do not depend on it.
    log.error(`Agentic patterns generation failed for ${site.getId()}: ${error.message}`, error);
    return { agenticReportHasData: false };
  }
}

/**
 * Runs the daily referral DB export, returning a failure marker instead of throwing
 * so a referral problem never blocks the rest of the audit.
 */
async function runReferralExport({
  site,
  context,
  athenaClient,
  s3Config,
  referralReportConfig,
  auditContext,
}) {
  const siteId = site.getId();
  if (!referralReportConfig) {
    context.log.debug(`Skipping daily referral export for ${siteId}: referral report config not found`);
    return undefined;
  }

  try {
    return await runDailyReferralExport({
      athenaClient,
      s3Config,
      site,
      context,
      reportConfig: referralReportConfig,
      ...(auditContext?.date ? { referenceDate: new Date(auditContext.date) } : {}),
    });
  } catch (error) {
    context.log.error(`Failed daily referral export for site ${siteId}: ${error.message}`, error);
    return {
      enabled: true,
      success: false,
      siteId,
      error: error.message,
    };
  }
}

async function runCdnLogsReport(url, context, site, auditContext) {
  const { log } = context;
  const isDailyDateRun = Boolean(auditContext?.date);
  const isWeeklyOnlyRun = auditContext?.weekOffset !== undefined
    && auditContext?.weekOffset !== null;

  const awsRuntime = getCdnAwsRuntime(site, context);
  const { s3Client } = awsRuntime;
  const s3Config = getS3Config(site, context);
  log.debug(`Starting CDN logs report audit for ${url}`);

  const athenaClient = awsRuntime.createAthenaClient(
    s3Config.getAthenaTempLocation(),
    {
      pollIntervalMs: 3000,
      maxPollAttempts: 250,
    },
  );
  const reportConfigs = getConfigs(s3Config.bucket, s3Config.siteKey, site.getId());
  const agenticReportConfig = reportConfigs.find((config) => config.name === 'agentic');
  const referralReportConfig = reportConfigs.find((config) => config.name === 'referral');

  // 1. Weekly step — refresh agentic classification rules in the DB (no SharePoint).
  let agenticReportHasData = false;
  if (!isDailyDateRun) {
    ({ agenticReportHasData } = await generateAgenticPatterns({
      site,
      context,
      s3Client,
      athenaClient,
      s3Config,
      agenticReportConfig,
      auditContext,
    }));
  }

  // 2. Daily agentic export — feeds PostgreSQL.
  const agenticDbExportResult = await runAgenticDbExports({
    athenaClient,
    s3Config,
    site,
    context,
    agenticReportConfig,
    auditContext,
    agenticReportHasData,
  });

  // 3. Daily referral export — feeds PostgreSQL (skipped on weekly-only runs).
  const dailyReferralExport = !isWeeklyOnlyRun
    ? await runReferralExport({
      site,
      context,
      athenaClient,
      s3Config,
      referralReportConfig,
      auditContext,
    })
    : undefined;

  // 4. Assemble the audit result from the DB export outcomes.
  const auditResult = [];
  if (agenticDbExportResult.dailyAgenticExport?.batchId) {
    auditResult.push({
      name: 'agentic-db-export',
      batchId: agenticDbExportResult.dailyAgenticExport.batchId,
    });
  }
  if (dailyReferralExport?.batchId) {
    auditResult.push({
      name: 'referral-db-export',
      batchId: dailyReferralExport.batchId,
    });
  }

  return {
    ...agenticDbExportResult,
    auditResult,
    dailyReferralExport,
    fullAuditRef: `${site.getConfig()?.getLlmoDataFolder()}`,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnLogsReport)
  .withUrlResolver(wwwUrlResolver)
  .build();
