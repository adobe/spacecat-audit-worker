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
import { executeAthenaSetupQuery, executeAthenaQuery } from '../utils/athena-client.js';
import { getHourlyPartitionFilter } from '../queries/query-helpers.js';
import { buildDetectionClause } from './agentic-patterns.js';

export class BaseProvider {
  static dbPrefix = 'cdn_logs_';

  static rawTableNamePrefix = 'raw_logs_';

  static filteredTableNamePrefix = 'filtered_logs_';

  // default partition projection settings
  static defaultPartitionProjections = {
    'projection.year.type': 'integer',
    'projection.year.range': '2024,2030',
    'projection.month.type': 'integer',
    'projection.month.range': '1,12',
    'projection.month.digits': '2',
    'projection.day.type': 'integer',
    'projection.day.range': '1,31',
    'projection.day.digits': '2',
    'projection.hour.type': 'integer',
    'projection.hour.range': '0,23',
    'projection.hour.digits': '2',
  };

  constructor(context, site) {
    const { env, log } = context;
    this.context = context;
    this.log = log;
    this.site = site;

    this.environment = env.AWS_ENV === 'prod' ? 'prod' : 'dev';
    this.customerDomain = BaseProvider.extractCustomerDomain(site);
    this.rawLogsBucket = BaseProvider.getRawLogsBucket(this.environment, this.customerDomain);
    this.analysisBucket = this.rawLogsBucket; // same as raw by default
    this.getAthenaTempLocation = () => `s3://${this.rawLogsBucket}/temp/athena-results/`;

    this.s3Config = {
      cdnType: this.constructor.config.cdnType,
      rawLogsBucket: this.rawLogsBucket,
      analysisBucket: this.analysisBucket,
      customerDomain: this.customerDomain,
      environment: this.environment,
      getAthenaTempLocation: this.getAthenaTempLocation,
    };

    this.databaseName = `${BaseProvider.dbPrefix}${this.customerDomain}`;
    this.rawTableName = `${this.constructor.rawTableNamePrefix}${this.customerDomain}`;
    this.filteredTableName = `${this.constructor.filteredTableNamePrefix}${this.customerDomain}`;

    log.info(
      `${this.constructor.config.cdnType.toUpperCase()} S3 Config: ${this.customerDomain} (${this.environment})`,
      { rawLogsBucket: this.rawLogsBucket, analysisBucket: this.analysisBucket },
    );
  }

  static extractCustomerDomain(site) {
    return new URL(site.getBaseURL())
      .host
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();
  }

  static getRawLogsBucket(environment, customerDomain) {
    const bucketCustomer = customerDomain.replace(/[._]/g, '-');
    return `cdn-logs-${bucketCustomer}`;
  }

  getDatabaseName() {
    return this.databaseName;
  }

  getRawLogsLocation() {
    return `s3://${this.rawLogsBucket}/raw/`;
  }

  getFilteredLogsLocation() {
    return `s3://${this.rawLogsBucket}/filtered/`;
  }

  getRawLogsPartitionConfig() {
    return {
      projectionEnabled: 'true',
      locationTemplate: `${this.getRawLogsLocation()}\${year}/\${month}/\${day}/\${hour}/`,
      partitionProjections: BaseProvider.defaultPartitionProjections,
    };
  }

  static buildPartitionProperties(projections) {
    return Object.entries(projections)
      .map(([k, v]) => `'${k}' = '${v}'`)
      .join(',\n        ');
  }

  async ensureTablesExist(athenaClient, log) {
    log.info(`Checking ${this.constructor.config.cdnType} Athena tables setup...`);
    // Create DB
    await executeAthenaSetupQuery(
      athenaClient,
      `CREATE DATABASE IF NOT EXISTS ${this.databaseName}`,
      `${this.databaseName} database`,
      this.s3Config,
      log,
    );
    // Create raw table
    await executeAthenaSetupQuery(
      athenaClient,
      this.createRawLogsTableDDL(),
      `${this.rawTableName} table`,
      this.s3Config,
      log,
    );
    log.info(`${this.constructor.config.cdnType} Athena tables setup completed successfully!`);
  }

