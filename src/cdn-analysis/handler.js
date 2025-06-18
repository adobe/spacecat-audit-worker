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
import { determineCdnProvider } from './utils/cdn-utils.js';
import { getPreviousHour, getHourParts, formatS3Prefix } from './utils/date-utils.js';
import { extractCustomerDomain, getRawLogsBucket } from './utils/pipeline-utils.js';
import { loadSql } from './utils/sql-loader.js';
import { AWSAthenaClient } from './utils/athena-client.js';

export async function cdnLogAnalysisRunner(auditUrl, context, site) {
  const { log, s3Client } = context;

  // derive customer & time
  const { host, hostEscaped } = extractCustomerDomain(site);
  const bucket = getRawLogsBucket(hostEscaped);
  const hourDate = getPreviousHour();
  const parts = getHourParts(hourDate);
  const prefix = formatS3Prefix('raw', parts);

  // detect CDN provider
  const cdnType = await determineCdnProvider(s3Client, bucket, prefix);
  log.info(`Using ${cdnType.toUpperCase()} provider`);

  // names & locations
  const database = `cdn_logs_${hostEscaped}`;
  const rawTable = `raw_logs_${hostEscaped}`;
  const rawLocation = `s3://${bucket}/raw/`;
  const tempLocation = `s3://${bucket}/temp/athena-results/`;
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);

  // create database
  const sqlDb = await loadSql(cdnType, 'create-database', { database });
  const sqlDbDescription = `[Athena Query] Create database ${database}`;
  await athenaClient.execute(sqlDb, database, sqlDbDescription);

  // create raw table
  const sqlRaw = await loadSql(cdnType, 'create-raw-table', {
    database,
    rawTable,
    rawLocation,
  });
  const sqlRawDescription = `[Athena Query] Create raw logs table ${database}.${rawTable} from ${rawLocation}`;
  await athenaClient.execute(sqlRaw, database, sqlRawDescription);

  // unload aggregated hour
  const sqlUnload = await loadSql(cdnType, 'unload-aggregated', {
    database,
    rawTable,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    bucket,
    host,
  });
  const sqlUnloadDescription = '[Athena Query] Filter the raw logs and unload to ';
  await athenaClient.execute(sqlUnload, database, sqlUnloadDescription);

  const output = `s3://${bucket}/aggregated/${parts.year}/${parts.month}/${parts.day}/${parts.hour}/`;
  log.info(`Wrote aggregated hour to ${output}`);

  return {
    auditResult: {
      hourProcessed: hourDate.toISOString(),
      cdnType,
      database,
      rawTable,
      outputLocation: output,
      completedAt: new Date().toISOString(),
    },
    fullAuditRef: output,
  };
}

export default new AuditBuilder()
  .withRunner(cdnLogAnalysisRunner)
  .build();
/* c8 ignore stop */
