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
import { getPreviousUtcDate } from './agentic-daily-export.js';

/**
 * Resolves the reporting period used to sample CDN logs for pattern generation.
 *
 * A date-based (backfill) run carries an explicit `auditContext.date`; the period is
 * derived from that run's traffic date (`date - 1`, matching the daily export) so
 * patterns are sampled from the week that actually has uploaded data. This matters for
 * sites whose logs only cover an earlier period — e.g. backfilling May data in June
 * must not sample the (empty) current week, which would yield no URLs.
 *
 * Without a date (normal scheduled run) the period is the previous full week on
 * Mondays, else the current week.
 */
function resolvePatternPeriods(auditContext) {
  if (auditContext?.date) {
    const referenceDate = new Date(auditContext.date);
    if (!Number.isNaN(referenceDate.getTime())) {
      return generateReportingPeriods(getPreviousUtcDate(referenceDate), 0);
    }
  }
  return generateReportingPeriods(new Date(), new Date().getUTCDay() === 1 ? -1 : 0);
}

/**
 * Ensures the agentic URL classification rules exist in the database, generating
 * them only when they're missing. Existing rules (which may include customer-added
 * categories) are never overwritten. Runs on every audit invocation so a backfill
 * for a brand-new site bootstraps its rules; established sites just read-and-skip.
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
    return;
  }

  try {
    if (!(await pathHasData(s3Client, agenticReportConfig.aggregatedLocation))) {
      log.info('No agentic report data found - skipping patterns generation');
      return;
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
      const periods = resolvePatternPeriods(auditContext);

      await generatePatternsWorkbook({
        site,
        context,
        athenaClient,
        s3Config: { ...s3Config, tableName: agenticReportConfig.tableName },
        periods,
        existingPatterns,
      });
    }
  } catch (error) {
    // Patterns generation is best-effort: a transient Athena/DB failure here must
    // not block the daily agentic/referral DB exports, which do not depend on it.
    log.error(`Agentic patterns generation failed for ${site.getId()}: ${error.message}`, error);
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

  // 1. Ensure agentic classification rules exist in the DB (generate only if missing).
  await generateAgenticPatterns({
    site,
    context,
    s3Client,
    athenaClient,
    s3Config,
    agenticReportConfig,
    auditContext,
  });

  // 2. Daily agentic export — feeds PostgreSQL.
  const agenticDbExportResult = await runAgenticDbExports({
    athenaClient,
    s3Config,
    site,
    context,
    agenticReportConfig,
    auditContext,
  });

  // 3. Daily referral export — feeds PostgreSQL.
  const dailyReferralExport = await runReferralExport({
    site,
    context,
    athenaClient,
    s3Config,
    referralReportConfig,
    auditContext,
  });

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
