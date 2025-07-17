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
import { createFrom } from '@adobe/spacecat-helix-content-sdk';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { getS3Config, ensureTableExists, loadSql } from './utils/report-utils.js';
import { runWeeklyReport, runCustomDateRangeReport } from './utils/report-runner.js';
import { wwwUrlResolver } from '../common/base-audit.js';

async function runCdnLogsReport(url, context, site) {
  const { log, message = {} } = context;
  const s3Config = getS3Config(site, context);

  log.info(`Starting CDN logs report audit for ${url}`);

  const SHAREPOINT_URL = 'https://adobe.sharepoint.com/:x:/r/sites/HelixProjects/Shared%20Documents/sites/elmo-ui-data';

  const sharepointClient = await createFrom({
    clientId: process.env.SHAREPOINT_CLIENT_ID,
    clientSecret: process.env.SHAREPOINT_CLIENT_SECRET,
    authority: process.env.SHAREPOINT_AUTHORITY,
    domainId: process.env.SHAREPOINT_DOMAIN_ID,
  }, { url: SHAREPOINT_URL, type: 'onedrive' });

  const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());

  // create db if not exists
  const sqlDb = await loadSql('create-database', { database: s3Config.databaseName });
  const sqlDbDescription = `[Athena Query] Create database ${s3Config.databaseName}`;
  await athenaClient.execute(sqlDb, s3Config.databaseName, sqlDbDescription);

  await ensureTableExists(athenaClient, s3Config, log);

  const auditResultBase = {
    success: true,
    timestamp: new Date().toISOString(),
    database: s3Config.databaseName,
    table: s3Config.tableName,
    customer: s3Config.customerName,
  };

  if (message.type === 'runCustomDateRange') {
    const { startDate, endDate } = message;
    if (!startDate || !endDate) {
      throw new Error('Custom date range requires startDate and endDate in message');
    }

    log.info(`Running custom report: ${startDate} to ${endDate}`);

    await runCustomDateRangeReport({
      athenaClient,
      startDateStr: startDate,
      endDateStr: endDate,
      s3Config,
      log,
      site,
      sharepointClient,
    });

    return {
      auditResult: {
        ...auditResultBase,
        reportType: 'custom',
        dateRange: { startDate, endDate },
        sharePointPath: `/sites/elmo-ui-data/${s3Config.customerName}/`,
      },
      fullAuditRef: `${SHAREPOINT_URL}/${s3Config.customerName}/`,
    };
  }

  log.info('Running weekly report...');
  await runWeeklyReport({
    athenaClient, s3Config, log, site, sharepointClient,
  });

  return {
    auditResult: {
      ...auditResultBase,
      reportType: 'cdn-report-weekly',
      sharePointPath: `/sites/elmo-ui-data/${s3Config.customerName}/`,
    },
    fullAuditRef: `${SHAREPOINT_URL}/${s3Config.customerName}/`,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnLogsReport)
  .withUrlResolver(wwwUrlResolver)
  .build();
