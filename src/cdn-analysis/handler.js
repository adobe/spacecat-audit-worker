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
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import {
  resolveCdnBucketName,
  extractCustomerDomain,
  buildConsolidatedPaths,
  getBucketInfo,
  discoverCdnProviders,
  mapServiceToCdnProvider,
  CDN_TYPES,
  SERVICE_PROVIDER_TYPES,
  resolveConsolidatedBucketName,
  pathHasData,
  shouldRecreateTable,
} from '../utils/cdn-utils.js';
import { getImsOrgId } from '../utils/data-access.js';
import { computeWeekOffset } from '../utils/date-utils.js';
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

/**
 * Creates or recreates a table if schema version or location changed.
 */
async function ensureTable(client, database, table, location, sql, log) {
  const needsCreation = await shouldRecreateTable(client, database, table, location, sql, log);
  if (needsCreation) {
    const msg = `[Athena Query] Create table ${database}.${table}`;
    await client.execute(sql, database, msg);
  }
}

/**
 * Returns aggregated table names based on customer domain and mode.
 */
function getAggregatedTableNames(customerDomain) {
  return {
    aggregatedTable: `aggregated_logs_${customerDomain}_consolidated`,
    aggregatedReferralTable: `aggregated_referral_logs_${customerDomain}_consolidated`,
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Removes all S3 objects under a given prefix. Used to clear aggregated Parquet
 * files before re-inserting during forceReprocess, since Athena external tables
 * do not support SQL DELETE.
 */
async function clearS3Partition(s3Client, bucket, prefix, log) {
  let continuationToken;
  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    /* c8 ignore next */
    const keys = (response.Contents || []).map((obj) => ({ Key: obj.Key }));
    if (keys.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys, Quiet: true },
      }));
      log.info(`Cleared ${keys.length} object(s) from s3://${bucket}/${prefix}`);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
}

/**
 * Scans an S3 bucket for byocdn-other log files uploaded in the 24 hours preceding
 * auditDate. Returns a Set of day strings (e.g. "2025/02/17") that have recent uploads.
 *
 * Using auditDate (derived from auditContext) rather than Date.now() ensures the window
 * is anchored to the audit's scheduled time, so replays or delayed runs stay correct.
 *
 * byocdn-other files can arrive at any time, so we include all days (including today)
 * and rely on forceReprocess in sub-audits to re-aggregate if needed.
 */
