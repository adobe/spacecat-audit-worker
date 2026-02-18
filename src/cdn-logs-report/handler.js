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
/* eslint-disable no-await-in-loop */

import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import {
  getS3Config,
  loadSql,
  generateReportingPeriods,
  fetchRemotePatterns,
  getConfigCategories,
} from './utils/report-utils.js';
import { pathHasData } from '../utils/cdn-utils.js';
import { runWeeklyReport } from './utils/report-runner.js';
import { wwwUrlResolver } from '../common/base-audit.js';
import { createLLMOSharepointClient, bulkPublishToAdminHlx } from '../utils/report-uploader.js';
import { getConfigs } from './constants/report-configs.js';
import { generatePatternsWorkbook } from './patterns/patterns-uploader.js';
import { weeklyBreakdownQueries } from './utils/query-builder.js';
import { mapToAgenticTrafficRows } from './utils/agentic-traffic-mapper.js';
import { runDbOnlyDailyAgenticExport } from './utils/db-only-export-runner.js';
import { syncAgenticTrafficToDb } from './utils/agentic-traffic-db-sync.js';

const AGENTIC_DAILY_SITE_IDS = new Set(['9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3']);

function getYesterdayUtcDate() {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  return yesterday;
}

async function runDailyAgenticExport({
  athenaClient,
  s3Config,
  site,
  context,
  auditContext,
  trafficDate = getYesterdayUtcDate(),
}) {
  const { log } = context;
  const trafficDateString = trafficDate.toISOString().split('T')[0];
  const sqlDb = await loadSql('create-database', { database: s3Config.databaseName });
  await athenaClient.execute(sqlDb, s3Config.databaseName, `[Athena Query] Create database ${s3Config.databaseName}`);
  const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery({
    trafficDate,
    databaseName: s3Config.databaseName,
    tableName: `aggregated_logs_${s3Config.customerDomain}_consolidated`,
    site,
  });

  const rawRows = await athenaClient.query(
    query,
    s3Config.databaseName,
    '[Athena Query] agentic_daily_flat_data',
  );

  const mappedRows = await mapToAgenticTrafficRows(rawRows, site, context, trafficDateString);
  const delivery = await syncAgenticTrafficToDb({
    context,
    auditContext,
    siteId: site.getId(),
    trafficDate: trafficDateString,
    rows: mappedRows,
  });

  log.info(`[cdn-logs-report] Daily agentic export prepared for ${site.getId()} on ${trafficDateString}. Rows: ${mappedRows.length}`);

  return {
    enabled: true,
    success: true,
    siteId: site.getId(),
    trafficDate: trafficDateString,
    rowCount: mappedRows.length,
    delivery,
  };
}

async function runCdnLogsReport(url, context, site, auditContext) {
  const { log } = context;
  const s3Config = await getS3Config(site, context);
  log.debug(`Starting CDN logs report audit for ${url}`);
  const isDbOnlyMode = auditContext?.mode === 'db_only';

  const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation(), {
    pollIntervalMs: 3000,
    maxPollAttempts: 250,
  });
  const siteId = site.getId();

  if (isDbOnlyMode) {
    const dailyAgenticExport = await runDbOnlyDailyAgenticExport({
      auditContext,
      siteId,
      log,
      runDailyExport: async (trafficDate) => runDailyAgenticExport({
        athenaClient,
        s3Config,
        site,
        context,
        auditContext,
        trafficDate,
      }),
    });

    return {
      auditResult: [],
      dailyAgenticExport,
      fullAuditRef: `${site.getConfig()?.getLlmoDataFolder()}`,
    };
  }

  const sharepointClient = await createLLMOSharepointClient(
    context,
    auditContext?.sharepointOptions,
  );
  const reportConfigs = getConfigs(s3Config.bucket, s3Config.customerDomain, siteId);
  let dailyAgenticExport;

  const results = [];
  const reportsToPublish = [];
  for (const reportConfig of reportConfigs) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await pathHasData(context.s3Client, reportConfig.aggregatedLocation))) {
      log.info(`No data found for ${reportConfig.name} report - skipping`);
      // eslint-disable-next-line no-continue
      continue;
    }

    if (results.length === 0) {
      // eslint-disable-next-line no-await-in-loop
      const sqlDb = await loadSql('create-database', { database: s3Config.databaseName });
      // eslint-disable-next-line no-await-in-loop
      await athenaClient.execute(sqlDb, s3Config.databaseName, `[Athena Query] Create database ${s3Config.databaseName}`);
    }

    const isMonday = new Date().getUTCDay() === 1;
    // If weekOffset is not provided, run for both week 0 and -1 on Monday and
    // on non-Monday, run for current week. Otherwise, run for the provided weekOffset
    let weekOffsets;
    if (auditContext?.weekOffset !== undefined) {
      weekOffsets = [auditContext.weekOffset];
    } else if (isMonday) {
      weekOffsets = [-1, 0];
    } else {
      weekOffsets = [0];
    }

    if (reportConfig.name === 'agentic') {
      const existingPatterns = await fetchRemotePatterns(site);

      if (!existingPatterns || auditContext?.categoriesUpdated) {
        log.info('Patterns not found, generating patterns workbook...');
        const periods = generateReportingPeriods(new Date(), weekOffsets[0]);
        const configCategories = await getConfigCategories(site, context);

        await generatePatternsWorkbook({
          site,
          context,
          athenaClient,
          s3Config: {
            ...s3Config,
            tableName: reportConfig.tableName,
          },
          periods,
          sharepointClient,
          configCategories,
          existingPatterns,
        });
      }
    }

    log.debug(`Running weekly report: ${reportConfig.name}...`);

    for (const weekOffset of weekOffsets) {
      // eslint-disable-next-line no-await-in-loop
      const result = await runWeeklyReport({
        athenaClient,
        s3Config,
        reportConfig,
        log,
        site,
        sharepointClient,
        weekOffset,
        context,
      });

      if (result.success && result.uploadResult) {
        reportsToPublish.push(result.uploadResult);
      }

      results.push({
        name: reportConfig.name,
        table: reportConfig.tableName,
        database: s3Config.databaseName,
        customer: s3Config.customerName,
        success: result.success,
        weekOffset,
      });
    }
  }

  // Batch publish all uploaded reports using bulk API
  if (reportsToPublish.length > 0) {
    try {
      await bulkPublishToAdminHlx(reportsToPublish, log);
    } catch (error) {
      log.error('Failed to bulk publish reports:', error);
    }
  }

  if (AGENTIC_DAILY_SITE_IDS.has(siteId)) {
    try {
      dailyAgenticExport = await runDailyAgenticExport({
        athenaClient,
        s3Config,
        site,
        context,
        auditContext,
      });
    } catch (error) {
      log.error(`Failed daily agentic export for site ${siteId}: ${error.message}`);
      const trafficDate = getYesterdayUtcDate().toISOString().split('T')[0];
      dailyAgenticExport = {
        enabled: true,
        success: false,
        siteId,
        trafficDate,
        rowCount: 0,
        delivery: { source: 'db-endpoints', status: 'failed' },
        error: error.message,
      };
    }
  }

  return {
    auditResult: results,
    dailyAgenticExport,
    fullAuditRef: `${site.getConfig()?.getLlmoDataFolder()}`,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnLogsReport)
  .withUrlResolver(wwwUrlResolver)
  .build();