  createRawLogsTableDDL() {
    const { rawLogsSchema, tableProperties } = this.constructor.config;
    const fields = Object.entries(rawLogsSchema)
      .map(([name, type]) => `${name} ${type}`)
      .join(',\n        ');
    const {
      projectionEnabled,
      locationTemplate,
      partitionProjections,
    } = this.getRawLogsPartitionConfig();

    return `
      CREATE EXTERNAL TABLE IF NOT EXISTS ${this.databaseName}.${this.rawTableName} (
        ${fields}
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ${tableProperties.storageFormat} '${tableProperties.serdeLibrary}'
      LOCATION '${this.getRawLogsLocation()}'
      TBLPROPERTIES (
        'projection.enabled' = '${projectionEnabled}',
        'storage.location.template' = '${locationTemplate}',
        ${BaseProvider.buildPartitionProperties(partitionProjections)},
        'has_encrypted_data' = 'false'
      )
    `;
  }

  async createFilteredLogsTable(athenaClient, log) {
    log.info(`Creating ${this.constructor.config.cdnType} filtered logs table for agentic traffic...`);
    await executeAthenaSetupQuery(
      athenaClient,
      this.createFilteredLogsTableDDL(),
      `${this.filteredTableName} table`,
      this.s3Config,
      log,
    );
    log.info(`${this.constructor.config.cdnType} filtered logs table created successfully!`);
  }

  createFilteredLogsTableDDL() {
    const { filteredLogsSchema, tableProperties } = this.constructor.config;
    const fields = Object.entries(filteredLogsSchema)
      .map(([name, type]) => `${name} ${type}`)
      .join(',\n        ');
    const { projectionEnabled, partitionProjections } = this.getRawLogsPartitionConfig();
    const locationTemplate = `${this.getFilteredLogsLocation()}year=\${year}/month=\${month}/day=\${day}/hour=\${hour}/`;

    return `
      CREATE EXTERNAL TABLE IF NOT EXISTS ${this.databaseName}.${this.filteredTableName} (
        ${fields}
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ${tableProperties.filteredStorageFormat}
      LOCATION '${this.getFilteredLogsLocation()}'
      TBLPROPERTIES (
        'projection.enabled' = '${projectionEnabled}',
        'storage.location.template' = '${locationTemplate}',
        ${BaseProvider.buildPartitionProperties(partitionProjections)},
        'has_encrypted_data' = 'false'
      )
    `;
  }

  async filterAndStoreAgenticLogs(athenaClient, hourToProcess, log) {
    log.info(`Filtering and storing ${this.constructor.config.cdnType} agentic logs...`);
    const { whereClause } = getHourlyPartitionFilter(hourToProcess);
    const year = hourToProcess.getUTCFullYear();
    const month = String(hourToProcess.getUTCMonth() + 1).padStart(2, '0');
    const day = String(hourToProcess.getUTCDate()).padStart(2, '0');
    const hour = String(hourToProcess.getUTCHours()).padStart(2, '0');

    const outputPath = `${this.getFilteredLogsLocation()}year=${year}/month=${month}/day=${day}/hour=${hour}/`;
    const { selectFields } = this.constructor.mapFieldsForUnload();
    const db = this.databaseName;
    const detection = buildDetectionClause(this.constructor.config.userAgentField);

    const unloadQuery = `
      UNLOAD (
        SELECT
          ${selectFields}
        FROM ${db}.${this.rawTableName}
        ${whereClause}
          AND ${detection}
      ) TO '${outputPath}'
      WITH (format = 'PARQUET')
    `;
    await executeAthenaQuery(athenaClient, unloadQuery, this.s3Config, log, db);

    const countResults = await executeAthenaQuery(
      athenaClient,
      `
      SELECT COUNT(*) AS agentic_count
      FROM ${db}.${this.rawTableName}
      ${whereClause}
        AND ${detection}
      `,
      this.s3Config,
      log,
      db,
    );
    const count = countResults[0]?.agentic_count ?? 0;
    log.info(`Filtered ${count} logs to ${outputPath}`);
    return parseInt(count, 10);
  }
}
/* c8 ignore end */
