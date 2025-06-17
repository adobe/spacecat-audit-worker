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

// src/utils/pipelineUtils.js
import { buildDetectionClause } from '../providers/agentic-patterns.js';
import { buildPartitionFilter } from './date-utils.js';

/**
 * Extracts a sanitized customer domain from the site URL
 * @param {{ getBaseURL?: Function, baseURL?: string }} site
 * @returns {string}
 */
export function extractCustomerDomain(site) {
  const base = typeof site.getBaseURL === 'function'
    ? site.getBaseURL()
    : site.baseURL;
  const { host } = new URL(base);
  return host.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

/**
 * Constructs the raw logs S3 bucket name
 * @param {string} customerDomain
 * @returns {string}
 */
export function getRawLogsBucket(customerDomain) {
  const bucketCustomer = customerDomain.replace(/[._]/g, '-');
  return `cdn-logs-${bucketCustomer}`;
}

/**
 * Returns a CREATE DATABASE statement
 * @param {string} database
 * @returns {string}
 */
export function createDatabaseDDL(database) {
  return `CREATE DATABASE IF NOT EXISTS ${database}`;
}

const DEFAULT_PARTITION_PROJECTIONS = {
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

/**
 * Builds Hive partition properties for Athena table DDL
 * @param {Record<string, string>} projections
 * @returns {string}
 */
export function buildPartitionProperties(projections) {
  return Object.entries(projections)
    .map(([key, value]) => `'${key}' = '${value}'`)
    .join(',\n  ');
}

/**
 * Creates a CREATE EXTERNAL TABLE DDL for raw logs
 * @param {object} options
 * @param {string} options.database
 * @param {string} options.table
 * @param {string} options.location
 * @param {Record<string, string>} options.schema
 * @param {{ storageFormat: string, serdeLibrary: string }} options.tableProperties
 * @returns {string}
 */
export function createRawTableDDL({
  database, table, location, schema, tableProperties,
}) {
  const fields = Object.entries(schema)
    .map(([name, type]) => `  ${name} ${type}`)
    .join(',\n');

  const partitionProps = buildPartitionProperties(DEFAULT_PARTITION_PROJECTIONS);

  return `
CREATE EXTERNAL TABLE IF NOT EXISTS ${database}.${table} (
${fields}
)
PARTITIONED BY (
  year string,
  month string,
  day string,
  hour string
)
${tableProperties.storageFormat} '${tableProperties.serdeLibrary}'
LOCATION '${location}'
TBLPROPERTIES (
  'projection.enabled' = 'true',
  'storage.location.template' = '${location}\${year}/\${month}/\${day}/\${hour}/',
  ${partitionProps},
  'has_encrypted_data' = 'false'
)
`;
}

/**
 * Builds an UNLOAD query to aggregate, dedupe, and count logs by key fields
 * @param {object} options
 * @param {string} options.database
 * @param {string} options.rawTable
 * @param {Record<string, string>} options.mappingExpressions
 * @param {string} options.defaultFilterClause
 * @param {string} options.bucket
 * @param {{ year: string, month: string, day: string, hour: string }} options.parts
 * @param {string} options.userAgentField
 * @returns {string}
 */
export function createAggregatedUnloadQuery({
  database,
  rawTable,
  mappingExpressions,
  defaultFilterClause,
  bucket,
  parts,
  userAgentField,
}) {
  const whereClause = buildPartitionFilter(parts);
  const outputPath = `s3://${bucket}/aggregated/${parts.year}/${parts.month}/${parts.day}/${parts.hour}/`;

  const selectList = Object.entries(mappingExpressions)
    .map(([alias, expr]) => `  ${expr} AS ${alias}`)
    .join(',\n');

  const groupByList = Object.values(mappingExpressions).join(', ');
  const detectionClause = buildDetectionClause(userAgentField);

  return `
UNLOAD (
  SELECT
${selectList},
    COUNT(*) AS count
  FROM ${database}.${rawTable}
  ${whereClause}
    AND ${detectionClause}
    AND ${defaultFilterClause}
  GROUP BY ${groupByList}
) TO '${outputPath}'
WITH (format = 'PARQUET')
`;
}
