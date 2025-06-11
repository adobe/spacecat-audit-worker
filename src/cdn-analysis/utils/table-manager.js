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
import { executeAthenaSetupQuery } from './athena-client.js';
import { getCustomerRawLogsLocation, getRawLogsPartitionConfig } from '../config/s3-config.js';

/**
 * Create formatted logs table for storing agentic traffic
 */
export async function createFormattedLogsTable(athenaClient, s3Config, log) {
  try {
    log.info('🔧 Creating formatted logs table for agentic traffic...');

    const formattedLogsLocation = `s3://${s3Config.rawLogsBucket}/formatted-logs/`;
    const formattedTableName = `formatted_logs_${s3Config.customerDomain}`;
    const partitionConfig = getRawLogsPartitionConfig(s3Config);

    const formattedLogsTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS cdn_logs.${formattedTableName} (
        timestamp string,
        geo_country string,
        host string,
        url string,
        request_method string,
        request_protocol string,
        request_user_agent string,
        response_state string,
        response_status int,
        response_reason string,
        request_referer string,
        agentic_type string
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ROW FORMAT SERDE 'org.apache.hive.hcatalog.data.JsonSerDe'
      LOCATION '${formattedLogsLocation}'
      TBLPROPERTIES (
        'projection.enabled' = '${partitionConfig.projectionEnabled}',
        'storage.location.template' = '${formattedLogsLocation}year=\${year}/month=\${month}/day=\${day}/hour=\${hour}/',
        ${Object.entries(partitionConfig.partitionProjections).map(([key, value]) => `'${key}' = '${value}'`).join(',\n        ')},
        'has_encrypted_data' = 'false'
      )
    `;

    await executeAthenaSetupQuery(
      athenaClient,
      formattedLogsTableDDL,
      `${formattedTableName} table`,
      s3Config,
      log,
    );

    log.info('✅ Formatted logs table created successfully!');
  } catch (error) {
    log.error('❌ Failed to create formatted logs table:', error);
    throw error;
  }
}

/**
 * Ensure Athena tables exist, create them if they don't
 */
export async function ensureAthenaTablesExist(athenaClient, s3Config, log) {
  try {
    log.info('🔧 Checking Athena tables setup...');

    // Create database first
    await executeAthenaSetupQuery(
      athenaClient,
      'CREATE DATABASE IF NOT EXISTS cdn_logs',
      'cdn_logs database',
      s3Config,
      log,
    );

    // Create customer-specific raw logs table
    const rawLogsLocation = getCustomerRawLogsLocation(s3Config);
    const customerTableName = `raw_logs_${s3Config.customerDomain}`;
    const partitionConfig = getRawLogsPartitionConfig(s3Config);

    const rawLogsTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS cdn_logs.${customerTableName} (
        timestamp string,
        geo_country string,
        host string,
        url string,
        request_method string,
        request_protocol string,
        request_user_agent string,
        response_state string,
        response_status int,
        response_reason string,
        request_referer string
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ROW FORMAT SERDE 'org.apache.hive.hcatalog.data.JsonSerDe'
      LOCATION '${rawLogsLocation}'
      TBLPROPERTIES (
        'projection.enabled' = '${partitionConfig.projectionEnabled}',
        'storage.location.template' = '${partitionConfig.locationTemplate}',
        ${Object.entries(partitionConfig.partitionProjections).map(([key, value]) => `'${key}' = '${value}'`).join(',\n        ')},
        'has_encrypted_data' = 'false'
      )
    `;

    await executeAthenaSetupQuery(
      athenaClient,
      rawLogsTableDDL,
      `${customerTableName} table`,
      s3Config,
      log,
    );

    // Create new Parquet analysis table for improved performance
    const parquetAnalysisTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS cdn_logs.cdn_analysis_data (
        analysis_type string,
        customer_domain string,
        hour_processed timestamp,
        generated_at timestamp,
        record_index int,
        total_requests bigint,
        success_rate double,
        agentic_requests bigint,
        geo_country string,
        response_status bigint,
        request_user_agent string,
        referer string,
        additional_data string
      )
      PARTITIONED BY (
        customer string,
        year string,
        month string,
        day string,
        hour string
      )
      STORED AS PARQUET
      LOCATION '${s3Config.analysisBucket}/cdn-analysis/'
      TBLPROPERTIES (
        'projection.enabled' = 'true',
        'projection.customer.type' = 'enum',
        'projection.customer.values' = 'blog_adobe_com,other_domains',
        'projection.year.type' = 'integer',
        'projection.year.range' = '2024,2030',
        'projection.year.format' = 'yyyy',
        'projection.month.type' = 'integer',
        'projection.month.range' = '1,12',
        'projection.month.format' = 'MM',
        'projection.day.type' = 'integer',
        'projection.day.range' = '1,31',
        'projection.day.format' = 'dd',
        'projection.hour.type' = 'integer',
        'projection.hour.range' = '0,23',
        'projection.hour.format' = 'HH',
        'storage.location.template' = 's3://${s3Config.analysisBucket}/cdn-analysis/customer=\${customer}/year=\${year}/month=\${month}/day=\${day}/hour=\${hour}/',
        'has_encrypted_data' = 'false'
      )
    `;

    await executeAthenaSetupQuery(
      athenaClient,
      parquetAnalysisTableDDL,
      'cdn_analysis_parquet table',
      s3Config,
      log,
    );

    log.info('✅ Athena tables setup completed successfully!');
  } catch (error) {
    log.error('❌ Failed to setup Athena tables:', error);
    throw error;
  }
}
/* c8 ignore stop */
