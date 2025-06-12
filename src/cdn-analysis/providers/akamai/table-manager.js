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
import { AKAMAI_CONFIG, getAkamaiCustomerRawLogsLocation, getAkamaiRawLogsPartitionConfig } from './config.js';

export async function createAkamaiFilteredLogsTable(athenaClient, s3Config, log) {
  try {
    log.info('🔧 Creating Akamai filtered logs table for agentic traffic...');

    const formattedLogsLocation = `s3://${s3Config.rawLogsBucket}/filtered/`;
    const formattedTableName = `filtered_logs_${s3Config.customerDomain}`;
    const partitionConfig = getAkamaiRawLogsPartitionConfig(s3Config);

    // Build schema dynamically from config
    const schemaFields = Object.entries(AKAMAI_CONFIG.filteredLogsSchema)
      .map(([fieldName, fieldType]) => `${fieldName} ${fieldType}`)
      .join(',\n        ');

    const formattedLogsTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS ${AKAMAI_CONFIG.databaseName}.${formattedTableName} (
        ${schemaFields}
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ${AKAMAI_CONFIG.tableProperties.filteredStorageFormat}
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

    log.info('✅ Akamai filtered logs table created successfully!');
  } catch (error) {
    log.error('❌ Failed to create Akamai filtered logs table:', error);
    throw error;
  }
}

/**
 * Ensure Akamai Athena tables exist, create them if they don't
 */
export async function ensureAkamaiAthenaTablesExist(athenaClient, s3Config, log) {
  try {
    log.info('🔧 Checking Akamai Athena tables setup...');

    // Create database first
    await executeAthenaSetupQuery(
      athenaClient,
      `CREATE DATABASE IF NOT EXISTS ${AKAMAI_CONFIG.databaseName + s3Config.customerDomain}`,
      `${AKAMAI_CONFIG.databaseName + s3Config.customerDomain} database`,
      s3Config,
      log,
    );

    // Create customer-specific raw logs table
    const rawLogsLocation = getAkamaiCustomerRawLogsLocation(s3Config);
    const customerTableName = `raw_logs_${s3Config.customerDomain}`;
    const partitionConfig = getAkamaiRawLogsPartitionConfig(s3Config);

    // Build schema dynamically from config
    const schemaFields = Object.entries(AKAMAI_CONFIG.rawLogsSchema)
      .map(([fieldName, fieldType]) => `${fieldName} ${fieldType}`)
      .join(',\n        ');

    const rawLogsTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS ${AKAMAI_CONFIG.databaseName}.${customerTableName} (
        ${schemaFields}
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ${AKAMAI_CONFIG.tableProperties.storageFormat} '${AKAMAI_CONFIG.tableProperties.serdeLibrary}'
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

    log.info('✅ Akamai Athena tables setup completed successfully!');
  } catch (error) {
    log.error('❌ Failed to setup Akamai Athena tables:', error);
    throw error;
  }
}
/* c8 ignore stop */
