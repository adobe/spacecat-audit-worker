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
import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { resolveCdnBucketName, extractCustomerDomain, buildCdnPaths, getBucketInfo, discoverCdnProviders } from '../utils/cdn-utils.js';
import { wwwUrlResolver } from '../common/base-audit.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

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

  const bucketName = await resolveCdnBucketName(site, context);
  if (!bucketName) {
    return {
      auditResult: {
        error: 'No CDN bucket found',
        completedAt: new Date().toISOString(),
      },
      fullAuditRef: null,
    };
  }

  const customerDomain = extractCustomerDomain(site);
  const { year, month, day, hour } = getHourParts();
  const { host } = new URL(site.getBaseURL());

  const { isLegacy, providers } = await getBucketInfo(s3Client, bucketName);
  const cdnProviders = isLegacy
    ? await discoverCdnProviders(s3Client, bucketName, { year, month, day, hour })
    : providers;

  log.info(`Processing ${cdnProviders.length} CDN provider(s) in bucket: ${bucketName}`);

  const database = `cdn_logs_${customerDomain}`;
  const results = [];

  // Process each CDN provider
  // eslint-disable-next-line no-await-in-loop
  for (const cdnType of cdnProviders) {
    log.info(`Processing ${cdnType.toUpperCase()} provider`);

    const paths = buildCdnPaths(bucketName, cdnType, { year, month, day, hour }, isLegacy);
    const rawTable = `raw_logs_${customerDomain}_${cdnType}`;
    const athenaClient = AWSAthenaClient.fromContext(context, paths.tempLocation);

    if (results.length === 0) {
      // eslint-disable-next-line no-await-in-loop
      const sqlDb = await loadSql(cdnType, 'create-database', { database });
      // eslint-disable-next-line no-await-in-loop
      await athenaClient.execute(sqlDb, database, `[Athena Query] Create database ${database}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const sqlRaw = await loadSql(cdnType, 'create-raw-table', {
      database,
      rawTable,
      rawLocation: paths.rawLocation,
    });
    // eslint-disable-next-line no-await-in-loop
    await athenaClient.execute(sqlRaw, database, `[Athena Query] Create raw logs table ${database}.${rawTable}`);

    // unload aggregated hour for this provider
    // eslint-disable-next-line no-await-in-loop
    const sqlUnload = await loadSql(cdnType, 'unload-aggregated', {
      database,
      rawTable,
      year,
      month,
      day,
      hour,
      bucket: bucketName,
      host,
    });
    // eslint-disable-next-line no-await-in-loop
    await athenaClient.execute(sqlUnload, database, `[Athena Query] Filter and unload ${cdnType} to ${paths.aggregatedOutput}`);

    results.push({
      cdnType,
      rawTable,
      output: paths.aggregatedOutput,
    });
  }

  return {
    auditResult: {
      database,
      providers: results,
      completedAt: new Date().toISOString(),
    },
    fullAuditRef: results.map((r) => r.output).join(', '),
  };
}

export default new AuditBuilder()
  .withRunner(cdnLogAnalysisRunner)
  .withUrlResolver(wwwUrlResolver)
  .build();
