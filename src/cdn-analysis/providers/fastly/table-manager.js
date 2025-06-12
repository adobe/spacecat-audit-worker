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
import { executeAthenaSetupQuery } from '../../utils/athena-client.js';
import { FASTLY_CONFIG, getFastlyCustomerRawLogsLocation, getFastlyRawLogsPartitionConfig } from './config.js';

export async function createFastlyFilteredLogsTable(athenaClient, s3Config, log) {
  try {
    log.info('🔧 Creating Fastly filtered logs table for agentic traffic...');

    const formattedLogsLocation = `s3://${s3Config.rawLogsBucket}/filtered/`;
    const formattedTableName = `filtered_logs_${s3Config.customerDomain}`;
    const partitionConfig = getFastlyRawLogsPartitionConfig(s3Config);

    // Build schema dynamically from config
    const schemaFields = Object.entries(FASTLY_CONFIG.filteredLogsSchema)
      .map(([fieldName, fieldType]) => `${fieldName} ${fieldType}`)
      .join(',\n        ');

    const formattedLogsTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS ${FASTLY_CONFIG.databaseName}.${formattedTableName} (
        ${schemaFields}
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ${FASTLY_CONFIG.tableProperties.filteredStorageFormat}
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

    log.info('✅ Fastly filtered logs table created successfully!');
  } catch (error) {
    log.error('❌ Failed to create Fastly filtered logs table:', error);
    throw error;
  }
}

/**
 * Ensure Fastly Athena tables exist, create them if they don't
 */
export async function ensureFastlyAthenaTablesExist(athenaClient, s3Config, log) {
  try {
    log.info('🔧 Checking Fastly Athena tables setup...');

    // Create database first
    await executeAthenaSetupQuery(
      athenaClient,
      `CREATE DATABASE IF NOT EXISTS ${FASTLY_CONFIG.databaseName}`,
      `${FASTLY_CONFIG.databaseName} database`,
      s3Config,
      log,
    );

    // Create customer-specific raw logs table
    const rawLogsLocation = getFastlyCustomerRawLogsLocation(s3Config);
    const customerTableName = `raw_logs_${s3Config.customerDomain}`;
    const partitionConfig = getFastlyRawLogsPartitionConfig(s3Config);

    // Build schema dynamically from config
    const schemaFields = Object.entries(FASTLY_CONFIG.rawLogsSchema)
      .map(([fieldName, fieldType]) => `${fieldName} ${fieldType}`)
      .join(',\n        ');

    const rawLogsTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS ${FASTLY_CONFIG.databaseName}.${customerTableName} (
        ${schemaFields}
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ${FASTLY_CONFIG.tableProperties.storageFormat} '${FASTLY_CONFIG.tableProperties.serdeLibrary}'
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

    log.info('✅ Fastly Athena tables setup completed successfully!');
  } catch (error) {
    log.error('❌ Failed to setup Fastly Athena tables:', error);
    throw error;
  }
}
/* c8 ignore stop */
