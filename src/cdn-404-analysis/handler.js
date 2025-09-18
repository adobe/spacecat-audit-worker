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

import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/base-audit.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

function extractCustomerDomain(site) {
  const { hostname } = new URL(site.getBaseURL());
  return {
    sanitizedHostname: hostname.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
  };
}

function getHourParts() {
  const previousHour = new Date(Date.now() - ONE_HOUR_MS);

  const year = previousHour.getUTCFullYear().toString();
  const month = String(previousHour.getUTCMonth() + 1).padStart(2, '0');
  const day = String(previousHour.getUTCDate()).padStart(2, '0');
  const hour = String(previousHour.getUTCHours()).padStart(2, '0');

  return {
    year, month, day, hour,
  };
}

async function loadSql(filename, variables) {
  return getStaticContent(variables, `./src/cdn-404-analysis/sql/${filename}.sql`);
}

export async function cdn404AnalysisRunner(context, site) {
  const { sanitizedHostname } = extractCustomerDomain(site);
  const { rawBucket } = site.getConfig().getCdnLogsConfig();
  const {
    year, month, day, hour,
  } = getHourParts();

  const database = `cdn_logs_${sanitizedHostname}`;
  const rawTable = `raw_logs_status_${sanitizedHostname}`;
  const tempLocation = `s3://${rawBucket}/temp/athena-results/`;
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);

  // Create database
  const sqlDb = await loadSql('create-database', { database });
  const sqlDbDescription = `[Athena Query] Create database ${database}`;
  await athenaClient.execute(sqlDb, database, sqlDbDescription);

  // TODO: Get tenant IMS
  const imsOrg = site.getConfig().getImsOrg();
  if (!imsOrg) {
    throw new Error('IMS organization is required');
  }
  // Each tenant has its own folder mapped via IMS org within the raw bucket
  const bucket = `${rawBucket}/${imsOrg}`;
  const rawLocation = `s3://${bucket}/raw/aem-cs-fastly`;

  // Create table
  const sqlTable = await loadSql('create-raw-table', {
    database,
    rawTable,
    rawLocation,
  });
  const sqlTableDescription = `[Athena Query] Create raw logs table ${database}.${rawTable} from ${rawLocation}`;
  await athenaClient.execute(sqlTable, database, sqlTableDescription);

  // Unload 404 content data
  const output = `s3://${bucket}/aggregated-404/${year}/${month}/${day}/${hour}/`;
  const sqlUnload = await loadSql('unload-404-content', {
    database,
    rawTable,
    year,
    month,
    day,
    hour,
    output,
  });
  const sqlUnloadDescription = `[Athena Query] Unload 404 content data to ${output}`;
  await athenaClient.execute(sqlUnload, database, sqlUnloadDescription);

  return {
    auditResult: {
      database,
      rawTable,
      output,
      completedAt: new Date().toISOString(),
    },
    fullAuditRef: output,
  };
}

export default new AuditBuilder()
  .withRunner(cdn404AnalysisRunner)
  .withUrlResolver(wwwUrlResolver)
  .build();
