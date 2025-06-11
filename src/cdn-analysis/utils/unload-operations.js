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
import { executeAthenaQuery } from './athena-client.js';
import { AGENTIC_PATTERNS, getHourlyPartitionFilter } from '../queries/query-helpers.js';

/**
 * Filter and store agentic logs to filtered logs path using UNLOAD
 */
export async function filterAndStoreAgenticLogs(
  athenaClient,
  hourToProcess,
  s3Config,
  sourceTableName,
  log,
) {
  try {
    log.info('Filtering and storing agentic logs to filtered...');

    const { whereClause } = getHourlyPartitionFilter(hourToProcess);

    // Get partition values
    const year = hourToProcess.getUTCFullYear();
    const month = String(hourToProcess.getUTCMonth() + 1).padStart(2, '0');
    const day = String(hourToProcess.getUTCDate()).padStart(2, '0');
    const hour = String(hourToProcess.getUTCHours()).padStart(2, '0');

    // UNLOAD query to filter agentic logs and export directly to S3
    const outputPath = `s3://${s3Config.rawLogsBucket}/filtered/year=${year}/month=${month}/day=${day}/hour=${hour}/`;

    const unloadQuery = `
      UNLOAD (
        SELECT 
          timestamp,
          geo_country,
          host,
          url,
          request_method,
          request_protocol,
          request_user_agent,
          response_state,
          response_status,
          response_reason,
          request_referer,
          ${AGENTIC_PATTERNS.TYPE_CLASSIFICATION} as agentic_type
        FROM cdn_logs.${sourceTableName}
        ${whereClause}
          AND ${AGENTIC_PATTERNS.DETECTION_CLAUSE}
      ) TO '${outputPath}'
      WITH (
        format = 'PARQUET'
      )
    `;

    // Execute the UNLOAD query
    await executeAthenaQuery(athenaClient, unloadQuery, s3Config, log, 'cdn_logs');

    // Get count of filtered records by querying the source
    const countQuery = `
      SELECT COUNT(*) as agentic_count
      FROM cdn_logs.${sourceTableName}
      ${whereClause}
        AND ${AGENTIC_PATTERNS.DETECTION_CLAUSE}
    `;

    const results = await executeAthenaQuery(athenaClient, countQuery, s3Config, log, 'cdn_logs');
    const count = results.length > 0 ? parseInt(results[0].agentic_count || 0, 10) : 0;

    log.info(`Filtered ${count} agentic logs and stored to: ${outputPath}`);

    return count;
  } catch (error) {
    log.error('Failed to filter and store agentic logs:', error);
    throw error;
  }
}
/* c8 ignore stop */
