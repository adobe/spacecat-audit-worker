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
import {
  REGEX_PATTERNS,
  CDN_LOGS_PREFIX,
} from '../constants/core.js';
import { executeAthenaQuery } from '../../utils/athena-utils.js';

export function extractCustomerDomain(site) {
  return new URL(site.getBaseURL()).host
    .replace(REGEX_PATTERNS.URL_SANITIZATION, '_')
    .toLowerCase();
}

export function getAnalysisBucket(customerDomain) {
  const bucketCustomer = customerDomain.replace(REGEX_PATTERNS.BUCKET_SANITIZATION, '-');
  return `${CDN_LOGS_PREFIX}${bucketCustomer}`;
}

export function getS3Config(site) {
  const customerDomain = extractCustomerDomain(site);
  const customerName = customerDomain.split(/[._]/)[0];
  const bucket = getAnalysisBucket(customerDomain);

  return {
    bucket,
    customerName,
    customerDomain,
    aggregatedLocation: `s3://${bucket}/aggregated/`,
    databaseName: `cdn_logs_${customerDomain}`,
    tableName: `aggregated_logs_${customerDomain}`,
    getAthenaTempLocation: () => `s3://${bucket}/temp/athena-results/`,
  };
}

export function createTableDDL(s3Config) {
  const { databaseName, tableName, aggregatedLocation } = s3Config;

  return `
    CREATE EXTERNAL TABLE IF NOT EXISTS ${databaseName}.${tableName} (
      url string,
      user_agent string,
      status int,
      referer string,
      count bigint
    )
    PARTITIONED BY (
      year string,
      month string,
      day string,
      hour string
    )
    STORED AS PARQUET
    LOCATION '${aggregatedLocation}'
    TBLPROPERTIES (
      'projection.enabled' = 'true',
      'projection.year.type' = 'integer',
      'projection.year.range' = '2024,2030',
      'projection.month.type' = 'integer',
      'projection.month.range' = '1,12',
      'projection.month.digits' = '2',
      'projection.day.type' = 'integer',
      'projection.day.range' = '1,31',
      'projection.day.digits' = '2',
      'projection.hour.type' = 'integer',
      'projection.hour.range' = '0,23',
      'projection.hour.digits' = '2',
      'storage.location.template' = '${aggregatedLocation}\${year}/\${month}/\${day}/\${hour}/',
      'has_encrypted_data' = 'false'
    )
  `;
}

export async function ensureTableExists(athenaClient, s3Config, log) {
  const { tableName } = s3Config;

  try {
    const createTableQuery = createTableDDL(s3Config);
    log.info(`Creating or checking table: ${tableName}`);
    await executeAthenaQuery(athenaClient, createTableQuery, s3Config, log);

    log.info(`Table ${tableName} is ready`);
  } catch (error) {
    log.error(`Failed to ensure table exists: ${error.message}`);
    throw error;
  }
}

/* c8 ignore end */
