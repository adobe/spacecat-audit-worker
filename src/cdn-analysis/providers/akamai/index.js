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
import { getAkamaiS3Config } from './config.js';
import { createAkamaiFilteredLogsTable, ensureAkamaiAthenaTablesExist } from './table-manager.js';
import { AKAMAI_AGENTIC_PATTERNS, mapAkamaiFieldsForUnload } from './field-mapper.js';
import { executeAthenaQuery } from '../../utils/athena-client.js';
import { getHourlyPartitionFilter } from '../../queries/query-helpers.js';

export const cdnType = 'akamai';

/**
 * Get S3 configuration for Akamai
 */
export function getS3Config(context, site) {
  return getAkamaiS3Config(context, site);
}

/**
 * Ensure tables exist
 */
export async function ensureTablesExist(athenaClient, s3Config, log) {
  return ensureAkamaiAthenaTablesExist(athenaClient, s3Config, log);
}

/**
 * Create filtered logs table
 */
export async function createFilteredLogsTable(athenaClient, s3Config, log) {
  return createAkamaiFilteredLogsTable(athenaClient, s3Config, log);
}

/**
 * Filter and store agentic logs
 */
export async function filterAndStoreAgenticLogs(
  athenaClient,
  hourToProcess,
  s3Config,
  sourceTableName,
  log,
) {
  try {
    log.info('Filtering and storing Akamai agentic logs to filtered...');

    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    // Get partition values
    const year = hourToProcess.getUTCFullYear();
    const month = String(hourToProcess.getUTCMonth() + 1).padStart(2, '0');
    const day = String(hourToProcess.getUTCDate()).padStart(2, '0');
    const hour = String(hourToProcess.getUTCHours()).padStart(2, '0');

    // UNLOAD query to filter agentic logs and export directly to S3
    const outputPath = `s3://${s3Config.rawLogsBucket}/filtered/year=${year}/month=${month}/day=${day}/hour=${hour}/`;
    const fieldMapping = mapAkamaiFieldsForUnload();
    const databaseName = `cdn_logs_${s3Config.customerDomain}`;

    const unloadQuery = `
      UNLOAD (
        SELECT 
          ${fieldMapping.selectFields}
        FROM ${databaseName}.${sourceTableName}
        ${whereClause}
          AND ${AKAMAI_AGENTIC_PATTERNS.DETECTION_CLAUSE}
      ) TO '${outputPath}'
      WITH (
        format = 'PARQUET'
      )
    `;

    // Execute the UNLOAD query
    await executeAthenaQuery(athenaClient, unloadQuery, s3Config, log, databaseName);

    // Get count of filtered records by querying the source
    const countQuery = `
      SELECT COUNT(*) as agentic_count
      FROM ${databaseName}.${sourceTableName}
      ${whereClause}
        AND ${AKAMAI_AGENTIC_PATTERNS.DETECTION_CLAUSE}
    `;

    const results = await executeAthenaQuery(
      athenaClient,
      countQuery,
      s3Config,
      log,
      databaseName,
    );
    const count = results.length > 0 ? parseInt(results[0].agentic_count || 0, 10) : 0;

    log.info(`Filtered ${count} Akamai agentic logs and stored to: ${outputPath}`);

    return count;
  } catch (error) {
    log.error('Failed to filter and store Akamai agentic logs:', error);
    throw error;
  }
}

/**
 * Get database name
 */
export function getDatabaseName(s3Config) {
  return `cdn_logs_${s3Config.customerDomain}`;
}

// Export as default object for backward compatibility
export default {
  cdnType,
  getS3Config,
  ensureTablesExist,
  createFilteredLogsTable,
  filterAndStoreAgenticLogs,
  getDatabaseName,
};
/* c8 ignore stop */
