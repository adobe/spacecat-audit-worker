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
export function getHourlyPartitionFilter(hourToProcess) {
  const year = hourToProcess.getUTCFullYear();
  const month = String(hourToProcess.getUTCMonth() + 1).padStart(2, '0');
  const day = String(hourToProcess.getUTCDate()).padStart(2, '0');
  const hour = String(hourToProcess.getUTCHours()).padStart(2, '0');

  return {
    whereClause: `WHERE year = '${year}' AND month = '${month}' AND day = '${day}' AND hour = '${hour}'`,
  };
}

export function createUnloadQuery(selectQuery, analysisType, hourToProcess, s3Config) {
  // Get partition values for S3 path
  const year = hourToProcess.getUTCFullYear();
  const month = String(hourToProcess.getUTCMonth() + 1).padStart(2, '0');
  const day = String(hourToProcess.getUTCDate()).padStart(2, '0');
  const hour = String(hourToProcess.getUTCHours()).padStart(2, '0');

  const outputPath = `s3://${s3Config.analysisBucket}/aggregated/analysis_type=${analysisType}/year=${year}/month=${month}/day=${day}/hour=${hour}/`;

  return `
    UNLOAD (
      ${selectQuery}
    ) TO '${outputPath}'
    WITH (format = 'PARQUET')
  `;
}
/* c8 ignore stop */
