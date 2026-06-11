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
import { AuditBuilder } from '../common/audit-builder.js';
import {
  resolveCdnBucketName,
  extractSiteKeyFromBaseURL,
  buildConsolidatedPaths,
  getBucketInfo,
  discoverCdnProviders,
  mapServiceToCdnProvider,
  CDN_TYPES,
  SERVICE_PROVIDER_TYPES,
  getS3Config,
  getCdnAwsRuntime,
  pathHasData,
  shouldRecreateTable,
} from '../utils/cdn-utils.js';
import { getImsOrgId } from '../utils/data-access.js';
import { getConfigCdnProvider } from '../utils/llmo-config-utils.js';
import { wwwUrlResolver } from '../common/base-audit.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

// cdn-logs-report dispatch knobs. The base delay gives the cdn-logs-analysis
// sub-audits time to finish before the matching report runs; the per-day stagger
// then spreads the reports out instead of firing them all at the SQS max at once.
// Both are capped at the SQS DelaySeconds hard limit.
const SQS_MAX_DELAY_SECONDS = 900;
const CDN_LOGS_REPORT_DELAY_SECONDS = 800;
const CDN_LOGS_REPORT_STAGGER_SECONDS = 30;

// Re-enqueue the window as a delayed sub-audit on transient Athena failures.
// Disable with env CDN_ANALYSIS_RETRY_ENABLED=false. Delay kept under the 900s SQS cap.
const MAX_ANALYSIS_RETRIES = 2;
const ANALYSIS_RETRY_DELAY_SECONDS = 850;
// Fallback only: used when the athena-client did not surface Athena's structured
// Retryable flag (see isRetryableAthenaError). Transient (System-category) errors
// worth retrying; user errors excluded. Prefer the structured flag — don't copy this
// list into other handlers as the primary signal.
const RETRYABLE_ATHENA_ERROR_PATTERNS = [
  'exhausted resources at this scale factor',
  'internal error',
  'internalerror',
  'resource limit exceeded',
  'throttl',
  'too many requests',
  'rate exceeded',
  'slow down',
  'slowdown',
  'service unavailable',
  'worker node',
];

const pad2 = (n) => String(n).padStart(2, '0');

