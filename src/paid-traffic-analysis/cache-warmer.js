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

import {
  AWSAthenaClient,
  TrafficDataResponseDto,
  getTrafficAnalysisQuery,
  TrafficDataWithCWVDto,
  getTrafficAnalysisQueryPlaceholdersFilled,
} from '@adobe/spacecat-shared-athena-client';
import crypto from 'crypto';
import { fileExists, addResultJsonToCache } from './caching-helper.js';

const QUERIES = [
  { dimensions: ['utm_campaign', 'path', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['utm_campaign', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['utm_campaign', 'path'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['utm_campaign'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['trf_type', 'trf_channel', 'utm_campaign'], mapper: TrafficDataResponseDto },
  { dimensions: ['trf_type', 'trf_channel'], mapper: TrafficDataResponseDto },
  { dimensions: ['trf_type', 'utm_campaign'], mapper: TrafficDataResponseDto },
  { dimensions: ['trf_type'], mapper: TrafficDataResponseDto },
  { dimensions: ['path', 'page_type'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['path', 'page_type', 'trf_platform', 'utm_campaign', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['page_type', 'trf_platform', 'utm_campaign', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['path', 'page_type', 'utm_campaign', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['path', 'page_type', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['path', 'page_type', 'utm_campaign'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['path', 'page_type', 'trf_platform'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['path', 'page_type', 'utm_campaign', 'trf_platform'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['path', 'page_type', 'trf_platform', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['page_type', 'utm_campaign', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['page_type', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['page_type', 'utm_campaign'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['page_type', 'trf_platform'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['page_type', 'trf_platform', 'device'], mapper: TrafficDataWithCWVDto },
  { dimensions: ['page_type', 'trf_platform', 'utm_campaign'], mapper: TrafficDataWithCWVDto },
];

function getCacheKey(siteId, query, cacheLocation) {
  const outPrefix = crypto.createHash('md5').update(query).digest('hex');
  const cacheKey = `${cacheLocation}/${siteId}/${outPrefix}.json`;
  return { cacheKey, outPrefix };
}

function getConfig(env) {
  const {
    RUM_METRICS_DATABASE: rumMetricsDatabase,
    RUM_METRICS_COMPACT_TABLE: rumMetricsCompactTable,
    S3_BUCKET_NAME: bucketName,
    PAID_DATA_THRESHOLD: paidDataThreshold,
    CWV_THRESHOLDS: cwvThresholds,
    MAX_CONCURRENT_REQUESTS: maxConcurrentRequests,
  } = env;

  if (!bucketName) {
    throw new Error('S3_BUCKET_NAME must be provided for caching');
  }

  const concurrentLimit = maxConcurrentRequests ?? 5;

  return {
    rumMetricsDatabase: rumMetricsDatabase ?? 'rum_metrics',
    rumMetricsCompactTable: rumMetricsCompactTable ?? 'compact_metrics',
    bucketName,
    pageViewThreshold: paidDataThreshold ?? 1000,
    cwvThresholds,
    maxConcurrentRequests: concurrentLimit,
    athenaTemp: `s3://${bucketName}/rum-metrics-compact/temp/out`,
    cacheLocation: `s3://${bucketName}/rum-metrics-compact/cache`,
  };
}

async function limitConcurrency(tasks, maxConcurrent) {
  const results = [];
  const executing = [];

  for (const task of tasks) {
    const promise = task().then((result) => {
      executing.splice(executing.indexOf(promise), 1);
      return result;
    });

    results.push(promise);
    executing.push(promise);

    if (executing.length >= maxConcurrent) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

async function checkCacheExists(
  context,
  log,
  config,
  siteId,
  queryConfig,
  temporalParams,
  tableName,
  pageTypes,
) {
  const { s3Client } = context;
  const { dimensions } = queryConfig;
  const { yearInt, weekInt, monthInt } = temporalParams;

  const queryParams = getTrafficAnalysisQueryPlaceholdersFilled({
    week: weekInt,
    month: monthInt,
    year: yearInt,
    siteId,
    dimensions,
    tableName,
    pageTypes: dimensions.includes('page_type') ? pageTypes : null,
    pageTypeMatchColumn: 'path',
    trfTypes: dimensions.includes('trf_type') ? null : ['paid'],
    pageViewThreshold: config.pageViewThreshold,
  });

  const query = getTrafficAnalysisQuery(queryParams);
  const { cacheKey } = getCacheKey(siteId, query, config.cacheLocation);

  const exists = await fileExists(s3Client, cacheKey, log);
  return { queryConfig, exists, cacheKey };
}

export async function warmCacheForSite(context, log, env, site, temporalParams) {
  const siteId = site.getSiteId();

  const config = getConfig(env);
  const baseURL = await site.getBaseURL();
  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;
  const pageTypes = await site.getPageTypes();

  const { yearInt, weekInt, monthInt } = temporalParams;

  log.info(`Starting cache warming for site ${siteId} - Year: ${yearInt}, Week: ${weekInt}, Month: ${monthInt}`);
  log.info(`Using max concurrent requests: ${config.maxConcurrentRequests}`);

  // Check which queries need cache warming
  log.info(`Checking cache existence for ${QUERIES.length} queries...`);
  const checkTasks = QUERIES.map(
    (queryConfig) => () => checkCacheExists(
      context,
      log,
      config,
      siteId,
      queryConfig,
      temporalParams,
      tableName,
      pageTypes,
    ),
  );
  const cacheChecks = await limitConcurrency(checkTasks, config.maxConcurrentRequests);

  const queriesToWarm = cacheChecks.filter((check) => !check.exists);
  const cachedQueries = cacheChecks.filter((check) => check.exists);

  log.info(`Found ${cachedQueries.length} cached queries, ${queriesToWarm.length} queries need warming`);

  if (queriesToWarm.length === 0) {
    log.info(`All caches already exist for site ${siteId}. No warming needed.`);
    return {
      success: true,
      results: cachedQueries.map(
        (check) => ({ dimensions: check.queryConfig.dimensions, success: true, cached: true }),
      ),
      successCount: cachedQueries.length,
      totalCount: QUERIES.length,
    };
  }

  // Process only queries that need warming
  const results = [];

  // Add cached queries to results
  results.push(...cachedQueries.map((check) => ({
    dimensions: check.queryConfig.dimensions,
    success: true,
    cached: true,
    cacheKey: check.cacheKey,
  })));

  log.info(`Processing ${queriesToWarm.length} queries with max ${config.maxConcurrentRequests} concurrent...`);

  const warmingTasks = queriesToWarm.map(({ queryConfig }) => () => (async () => {
    try {
      // eslint-disable-next-line no-use-before-define
      await warmCacheForQuery(
        context,
        log,
        config,
        siteId,
        queryConfig,
        { yearInt, weekInt, monthInt },
        tableName,
        pageTypes,
        baseURL,
      );
      return { dimensions: queryConfig.dimensions, success: true, cached: false };
    } catch (error) {
      log.error(`Failed to warm cache for query: ${queryConfig.dimensions.join(', ')}`, error);
      return {
        dimensions: queryConfig.dimensions, success: false, error: error.message, cached: false,
      };
    }
  })());

  const warmingResults = await limitConcurrency(warmingTasks, config.maxConcurrentRequests);
  results.push(...warmingResults);

  const successCount = results.filter((r) => r.success).length;
  log.info(`Cache warming completed for site ${siteId}. Success: ${successCount}/${results.length}`);

  return {
    success: true, results, successCount, totalCount: results.length,
  };
}

export async function warmCacheForQuery(
  context,
  log,
  config,
  siteId,
  queryConfig,
  temporalParams,
  tableName,
  pageTypes,
  baseURL,
) {
  const { s3Client } = context;
  const { dimensions, mapper } = queryConfig;
  const { yearInt, weekInt, monthInt } = temporalParams;

  const queryParams = getTrafficAnalysisQueryPlaceholdersFilled({
    week: weekInt,
    month: monthInt,
    year: yearInt,
    siteId,
    dimensions,
    tableName,
    pageTypes: dimensions.includes('page_type') ? pageTypes : null,
    pageTypeMatchColumn: 'path',
    trfTypes: dimensions.includes('trf_type') ? null : ['paid'],
    pageViewThreshold: config.pageViewThreshold,
  });

  const query = getTrafficAnalysisQuery(queryParams);
  const { cacheKey, outPrefix } = getCacheKey(siteId, query, config.cacheLocation);

  log.info(`Warming cache for dimensions [${dimensions.join(', ')}]: ${cacheKey}`);

  const resultLocation = `${config.athenaTemp}/${outPrefix}`;
  const athenaClient = AWSAthenaClient.fromContext(context, resultLocation);

  const description = `Cache warming for siteId: ${siteId} | dimensions: [${dimensions.join(', ')}] | temporal: ${queryParams.temporalCondition}`;

  const results = await athenaClient.query(query, config.rumMetricsDatabase, description);

  let thresholdConfig = {};
  if (config.cwvThresholds) {
    thresholdConfig = typeof config.cwvThresholds === 'string'
      ? JSON.parse(config.cwvThresholds)
      : config.cwvThresholds;
  }

  const response = results.map((row) => mapper.toJSON(row, thresholdConfig, baseURL));

  await addResultJsonToCache(s3Client, cacheKey, response, log);
}
