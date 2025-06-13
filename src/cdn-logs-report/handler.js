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

/* c8 ignore start */
import { AuditBuilder } from '../common/audit-builder.js';
import { getS3Config, ensureDatabaseExists, setupCrawlerBasedDiscovery } from './utils/aws-utils.js';
import { runWeeklyReport, runCustomDateRangeReport } from './utils/report-runner.js';
import { AUDIT_TYPES, MESSAGE_TYPES, ERROR_MESSAGES } from './constants/index.js';

async function createAuditResult(reportType, result, additionalData = {}, auditUrl = '') {
  return {
    auditResult: {
      reportType,
      ...additionalData,
      ...result,
    },
    fullAuditRef: auditUrl,
  };
}

async function runCdnLogsReport(url, context, site) {
  const {
    log, glueClient, athenaClient, s3Client,
  } = context;
  const message = context.message || {};

  log.info(`Starting CDN logs report audit for ${url}`);

  const s3Config = getS3Config(site, context);
  const databaseName = `cdn_logs_${s3Config.customerDomain}`;

  await ensureDatabaseExists(glueClient, databaseName, log);
  await setupCrawlerBasedDiscovery(glueClient, databaseName, s3Config, log);

  if (message.type === MESSAGE_TYPES.CUSTOM_DATE_RANGE) {
    const { startDate, endDate } = message;

    if (!startDate || !endDate) {
      throw new Error(ERROR_MESSAGES.MISSING_DATE_RANGE);
    }

    log.info(`Running custom date range report: ${startDate} to ${endDate}`);
    const result = await runCustomDateRangeReport({
      athenaClient,
      startDateStr: startDate,
      endDateStr: endDate,
      databaseName,
      s3Config,
      s3Client,
      log,
      site,
    });

    return createAuditResult(AUDIT_TYPES.CUSTOM, result, {
      dateRange: { startDate, endDate },
    }, url);
  }

  log.info('Running weekly report...');
  const result = await runWeeklyReport({
    athenaClient,
    databaseName,
    s3Config,
    s3Client,
    log,
    site,
  });

  return createAuditResult(AUDIT_TYPES.WEEKLY, result, {}, url);
}

export default new AuditBuilder()
  .withRunner(runCdnLogsReport)
  .build();

/* c8 ignore end */
