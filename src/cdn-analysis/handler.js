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
/* eslint-disable object-curly-newline */

/* c8 ignore start */
import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { determineCdnProvider, buildSiteFilters } from './utils/cdn-utils.js';
import { AWSAthenaClient } from '../utils/athena-client.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

function extractCustomerDomain(site) {
  const { host } = new URL(site.getBaseURL());
  return {
    host,
    hostEscaped: host.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
  };
}

function getHourParts() {
  const previousHour = new Date(Date.now() - ONE_HOUR_MS);

  const year = previousHour.getUTCFullYear().toString();
  const month = String(previousHour.getUTCMonth() + 1).padStart(2, '0');
  const day = String(previousHour.getUTCDate()).padStart(2, '0');
  const hour = String(previousHour.getUTCHours()).padStart(2, '0');

  return { year, month, day, hour };
}

async function loadSql(provider, filename, variables) {
  return getStaticContent(variables, `./src/cdn-analysis/sql/${provider}/${filename}.sql`);
}

export async function cdnLogAnalysisRunner(auditUrl, context, site) {
  const { log, s3Client } = context;

  // derive customer, time, config
  const { host, hostEscaped } = extractCustomerDomain(site);
  const { year, month, day, hour } = getHourParts();
  const { bucketName: bucket, filters } = site.getConfig().getCdnLogsConfig() || {};
  const siteFilters = buildSiteFilters(filters);

  // names & locations
  const rawLogsPrefix = `raw/${year}/${month}/${day}/${hour}/`;
  const database = `cdn_logs_${hostEscaped}`;
  const rawTable = `raw_logs_${hostEscaped}`;
  const rawLocation = `s3://${bucket}/raw/`;
  const tempLocation = `s3://${bucket}/temp/athena-results/`;
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);

  // detect CDN provider
  const cdnType = await determineCdnProvider(s3Client, bucket, rawLogsPrefix);
  log.info(`Using ${cdnType.toUpperCase()} provider`);

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
    year,
    month,
    day,
    hour,
    bucket,
    host,
    siteFilters,
    hostEscaped,
  });
  const output = `s3://${bucket}/aggregated_${hostEscaped}/${year}/${month}/${day}/${hour}/`;
  const sqlUnloadDescription = `[Athena Query] Filter the raw logs and unload to ${output}`;
  await athenaClient.execute(sqlUnload, database, sqlUnloadDescription);

  return {
    auditResult: {
      cdnType,
      database,
      rawTable,
      output,
      completedAt: new Date().toISOString(),
    },
    fullAuditRef: output,
  };
}

export default new AuditBuilder()
  .withRunner(cdnLogAnalysisRunner)
  .build();
/* c8 ignore stop */
