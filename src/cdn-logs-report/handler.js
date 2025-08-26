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
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { AuditBuilder } from '../common/audit-builder.js';
import { getS3Config, ensureTableExists, loadSql } from './utils/report-utils.js';
import { runWeeklyReport } from './utils/report-runner.js';
import { wwwUrlResolver } from '../common/base-audit.js';

async function runCdnLogsReport(url, context, site, auditContext) {
  const { log, s3Client } = context;
  const s3Config = getS3Config(site, context);

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: s3Config.bucket }));
  } catch (error) {
    log.error(`S3 bucket ${s3Config.bucket} is not accessible: ${error.message}`);
    return {
      auditResult: {
        success: false,
        timestamp: new Date().toISOString(),
        error: `S3 bucket ${s3Config.bucket} is not accessible: ${error.message}`,
        customer: s3Config.customerName,
      },
      fullAuditRef: url,
    };
  }

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

  log.info('Running weekly report...');
  const weekOffset = auditContext?.weekOffset || -1;
  await runWeeklyReport({
    athenaClient,
    s3Config,
    log,
    site,
    sharepointClient,
    weekOffset,
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
