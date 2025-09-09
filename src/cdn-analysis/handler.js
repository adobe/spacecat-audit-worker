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
import { getStaticContent, isInteger, isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import {
  resolveCdnBucketName,
  extractCustomerDomain,
  buildCdnPaths,
  getBucketInfo,
  discoverCdnProviders,
  mapServiceToCdnProvider,
  CDN_TYPES,
} from '../utils/cdn-utils.js';
import { getImsOrgId } from '../utils/data-access.js';
import { wwwUrlResolver } from '../common/base-audit.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

function isValidAuditContext(auditContext) {
  if (!isNonEmptyObject(auditContext)) return false;
  return ['year', 'month', 'day', 'hour'].every((k) => isInteger(auditContext[k]));
}

function getHourParts(auditContext) {
  if (isValidAuditContext(auditContext)) {
    const { year, month, day, hour } = auditContext;
    return {
      year: String(year),
      month: pad2(month),
      day: pad2(day),
      hour: pad2(hour),
    };
  }

  const previousHour = new Date(Date.now() - ONE_HOUR_MS);

  return {
    year: String(previousHour.getUTCFullYear()),
    month: pad2(previousHour.getUTCMonth() + 1),
    day: pad2(previousHour.getUTCDate()),
    hour: pad2(previousHour.getUTCHours()),
  };
}

async function loadSql(provider, filename, variables) {
  return getStaticContent(variables, `./src/cdn-analysis/sql/${provider}/${filename}.sql`);
}

export async function cdnLogAnalysisRunner(auditUrl, context, site, auditContext) {
  const { log, s3Client, dataAccess } = context;

  const bucketName = await resolveCdnBucketName(site, context);
  if (!bucketName) {
    return {
      auditResult: {
        error: 'No CDN bucket found',
        completedAt: new Date().toISOString(),
      },
      fullAuditRef: auditUrl,
    };
  }

  const customerDomain = extractCustomerDomain(site);
  const { year, month, day, hour } = getHourParts(auditContext);
  const { host } = new URL(site.getBaseURL());
  const { orgId } = site.getConfig()?.getLlmoCdnBucketConfig() || {};
  // for non-adobe customers, use the orgId from the config
  const imsOrgId = orgId || await getImsOrgId(site, dataAccess, log);

  const { isLegacy, providers } = await getBucketInfo(s3Client, bucketName, imsOrgId);
  const serviceProviders = isLegacy
    ? await discoverCdnProviders(s3Client, bucketName, { year, month, day, hour })
    : providers;

  log.info(`Processing ${serviceProviders.length} service provider(s) in bucket: ${bucketName}`);

  const database = `cdn_logs_${customerDomain}`;
  const results = [];

  // eslint-disable-next-line no-await-in-loop
  for (const serviceProvider of serviceProviders) {
    const cdnType = mapServiceToCdnProvider(serviceProvider);

    // Skip CloudFlare for hourly analysis - only process daily at end of day
    if (cdnType.toLowerCase() === CDN_TYPES.CLOUDFLARE && hour !== '23') {
      log.info(`Skipping service provider ${serviceProvider.toUpperCase()} (CDN: ${cdnType.toUpperCase()}) - only processed daily at end of day (hour 23)`);
    } else {
      log.info(`Processing service provider ${serviceProvider.toUpperCase()} (CDN: ${cdnType.toUpperCase()})`);

      const paths = buildCdnPaths(
        bucketName,
        serviceProvider,
        { year, month, day, hour },
        imsOrgId,
      );
      const rawTable = `raw_logs_${customerDomain}_${serviceProvider.replace(/-/g, '_')}`;
      const athenaClient = AWSAthenaClient.fromContext(context, paths.tempLocation, {
        maxPollAttempts: 500,
      });

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
        serviceProvider,
        aggregatedOutput: paths.aggregatedOutput,
      });
      // eslint-disable-next-line no-await-in-loop
      await athenaClient.execute(sqlUnload, database, `[Athena Query] Filter and unload ${serviceProvider} to ${paths.aggregatedOutput}`);

      // eslint-disable-next-line no-await-in-loop
      const sqlUnloadReferral = await loadSql(cdnType, 'unload-aggregated-referral', {
        database,
        rawTable,
        year,
        month,
        day,
        hour,
        bucket: bucketName,
        serviceProvider,
        aggregatedReferralOutput: paths.aggregatedReferralOutput,
      });
      // eslint-disable-next-line no-await-in-loop
      await athenaClient.execute(sqlUnloadReferral, database, `[Athena Query] (Referral) Filter and unload ${cdnType} to ${paths.aggregatedReferralOutput}`);

      results.push({
        serviceProvider,
        cdnType,
        rawTable,
        output: paths.aggregatedOutput,
        outputReferral: paths.aggregatedReferralOutput,
      });
    }
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