export async function findRecentUploads(s3Client, bucketName, pathId, auditDate, log) {
  const prefix = pathId
    ? `${pathId}/raw/${SERVICE_PROVIDER_TYPES.BYOCDN_OTHER}/`
    : `raw/${SERVICE_PROVIDER_TYPES.BYOCDN_OTHER}/`;
  const cutoff = new Date(auditDate.getTime() - ONE_DAY_MS);
  const detectedDays = new Set();
  let continuationToken;

  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const obj of response.Contents || []) {
      if (obj.LastModified >= cutoff) {
        const match = obj.Key.match(/\/raw\/byocdn-other\/(\d{4})\/(\d{2})\/(\d{2})\//);
        if (match) {
          detectedDays.add(`${match[1]}/${match[2]}/${match[3]}`);
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  log.info(`Found ${detectedDays.size} byocdn-other day(s) with recent uploads`);
  return detectedDays;
}

/**
 * Triggers cdn-logs-analysis sub-audits for each detected day, and one
 * cdn-logs-report per affected week (deduplicated by weekOffset).
 *
 * Sub-audits include isSubAudit: true to prevent recursive scanning,
 * and forceReprocess: true because the same day may already have partial
 * aggregated data from an earlier run.
 *
 * cdn-logs-report messages are delayed by 900s so analysis finishes first.
 */
async function triggerSubAudits(context, site, detectedDays) {
  const { sqs, dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const auditQueue = configuration.getQueues().audits;
  const siteId = site.getId();

  const weekOffsets = new Set();

  for (const dayKey of detectedDays) {
    const [year, month, day] = dayKey.split('/').map(Number);

    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(auditQueue, {
      type: 'cdn-logs-analysis',
      siteId,
      auditContext: {
        year,
        month,
        day,
        hour: 23,
        processFullDay: true,
        forceReprocess: true,
        isSubAudit: true,
      },
    });
    log.info(`Triggered cdn-logs-analysis sub-audit for siteId=${siteId} day=${dayKey}`);

    weekOffsets.add(computeWeekOffset(year, month, day));
  }

  for (const weekOffset of weekOffsets) {
    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(auditQueue, {
      type: 'cdn-logs-report',
      siteId,
      auditContext: { weekOffset },
    }, null, 900);
    log.info(`Triggered cdn-logs-report for siteId=${siteId} weekOffset=${weekOffset}`);
  }
}

export async function processCdnLogs(auditUrl, context, site, auditContext) {
  const { log, s3Client, dataAccess } = context;
  const auditType = 'cdn-logs-analysis';

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
  const pathId = orgId || await getImsOrgId(site, dataAccess, log);

  const { isLegacy, providers } = await getBucketInfo(s3Client, bucketName, pathId);
  const serviceProviders = isLegacy
    ? await discoverCdnProviders(s3Client, bucketName, { year, month, day, hour })
    : providers;

  log.debug(`Processing ${serviceProviders.length} service provider(s) in bucket: ${bucketName}`);

  const database = `cdn_logs_${customerDomain}`;
  const { aggregatedTable, aggregatedReferralTable } = getAggregatedTableNames(
    customerDomain,
  );
  const consolidatedBucket = resolveConsolidatedBucketName(context);
  const siteId = site.getId();

  // byocdn-other files arrive on unpredictable schedules, so the dispatcher-scheduled
  // daily run (isSubAudit is absent, hour=23) doesn't process logs itself. Instead it
  // scans S3 for all days with recent uploads and triggers a sub-audit per day. The
  // sub-audits (isSubAudit: true) then do the actual Athena processing below.
  // The hour=23 guard mirrors the existing daily-only check for CDN_TYPES.OTHER below,
  // ensuring the S3 scan runs once per day and not on every hourly invocation.
  const wasScheduledByJobsDispatcher = !auditContext?.isSubAudit;
  const hasByocdnOther = serviceProviders.includes(SERVICE_PROVIDER_TYPES.BYOCDN_OTHER);

  if (hasByocdnOther && wasScheduledByJobsDispatcher && hour === '23') {
    const auditDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 0, 0));
    try {
      const recentUploads = await findRecentUploads(s3Client, bucketName, pathId, auditDate, log);
      if (recentUploads.size > 0) {
        await triggerSubAudits(context, site, recentUploads);
      } else {
        log.info(`No recent byocdn-other files found for siteId=${siteId}, nothing to trigger`);
      }
    } catch (e) {
      log.error(`Failed to scan/trigger byocdn-other sub-audits: ${e.message}`);
    }
    return {
      auditResult: {
        database,
        providers: [],
        completedAt: new Date().toISOString(),
        scanAndTriggerOnly: true,
      },
      fullAuditRef: auditUrl,
    };
  }

  const results = [];

  // Check if aggregated data already exists for this hour
  const hasAggregatedData = await pathHasData(s3Client, `s3://${consolidatedBucket}/aggregated/${siteId}/${year}/${month}/${day}/${hour}/`);
  const hasAggregatedReferralData = await pathHasData(s3Client, `s3://${consolidatedBucket}/aggregated-referral/${siteId}/${year}/${month}/${day}/${hour}/`);

  if (hasAggregatedData && hasAggregatedReferralData && !auditContext?.forceReprocess) {
    log.info(`${auditType} aggregated data already exists for siteId=${siteId} at path=s3://${consolidatedBucket}/aggregated/${siteId}/${year}/${month}/${day}/${hour}/ Skipping processing.`);
    return {
      auditResult: {
        database,
        providers: [],
        skipped: true,
        completedAt: new Date().toISOString(),
      },
      fullAuditRef: auditUrl,
    };
  }

  // Create database and aggregated tables once
  let tablesCreated = false;

  // eslint-disable-next-line no-await-in-loop
  for (const serviceProvider of serviceProviders) {
    const cdnType = mapServiceToCdnProvider(serviceProvider);

    const cdnTypeLower = cdnType.toLowerCase();
    const hasDailyPartitioningOnly = [CDN_TYPES.CLOUDFLARE, CDN_TYPES.OTHER].includes(cdnTypeLower);

    // Skip providers with daily partitioning only (no hourly partitions) unless hour=23
    if (hasDailyPartitioningOnly && hour !== '23') {
      log.info(`Skipping service provider ${serviceProvider.toUpperCase()} (CDN: ${cdnType.toUpperCase()}) - only processed daily at end of day (hour 23)`);
    } else {
      log.info(`Processing service provider ${serviceProvider.toUpperCase()} (CDN: ${cdnType.toUpperCase()})`);

      const paths = buildConsolidatedPaths(
        bucketName,
        consolidatedBucket,
        serviceProvider,
        { year, month, day, hour },
        pathId,
        siteId,
      );
      const rawTable = `raw_logs_${customerDomain}_${serviceProvider.replace(/-/g, '_')}`;
      const athenaClient = AWSAthenaClient.fromContext(context, paths.tempLocation, {
        maxPollAttempts: 500,
      });

      if (!tablesCreated) {
        // eslint-disable-next-line no-await-in-loop
        const sqlDb = await loadSql(cdnType, 'create-database', { database });
        // eslint-disable-next-line no-await-in-loop
        await athenaClient.execute(sqlDb, database, `[Athena Query] Create database ${database}`);

        // eslint-disable-next-line no-await-in-loop
        const sqlAggregatedTable = await loadSql('', 'create-aggregated-table', {
          databaseName: database,
          tableName: aggregatedTable,
          aggregatedLocation: paths.aggregatedLocation,
        });
        // eslint-disable-next-line no-await-in-loop
        const aggLoc = paths.aggregatedLocation;
        // eslint-disable-next-line no-await-in-loop
        await ensureTable(athenaClient, database, aggregatedTable, aggLoc, sqlAggregatedTable, log);

        // eslint-disable-next-line no-await-in-loop
        const sqlAggregatedReferralTable = await loadSql('', 'create-aggregated-referral-table', {
          databaseName: database,
          tableName: aggregatedReferralTable,
          aggregatedLocation: paths.aggregatedReferralLocation,
        });
        // eslint-disable-next-line no-await-in-loop
        await ensureTable(
          athenaClient,
          database,
          aggregatedReferralTable,
          paths.aggregatedReferralLocation,
          sqlAggregatedReferralTable,
          log,
        );

        tablesCreated = true;
      }

      // eslint-disable-next-line no-await-in-loop
      const sqlRaw = await loadSql(cdnType, 'create-raw-table', {
        database, rawTable, rawLocation: paths.rawLocation,
      });
      // eslint-disable-next-line no-await-in-loop
      await ensureTable(athenaClient, database, rawTable, paths.rawLocation, sqlRaw, log);

      // Check if raw logs exist for this hour/day
      // For CloudFlare, check daily file; for others, check hourly directory
      const rawDataPath = (() => {
        if (cdnTypeLower === CDN_TYPES.CLOUDFLARE) {
          return `${paths.rawLocation}${year}${month}${day}/`;
        }
        if (cdnTypeLower === CDN_TYPES.OTHER) {
          return `${paths.rawLocation}${year}/${month}/${day}/`;
        }
        return `${paths.rawLocation}${year}/${month}/${day}/${hour}/`;
      })();

      // eslint-disable-next-line no-await-in-loop
      const hasRawData = await pathHasData(context.s3Client, rawDataPath);

      if (!hasRawData) {
        log.info(`${auditType} no raw logs found for siteId=${siteId}, siteUrl=${host}, serviceProvider=${serviceProvider}, cdnType=${cdnType} at path=${rawDataPath}`);
        // eslint-disable-next-line no-continue
        continue;
      }

      // Generate hour filter based on processing mode
      const hourFilter = (hasDailyPartitioningOnly || auditContext?.processFullDay) ? '' : `AND hour = '${hour}'`;

      // Load SQL queries in parallel
      // eslint-disable-next-line no-await-in-loop
      const [sqlInsert, sqlInsertReferral] = await Promise.all([
        loadSql(cdnType, 'insert-aggregated', {
          database,
          rawTable,
          aggregatedTable,
          year,
          month,
          day,
          hour,
          hourFilter,
          bucket: bucketName,
          host,
          serviceProvider,
        }),
        loadSql(cdnType, 'insert-aggregated-referral', {
          database,
          rawTable,
          aggregatedTable: aggregatedReferralTable,
          year,
          month,
          day,
          hour,
          hourFilter,
          bucket: bucketName,
          serviceProvider,
        }),
      ]);

      if (auditContext?.forceReprocess) {
        // eslint-disable-next-line no-await-in-loop
        await clearS3Partition(s3Client, consolidatedBucket, `aggregated/${siteId}/${year}/${month}/${day}/`, log);
        // eslint-disable-next-line no-await-in-loop
        await clearS3Partition(s3Client, consolidatedBucket, `aggregated-referral/${siteId}/${year}/${month}/${day}/`, log);
      }

      // eslint-disable-next-line no-await-in-loop
      await athenaClient.execute(sqlInsert, database, `[Athena Query] Insert aggregated data for ${serviceProvider} into ${database}.${aggregatedTable}`);
      // eslint-disable-next-line no-await-in-loop
      await athenaClient.execute(sqlInsertReferral, database, `[Athena Query] Insert aggregated referral data for ${serviceProvider} into ${database}.${aggregatedReferralTable}`);

      log.info(`${auditType} processed logs for siteId=${siteId} with:
        serviceProvider=${serviceProvider}
        cdnType=${cdnType}
        rawTable=${rawTable}
        aggregatedTable=${aggregatedTable}
        aggregatedReferralTable=${aggregatedReferralTable}
        rawDataPath=${rawDataPath}
        output=${paths.aggregatedOutput}
        outputReferral=${paths.aggregatedReferralOutput}`);

      results.push({
        serviceProvider,
        cdnType,
        rawTable,
        aggregatedTable,
        aggregatedReferralTable,
        rawDataPath,
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

export async function cdnLogsAnalysisRunner(auditUrl, context, site, auditContext) {
  return processCdnLogs(auditUrl, context, site, auditContext);
}

export default new AuditBuilder()
  .withRunner(cdnLogsAnalysisRunner)
  .withUrlResolver(wwwUrlResolver)
  .build();
