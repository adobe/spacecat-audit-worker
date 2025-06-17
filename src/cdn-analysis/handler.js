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
import { determineCdnProvider } from './providers/cdn-provider-factory.js';
import { getPreviousHour, getHourParts, formatS3Prefix } from './utils/date-utils.js';
import {
  extractCustomerDomain,
  getRawLogsBucket,
  createDatabaseDDL,
  createRawTableDDL,
  createAggregatedUnloadQuery,
} from './utils/pipeline-utils.js';
import { executeAthenaSetupQuery, executeAthenaQuery } from './utils/athena-client.js';

async function runCdnAnalysis(auditUrl, context, site) {
  const { log, athenaClient, s3Client } = context;

  const customerDomain = extractCustomerDomain(site);
  const rawLogsBucket = getRawLogsBucket(customerDomain);

  const hour = getPreviousHour();
  const parts = getHourParts(hour);
  const prefix = formatS3Prefix('raw', parts);

  const provider = await determineCdnProvider(s3Client, rawLogsBucket, prefix);
  const { config, mappingExpressions } = provider;
  log.info(`Using ${config.cdnType.toUpperCase()} provider`);

  const database = `cdn_logs_${customerDomain}`;
  const rawTable = `raw_logs_${customerDomain}`;
  const rawLocation = `s3://${rawLogsBucket}/raw/`;
  const s3Config = { getAthenaTempLocation: () => `s3://${rawLogsBucket}/temp/athena-results/` };

  await executeAthenaSetupQuery(athenaClient, createDatabaseDDL(database), 'database', s3Config, log);
  await executeAthenaSetupQuery(
    athenaClient,
    createRawTableDDL({
      database,
      table: rawTable,
      location: rawLocation,
      schema: config.rawLogsSchema,
      tableProperties: config.tableProperties,
    }),
    'raw logs table',
    s3Config,
    log,
  );

  const unloadSql = createAggregatedUnloadQuery({
    database,
    rawTable,
    mappingExpressions,
    defaultFilterClause: config.defaultFilterClause,
    bucket: rawLogsBucket,
    parts,
    userAgentField: config.userAgentField,
  });
  await executeAthenaQuery(athenaClient, unloadSql, s3Config, log, database);

  log.info(`Wrote aggregated hour to s3://${rawLogsBucket}/aggregated/${parts.year}/${parts.month}/${parts.day}/${parts.hour}/`);

  return {
    auditResult: {
      hourProcessed: hour.toISOString(),
      cdnType: config.cdnType,
      database,
      rawTable,
      outputLocation: `s3://${rawLogsBucket}/aggregated/${parts.year}/${parts.month}/${parts.day}/${parts.hour}/`,
      completedAt: new Date().toISOString(),
    },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnAnalysis)
  .build();
/* c8 ignore stop */