function isRetryableAthenaError(error) {
  // Trust Athena's authoritative Retryable flag when the client surfaced it;
  // otherwise fall back to matching the message string.
  if (typeof error.retryable === 'boolean') {
    return error.retryable;
  }
  const normalized = String(error.message).toLowerCase();
  return RETRYABLE_ATHENA_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function isValidAuditContext(auditContext) {
  if (!isNonEmptyObject(auditContext)) {
    return false;
  }
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Removes all S3 objects under a given prefix. Used to clear aggregated Parquet
 * files before re-inserting during forceReprocess, since Athena external tables
 * do not support SQL DELETE.
 */
async function clearS3Partition(s3Client, bucket, prefix, log) {
  const isNoSuchBucket = (error) => error?.name === 'NoSuchBucket'
    /* c8 ignore next 2 */
    || error?.Code === 'NoSuchBucket'
    || error?.code === 'NoSuchBucket';

  let continuationToken;
  do {
    let response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
    } catch (error) {
      if (isNoSuchBucket(error)) {
        log.info(`Skipping partition cleanup for s3://${bucket}/${prefix} because bucket does not exist yet.`);
        return;
      }
      /* c8 ignore next 2 */
      throw error;
    }
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
 * date-based cdn-logs-report per detected day.
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
  }

  // One date-based cdn-logs-report per detected day. cdn-logs-report exports the
  // day BEFORE auditContext.date, so send day + 1 as the reference. Delayed by a
  // base wait (so the analysis sub-audits above have time to finish) plus a per-day
  // stagger, capped at the SQS max, so the reports don't all fire at once.
  for (const [index, dayKey] of [...detectedDays].entries()) {
    const [year, month, day] = dayKey.split('/').map(Number);
    const reportDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString();
    const delaySeconds = Math.min(
      CDN_LOGS_REPORT_DELAY_SECONDS + (index * CDN_LOGS_REPORT_STAGGER_SECONDS),
      SQS_MAX_DELAY_SECONDS,
    );

    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(auditQueue, {
      type: 'cdn-logs-report',
      siteId,
      auditContext: {
        date: reportDate,
      },
    }, null, delaySeconds);
    log.info(`Triggered cdn-logs-report for siteId=${siteId} date=${reportDate} delay=${delaySeconds}s`);
  }
}

export async function processCdnLogs(auditUrl, context, site, auditContext) {
  const { log, dataAccess } = context;
  const auditType = 'cdn-logs-analysis';
  const awsRuntime = getCdnAwsRuntime(site, context);
  const { s3Client } = awsRuntime;

  const bucketName = await resolveCdnBucketName(site, {
    ...context,
    s3Client,
  });
  if (!bucketName) {
    return {
      auditResult: {
        error: 'No CDN bucket found',
        completedAt: new Date().toISOString(),
      },
      fullAuditRef: auditUrl,
    };
  }

  const siteKey = extractSiteKeyFromBaseURL(site);
  const { year, month, day, hour } = getHourParts(auditContext);
  const { host } = new URL(site.getBaseURL());
  const siteId = site.getId();
  const { orgId } = site.getConfig()?.getLlmoCdnBucketConfig() || {};
  // for non-adobe customers, use the orgId from the config
  const pathId = orgId || await getImsOrgId(site, dataAccess, log);

  const { isLegacy, providers } = await getBucketInfo(s3Client, bucketName, pathId);
  const discoveredServiceProviders = isLegacy
    ? await discoverCdnProviders(s3Client, bucketName, { year, month, day, hour })
    : providers;
  const configuredCdnProvider = await getConfigCdnProvider(site, context);
  const targetProvider = isLegacy
    ? mapServiceToCdnProvider(configuredCdnProvider)
    : configuredCdnProvider;
  const serviceProviders = configuredCdnProvider
    ? discoveredServiceProviders.filter((provider) => provider === targetProvider)
    : discoveredServiceProviders;

  if (configuredCdnProvider) {
    if (serviceProviders.length > 0) {
      log.info(`Filtered discovered service providers to configured cdnProvider=${configuredCdnProvider} for siteId=${siteId}, host=${host}`);
    } else {
      log.warn(`Configured cdnProvider=${configuredCdnProvider} was not found among discovered service providers: ${discoveredServiceProviders.join(', ') || 'none'} for siteId=${siteId}, host=${host}`);
    }
  }

  log.info(`Processing ${serviceProviders.length} service provider(s) in bucket: ${bucketName}`);

  const s3Config = getS3Config(site, context);
  const {
    bucket: consolidatedBucket,
    databaseName: database,
    tableName: aggregatedTable,
    referralTableName: aggregatedReferralTable,
  } = s3Config;
  const athenaClient = awsRuntime.createAthenaClient(
    s3Config.getAthenaTempLocation(),
    { maxPollAttempts: 500 },
  );

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
  const hasPartialAggregates = hasAggregatedData !== hasAggregatedReferralData;
  const aggregatedPrefix = `aggregated/${siteId}/${year}/${month}/${day}/${hour}/`;
  const aggregatedReferralPrefix = `aggregated-referral/${siteId}/${year}/${month}/${day}/${hour}/`;

  if (hasAggregatedData && hasAggregatedReferralData && !auditContext?.forceReprocess) {
    log.info(`${auditType} aggregated data already exists for siteId=${siteId} at path=s3://${consolidatedBucket}/${aggregatedPrefix} Skipping processing.`);
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

  if (hasPartialAggregates) {
    log.warn(`${auditType} found partial aggregates for siteId=${siteId}. Rebuilding s3://${consolidatedBucket}/${aggregatedPrefix} and s3://${consolidatedBucket}/${aggregatedReferralPrefix}.`);
  }

  if (auditContext?.forceReprocess || hasPartialAggregates) {
    await clearS3Partition(s3Client, consolidatedBucket, aggregatedPrefix, log);
    await clearS3Partition(s3Client, consolidatedBucket, aggregatedReferralPrefix, log);
  }

  // Create database and aggregated tables once
  let tablesCreated = false;

  // eslint-disable-next-line no-await-in-loop
  for (const serviceProvider of serviceProviders) {
    const cdnType = mapServiceToCdnProvider(serviceProvider);

    const cdnTypeLower = cdnType.toLowerCase();
    const hasDailyPartitioningOnly = [
      CDN_TYPES.CLOUDFLARE,
      CDN_TYPES.IMPERVA,
      CDN_TYPES.OTHER,
    ].includes(cdnTypeLower);

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
      const rawTable = `raw_logs_${siteKey}_${serviceProvider.replace(/-/g, '_')}`;

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
        if (cdnTypeLower === CDN_TYPES.IMPERVA) {
          // Imperva raw files are delivered flat at the rawLocation prefix (no date/hour subdirs)
          return paths.rawLocation;
        }
        return `${paths.rawLocation}${year}/${month}/${day}/${hour}/`;
      })();

      // eslint-disable-next-line no-await-in-loop
      const hasRawData = await pathHasData(s3Client, rawDataPath);

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

// Re-enqueues the same audit context as a delayed retry, bumping retryCount.
async function requeueAnalysisRetry(context, site, auditContext, retryCount) {
  const { sqs, dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const auditQueue = configuration.getQueues().audits;
  const siteId = site.getId();

  await sqs.sendMessage(auditQueue, {
    type: 'cdn-logs-analysis',
    siteId,
    auditContext: {
      ...auditContext,
      retryCount,
    },
  }, null, ANALYSIS_RETRY_DELAY_SECONDS);

  log.info(`cdn-logs-analysis scheduled retry ${retryCount}/${MAX_ANALYSIS_RETRIES} for siteId=${siteId} in ${ANALYSIS_RETRY_DELAY_SECONDS}s`);
}

export async function cdnLogsAnalysisRunner(auditUrl, context, site, auditContext) {
  const { log, env } = context;
  try {
    return await processCdnLogs(auditUrl, context, site, auditContext);
  } catch (e) {
    const retryCount = Math.max(0, Number(auditContext?.retryCount) || 0);
    const retriesEnabled = String(env?.CDN_ANALYSIS_RETRY_ENABLED ?? 'true').toLowerCase() === 'true';

    if (retriesEnabled && isRetryableAthenaError(e) && retryCount < MAX_ANALYSIS_RETRIES) {
      try {
        await requeueAnalysisRetry(context, site, auditContext, retryCount + 1);
      } catch (requeueErr) {
        // If the requeue itself fails (SQS/DB), surface the original Athena error so
        // logs/alerts show the real reason. "failed" omitted here to avoid double-
        // matching the alert; the framework logs the canonical failure when e rethrows.
        log.error(`cdn-logs-analysis could not re-enqueue retry for siteId=${site.getId()}: ${requeueErr.message}`);
        throw e;
      }
      // Soft result so SQS doesn't also retry this invocation (double-process).
      return {
        auditResult: {
          retryScheduled: true,
          retryCount: retryCount + 1,
          error: e.message,
          completedAt: new Date().toISOString(),
        },
        fullAuditRef: auditUrl,
      };
    }

    // No e.message here: the framework logs the full "... failed. Reason: ..." on
    // throw, so including it would double-match the ("cdn-logs-analysis" "failed") alert.
    log.error(`cdn-logs-analysis giving up for siteId=${site.getId()} after ${retryCount} retr${retryCount === 1 ? 'y' : 'ies'}`);
    throw e;
  }
}

export default new AuditBuilder()
  .withRunner(cdnLogsAnalysisRunner)
  .withUrlResolver(wwwUrlResolver)
  .build();
